import asyncio
import json
import logging
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.config import SimSettings, settings, save_settings, CONFIG_PATH
from backend.simulation import SimulationEngine

app = FastAPI(title="EKF-SLAM Simulator API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global simulation state
sim_engine: Optional[SimulationEngine] = None
playback_task: Optional[asyncio.Task] = None
playback_speed: float = 1.0
is_playing: bool = False
active_connections: List[WebSocket] = []

HISTORY_FILE = CONFIG_PATH.parent / "run_history.json"

class SavedRun(BaseModel):
    id: str
    timestamp: str
    track_type: str
    params: Dict[str, Any]
    final_metrics: Dict[str, float]
    history: List[Dict[str, float]] # List of {timestep, pos_error, cov_trace, landmark_rmse}

def init_sim():
    global sim_engine
    sim_engine = SimulationEngine(settings)
    
def get_run_history() -> List[Dict[str, Any]]:
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_run_history(runs: List[Dict[str, Any]]):
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(runs, f, indent=2)
    except Exception as e:
        print(f"Error saving run history: {e}")

@app.on_event("startup")
def startup_event():
    init_sim()

@app.get("/api/config")
def get_config():
    """Returns the current simulation configuration and landmarks."""
    global sim_engine
    if sim_engine is None:
        init_sim()
    return {
        "settings": sim_engine.settings.model_dump(),
        "landmarks_true": sim_engine.landmarks_true.tolist(),
        "track_points": sim_engine.track.points.tolist()
    }

@app.post("/api/start")
def start_simulation(params: Optional[Dict[str, Any]] = None):
    """Starts/restarts simulation with optional parameter overrides."""
    global sim_engine, playback_task, is_playing
    # Cancel any active running task
    if playback_task:
        playback_task.cancel()
        playback_task = None
    is_playing = False
    
    # Update settings
    if params:
        current_data = settings.model_dump()
        current_data.update(params)
        new_settings = SimSettings(**current_data)
        # Update global settings
        for key, val in new_settings.model_dump().items():
            setattr(settings, key, val)
        save_settings(settings)
        
    init_sim()
    return get_config()

@app.get("/api/state")
def get_state():
    """Returns the current state of the simulation."""
    global sim_engine
    if sim_engine is None:
        init_sim()
    return {
        "timestep": sim_engine.timestep,
        "gt_pose": sim_engine.gt_x.tolist(),
        "ekf_pose": sim_engine.ekf.x[:3].tolist(),
        "ekf_cov": sim_engine.ekf.P[:3, :3].tolist(),
        "idx2num": sim_engine.ekf.idx2num,
        "landmarks": sim_engine.ekf.get_landmark_positions(),
        "metrics": {
            "pos_error": float(np.linalg.norm(sim_engine.gt_x[:2] - sim_engine.ekf.x[:2])) if sim_engine.timestep > 0 else 0.0,
            "cov_trace": float(np.trace(sim_engine.ekf.P[:3, :3])),
            "landmark_rmse": sim_engine.compute_landmark_rmse()
        }
    }

import numpy as np

@app.get("/api/history")
def get_history():
    """Returns the full path history of the current simulation run."""
    global sim_engine
    if sim_engine is None:
        return {"gt_history": [], "ekf_history": []}
    return {
        "gt_history": sim_engine.history_gt,
        "ekf_history": sim_engine.history_ekf
    }

@app.get("/api/math")
def get_math():
    """Returns a full mathematical snapshot of the filter's matrices at the current step."""
    global sim_engine
    if sim_engine is None:
        init_sim()
    return sim_engine.get_math_snapshot()

@app.post("/api/step")
def step_simulation(steps: int = 1):
    """Manually advances the simulation by N steps."""
    global sim_engine
    if sim_engine is None:
        init_sim()
    
    last_state = {}
    for _ in range(steps):
        last_state = sim_engine.step()
    return last_state

@app.post("/api/params")
def update_params(params: Dict[str, Any]):
    """Dynamically updates EKF tuning parameters mid-simulation."""
    global sim_engine
    if sim_engine is None:
        init_sim()
        
    # Update current sim engine parameters
    if "Q_velocity_std" in params:
        sim_engine.ekf.Q_velocity_std = float(params["Q_velocity_std"])
        sim_engine.settings.Q_velocity_std = float(params["Q_velocity_std"])
    if "Q_omega_std" in params:
        sim_engine.ekf.Q_omega_std = float(params["Q_omega_std"])
        sim_engine.settings.Q_omega_std = float(params["Q_omega_std"])
    if "sig_lm" in params:
        sim_engine.ekf.sig_lm = float(params["sig_lm"])
        sim_engine.settings.sig_lm = float(params["sig_lm"])
    if "steer_noise_std" in params:
        sim_engine.settings.steer_noise_std = float(params["steer_noise_std"])
    if "sensor_range" in params:
        sim_engine.settings.sensor_range = float(params["sensor_range"])
    if "sensor_fov_deg" in params:
        sim_engine.settings.sensor_fov_deg = float(params["sensor_fov_deg"])
    if "initial_landmark_cov" in params:
        sim_engine.ekf.initial_landmark_cov = float(params["initial_landmark_cov"])
        sim_engine.settings.initial_landmark_cov = float(params["initial_landmark_cov"])
        
    # Also save to config file
    save_settings(sim_engine.settings)
    return {"status": "success", "settings": sim_engine.settings.model_dump()}

@app.post("/api/history/save")
def save_run(run: SavedRun):
    """Saves a simulation run's metrics to local JSON history."""
    runs = get_run_history()
    runs.append(run.model_dump())
    save_run_history(runs)
    return {"status": "success", "count": len(runs)}

@app.get("/api/history/runs")
def get_runs():
    """Retrieves all saved simulation runs."""
    return get_run_history()

@app.post("/api/history/clear")
def clear_runs():
    """Clears all saved simulation runs from the backend."""
    save_run_history([])
    return {"status": "success"}

async def broadcast_state(state: dict):
    for connection in active_connections:
        try:
            await connection.send_json(state)
        except Exception:
            pass

async def simulation_loop():
    global sim_engine, is_playing, playback_speed
    try:
        while is_playing and sim_engine is not None:
            # Advance simulation step
            state = sim_engine.step()
            
            # Send latest state to all active WebSockets
            await broadcast_state({
                "type": "state",
                "data": state
            })
            
            # Sleep based on dt and speed
            # nominal dt is 0.1s. 1x speed => sleep 0.1s
            # 2x speed => sleep 0.05s
            sleep_time = max(0.005, sim_engine.settings.dt / playback_speed)
            await asyncio.sleep(sleep_time)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Error in simulation loop: {e}")
        is_playing = False

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global is_playing, playback_task, playback_speed, sim_engine
    await websocket.accept()
    active_connections.append(websocket)
    
    # Send initial config to the connection
    if sim_engine is None:
        init_sim()
    
    try:
        # Send initial state
        await websocket.send_json({
            "type": "config",
            "data": {
                "settings": sim_engine.settings.model_dump(),
                "landmarks_true": sim_engine.landmarks_true.tolist(),
                "track_points": sim_engine.track.points.tolist()
            }
        })
        
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            msg_type = message.get("type")
            
            if msg_type == "play":
                is_playing = True
                if playback_task is None or playback_task.done():
                    playback_task = asyncio.create_task(simulation_loop())
                await websocket.send_json({"type": "status", "data": {"is_playing": True}})
                
            elif msg_type == "pause":
                is_playing = False
                if playback_task:
                    playback_task.cancel()
                    playback_task = None
                await websocket.send_json({"type": "status", "data": {"is_playing": False}})
                
            elif msg_type == "step":
                if sim_engine:
                    state = sim_engine.step()
                    await websocket.send_json({"type": "state", "data": state})
                    
            elif msg_type == "set_speed":
                playback_speed = float(message.get("value", 1.0))
                await websocket.send_json({"type": "status", "data": {"speed": playback_speed}})
                
            elif msg_type == "reset":
                is_playing = False
                if playback_task:
                    playback_task.cancel()
                    playback_task = None
                
                # Get current config params to preserve them on reset
                current_params = sim_engine.settings.model_dump() if sim_engine else None
                init_sim()
                
                # Broadcast the reset configurations and new state
                await broadcast_state({
                    "type": "reset",
                    "data": {
                        "settings": sim_engine.settings.model_dump(),
                        "landmarks_true": sim_engine.landmarks_true.tolist(),
                        "track_points": sim_engine.track.points.tolist()
                    }
                })
                
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        if len(active_connections) == 0:
            is_playing = False
            if playback_task:
                playback_task.cancel()
                playback_task = None
