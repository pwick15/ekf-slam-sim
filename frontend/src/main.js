import { CoordinateTransformer } from './math.js';
import { TopDownRenderer } from './renderer.js';
import { UIManager } from './ui.js';
import { MathExplorer } from './math_explorer.js';
import { TutorialManager } from './tutorial.js';

// Configuration
const HOST = window.location.hostname;
const PORT = 8000;
const BACKEND_URL = `http://${HOST}:${PORT}`;
const WS_URL = `ws://${HOST}:${PORT}/ws`;

// Global State
let socket = null;
let currentSettings = null;
let currentGroundTruthPose = null;
let currentEKFPose = null;
let currentEKFCovariance = null;
let observedLandmarkIds = [];
let estimatedLandmarks = {};
let trueLandmarks = [];
let socketIsPlaying = false;
let trackPoints = [];

// Paths trails
let gtTrail = [];
let ekfTrail = [];

// Session metric history for the CURRENT run
let lastMetrics = { pos_error: 0, landmark_rmse: 0, cov_trace: 0 };

// Canvas & coordinate transformer
const canvas = document.getElementById('sim-canvas');
const transformer = new CoordinateTransformer(canvas);
const renderer = new TopDownRenderer(canvas, transformer);

// Math Explorer
const mathExplorer = new MathExplorer('math-explorer', BACKEND_URL);

// Tutorial Manager
const tutorialManager = new TutorialManager({
  onOpen: () => {
    sendWsMessage({ type: 'pause' });
  }
});

// UI Manager Callbacks
const uiCallbacks = {
  onPlay: () => {
    sendWsMessage({ type: 'play' });
  },
  onPause: () => {
    sendWsMessage({ type: 'pause' });
  },
  onStep: () => {
    sendWsMessage({ type: 'step' });
  },
  onReset: () => {
    sendWsMessage({ type: 'reset' });
    resetTrails();
  },
  onSpeedChange: (speed) => {
    sendWsMessage({ type: 'set_speed', value: speed });
  },
  onRestart: async (config) => {
    // Restart simulation on backend with new settings
    try {
      const response = await fetch(`${BACKEND_URL}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (response.ok) {
        const data = await response.json();
        // Clear paths trails
        resetTrails();
        console.log("Simulation restarted with new config");
      }
    } catch (e) {
      console.error("Error restarting simulation:", e);
    }
  },
  onParamUpdate: async (params) => {
    // Dynamically update EKF parameters on the fly
    try {
      await fetch(`${BACKEND_URL}/api/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
    } catch (e) {
      console.error("Error updating parameters:", e);
    }
  },
  onRecenter: () => {
    transformer.fitToWorkspace();
  }
};

const uiManager = new UIManager(uiCallbacks);

// Initial Canvas Setup & Scaling
function resizeCanvas() {
  const rect = canvas.parentNode.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  
  // Update coordinate scaling parameters
  transformer.updateScale();
}

function resetTrails() {
  gtTrail = [];
  ekfTrail = [];
  uiManager.resetHistory();
}

function sendWsMessage(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

// WebSocket Connection
function connectWebSocket() {
  socket = new WebSocket(WS_URL);
  
  socket.onopen = () => {
    console.log("WebSocket connected to EKF server");
  };
  
  socket.onclose = () => {
    console.log("WebSocket connection closed, retrying in 3s...");
    setTimeout(connectWebSocket, 3000);
  };
  
  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
  
  socket.onmessage = (event) => {
    const message = jsonParse(event.data);
    if (!message) return;
    
    if (message.type === 'config' || message.type === 'reset') {
      const data = message.data;
      currentSettings = data.settings;
      trueLandmarks = data.landmarks_true;
      trackPoints = data.track_points;
      
      // Update transformer boundaries to auto-zoom inside track space
      transformer.fitToWorkspace();
      
      uiManager.syncConfig(currentSettings, trueLandmarks.length);
      resetTrails();
      
    } else if (message.type === 'state') {
      const data = message.data;
      
      // Extract position states
      currentGroundTruthPose = data.gt_pose;
      currentEKFPose = data.ekf_pose;
      currentEKFCovariance = data.ekf_cov;
      observedLandmarkIds = data.observed_ids;
      estimatedLandmarks = data.landmarks;
      
      // Store trajectories trail
      gtTrail.push(data.gt_pose.slice(0, 2));
      ekfTrail.push(data.ekf_pose.slice(0, 2));
      
      // Capture run metrics history
      lastMetrics = data.metrics;
      
      // Limit trail drawing sizes to last 2000 points
      if (gtTrail.length > 2000) gtTrail.shift();
      if (ekfTrail.length > 2000) ekfTrail.shift();
      
      // Update sidebar telemetry panel
      uiManager.updateMetrics(data);
      
      // Educational view update when stepping or paused
      if (!socketIsPlaying && !document.getElementById('math-explorer').classList.contains('hidden')) {
        mathExplorer.fetchMathState();
      }
      
    } else if (message.type === 'status') {
      const data = message.data;
      if (data.is_playing !== undefined) {
        socketIsPlaying = data.is_playing;
        uiManager.updateStatus(data.is_playing);
      }
    }
  };
}

function jsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// RequestAnimationFrame Rendering Loop
function drawFrame() {
  renderer.clear();
  
  // Render track centerline road
  renderer.drawTrack(trackPoints);
  
  // Render path trails
  renderer.drawTrails(gtTrail, ekfTrail);
  
  // Render true landmarks & estimated landmark circles/ellipses
  renderer.drawLandmarks(trueLandmarks, estimatedLandmarks, observedLandmarkIds);
  
  // Render vehicle icons, FOV arc, and observation connection lines
  renderer.drawVehicle(
    currentGroundTruthPose, 
    currentEKFPose, 
    currentEKFCovariance,
    currentSettings ? currentSettings.sensor_range : 4.0,
    currentSettings ? currentSettings.sensor_fov_deg : 180.0,
    trueLandmarks,
    observedLandmarkIds
  );
  
  requestAnimationFrame(drawFrame);
}

// Initializer
async function init() {
  window.addEventListener('resize', resizeCanvas);
  
  // Theme initialization
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  if (btnToggleTheme) {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
    }
    btnToggleTheme.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      
      // Refresh math matrices shading!
      mathExplorer.renderMatrixGrid();
    });
  }
  
  // Trigger initial canvas size calculation
  resizeCanvas();
  transformer.fitToWorkspace();
  
  // Setup WebSocket connection
  connectWebSocket();
  

  // Start drawing frames
  requestAnimationFrame(drawFrame);
}

init();
