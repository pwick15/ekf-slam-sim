import json
import os
from pathlib import Path
from pydantic import BaseModel, Field

# Base directory for the project
BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config" / "parameters.json"

class SimSettings(BaseModel):
    # Timestep
    dt: float = Field(default=0.1, description="Simulation timestep in seconds")
    
    # Process Noise (commanded velocity and angular rate)
    Q_velocity_std: float = Field(default=0.05, description="Standard deviation of process noise for linear velocity (m/s)")
    Q_omega_std: float = Field(default=0.05, description="Standard deviation of process noise for angular velocity (rad/s)")
    
    # Controller noise (noise injected on the steering control output)
    steer_noise_std: float = Field(default=0.02, description="Standard deviation of steering controller perturbation (rad/s)")
    
    # Sensor Parameters
    sensor_range: float = Field(default=4.0, description="Maximum detection range of the landmark sensor (meters)")
    sensor_fov_deg: float = Field(default=180.0, description="Total field of view of the sensor in degrees")
    
    # Measurement Noise
    sig_lm: float = Field(default=0.01, description="Measurement noise covariance scalar (used for both x and y in body frame)")
    
    # Initial Landmark Covariance
    initial_landmark_cov: float = Field(default=10.0, description="Initial diagonal uncertainty assigned to a newly discovered landmark")
    
    # Vehicle parameters
    vehicle_speed: float = Field(default=1.0, description="Nominal linear velocity of the ground rover (m/s)")
    
    # Simulation layout
    num_landmarks: int = Field(default=16, description="Number of landmarks to place in the environment")
    landmark_seed: int = Field(default=42, description="Random seed for landmark placement reproducibility")

def load_settings() -> SimSettings:
    """Loads the settings from config/parameters.json or returns default settings if not found."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)
            return SimSettings(**data)
        except Exception as e:
            print(f"Error loading parameters.json: {e}. Using defaults.")
    return SimSettings()

def save_settings(settings: SimSettings) -> None:
    """Saves the current settings back to config/parameters.json."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(settings.model_dump(), f, indent=2)

# Global settings instance
settings = load_settings()
