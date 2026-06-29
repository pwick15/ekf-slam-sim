# Premium EKF-SLAM Interactive 2D Simulator

An aesthetically stunning, real-time web-based simulation of the **Extended Kalman Filter for Simultaneous Localization and Mapping (EKF-SLAM)**. Ported and heavily revamped from a MATLAB robotic control codebase, this simulator models a ground rover traversing a course, following a track, and detecting landmarks to map its environment and estimate its pose under process and measurement noise.

---

## Core Features (Beyond the Obvious)

*   **Bilateral Noise Modeling (Gaussian)**:
    *   *Actuation Process Noise ($Q$)*: The ground truth vehicle kinematics are perturbed by Gaussian noise on commanded linear velocity ($v$) and angular velocity ($\omega$). The EKF only has access to the *commanded* (noisy) inputs, mirroring real-world encoder/odometry limits.
    *   *Controller steering noise ($\sigma_{steer}$)*: Steering controls are injected with noise to simulate imperfect track-line detection.
    *   *Measurement sensor noise ($R$)*: Body-frame relative scans of landmarks are corrupted by configurable Gaussian distance and bearing errors.
*   **SVD-Based Procrustes Map Alignment (aRMSE)**:
    Since SLAM trajectories are susceptible to global coordinate drift over time (as absolute position is unobservable), standard RMSE is misleading. The simulator integrates Singular Value Decomposition (SVD) to find the optimal rotation and translation that aligns the estimated landmark coordinates onto the true map, yielding an **Alignment-corrected RMSE (aRMSE)**.
*   **Historical Configuration Benchmarking**:
    A run history database saves parameter setups alongside error logs, allowing you to run the vehicle under various process/sensor configurations and overlay their tracking error curves to benchmark convergence rates.
*   **Dual-State Vector Augmentation**:
    Real-time resizing of the filter's state vector $x$ and covariance matrix $P$ as new landmarks enter the vehicle's field of view.

---

## Tech Stack & Architectural Decisions

*   **Backend**: Python 3.10+, built using **FastAPI** and **NumPy**. The math of the prediction, update, and state augmentation remains centralized in Python. This ensures that the equations exactly replicate the original MATLAB kinematics while utilizing WebSocket streaming to serve high-frequency state packets (up to 40Hz).
*   **Frontend**: Built with **Vite** and **Vanilla Javascript**.
*   **Visualizer**: High-performance **HTML Canvas 2D**. Features automated anti-aliasing scaling for high-DPI (Retina) screens, smooth drag-to-pan, and mouse wheel zoom.
*   **Modular Rendering Architecture**: The renderer is decoupled from the UI and simulation loops. It uses a structured interface in `renderer.js`, making it future-proof for swapping in a Three.js-based 3D viewport.
*   **Custom Charting Engine**: Telemetry sparklines and comparison charts are drawn dynamically using Canvas2D in `ui.js`, avoiding external heavy library bundles.

---

## 🚀 Setup & Installation

### 1. Backend Installation (Python)

Ensure you have Astral `uv` installed. If not, install it via:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Initialize the environment and install backend dependencies:
```bash
# From the project root (ekf-slam-sim/)
uv venv --python <path_to_your_python_interpreter>
# Install packages
uv pip install -r backend/requirements.txt
```

Run the FastAPI server:
```bash
.venv/bin/uvicorn backend.server:app --reload --port 8000
```

### 2. Frontend Installation (Node.js)

Install Vite and run the dev server:
```bash
# Navigate to the frontend directory
cd frontend
npm install
npm run dev
```

Open your browser at [http://localhost:5173](http://localhost:5173) to see the simulator in action!

---

## Visualizer Legend & Guide

*   **Cyan Trail / Car**: Ground Truth (actual physical state of the rover).
*   **Amber Trail / Car**: EKF Pose Estimate and its $2\sigma$ ($95\%$) uncertainty ellipse.
*   **Green Diamonds**: True coordinate locations of the landmarks.
*   **Amber Rings / Ellipses**: Estimated positions of discovered landmarks and their surrounding covariance ellipses.
*   **Transparent Arc**: The active sensor field of view (FOV).
*   **Connecting Rays**: Active sensor scans locking onto landmarks.
