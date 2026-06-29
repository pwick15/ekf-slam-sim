import numpy as np
from typing import List, Tuple, Dict
from backend.config import SimSettings
from backend.ekf_slam import EKFSlam

class Track:
    def __init__(self, track_type: str = "city_zigzag", num_points: int = 400):
        self.track_type = track_type
        self.num_points = num_points
        self.points = self._generate_track_points()

    def _generate_track_points(self) -> np.ndarray:
        """Generates a closed-loop track as a 2D numpy array of shape (N, 2)."""
        t = np.linspace(0, 2 * np.pi, self.num_points, endpoint=False)
        points = []

        if self.track_type == "oval":
            # An oval track in [0.5, 4.5] x [0.5, 4.5]
            # Center at (2.5, 2.5), radii 1.8 and 1.3
            x = 2.5 + 1.8 * np.cos(t)
            y = 2.5 + 1.3 * np.sin(t)
            points = np.column_stack((x, y))

        elif self.track_type == "figure_8":
            # A figure-8 (lemniscate of Bernoulli) centered at (2.5, 2.5)
            # Scaled to fit within [0.7, 4.3]
            scale = 1.8
            x = 2.5 + (scale * np.cos(t)) / (1 + np.sin(t)**2)
            y = 2.5 + (scale * np.sin(t) * np.cos(t)) / (1 + np.sin(t)**2)
            points = np.column_stack((x, y))

        elif self.track_type == "s_curve":
            # An S-shaped winding track that wraps back on itself in a closed loop
            # Built by morphing a circle with high-frequency sine waves
            r = 1.4 + 0.4 * np.sin(3 * t)
            x = 2.5 + r * np.cos(t)
            y = 2.5 + r * np.sin(t)
            points = np.column_stack((x, y))

        elif self.track_type == "city_zigzag":
            # A zigzag track with sharp 90-degree corners
            # We define waypoints and interpolate between them to make a continuous track
            waypoints = np.array([
                [1.0, 1.0],
                [4.0, 1.0],
                [4.0, 2.5],
                [2.5, 2.5],
                [2.5, 4.0],
                [1.0, 4.0],
                [1.0, 2.5],
                [1.0, 1.0] # Close the loop
            ])
            # Interpolate between waypoints to get a dense set of points
            pts_per_segment = self.num_points // (len(waypoints) - 1)
            interpolated = []
            for i in range(len(waypoints) - 1):
                seg = np.linspace(waypoints[i], waypoints[i+1], pts_per_segment, endpoint=False)
                interpolated.append(seg)
            points = np.vstack(interpolated)

        else:
            # Fallback to simple circle
            x = 2.5 + 1.5 * np.cos(t)
            y = 2.5 + 1.5 * np.sin(t)
            points = np.column_stack((x, y))

        return points

    def get_closest_point_index(self, pos: np.ndarray) -> int:
        """Finds index of the track point closest to position pos."""
        dists = np.linalg.norm(self.points - pos, axis=1)
        return int(np.argmin(dists))

    def get_lookahead_point(self, pos: np.ndarray, lookahead_dist: float = 0.5) -> np.ndarray:
        """Finds a target point on the track ahead of the current position."""
        closest_idx = self.get_closest_point_index(pos)
        
        # Traverse forward along the track points until we exceed the lookahead distance
        n = len(self.points)
        accum_dist = 0.0
        curr_idx = closest_idx
        
        while accum_dist < lookahead_dist:
            next_idx = (curr_idx + 1) % n
            accum_dist += np.linalg.norm(self.points[next_idx] - self.points[curr_idx])
            curr_idx = next_idx
            if curr_idx == closest_idx: # Prevent infinite loop if track is tiny
                break
                
        return self.points[curr_idx]


class SimulationEngine:
    def __init__(self, settings: SimSettings):
        self.settings = settings
        self.track = Track(track_type=settings.track_type)
        
        # Generate landmarks
        self.landmarks_true = self._generate_landmarks()
        
        # Initialize ground truth robot state: [x, y, theta]
        # Start near the first point of the track
        start_pos = self.track.points[0]
        # Find heading toward the next point
        next_pos = self.track.points[1]
        start_theta = np.atan2(next_pos[1] - start_pos[1], next_pos[0] - start_pos[0])
        
        self.gt_x = np.array([start_pos[0], start_pos[1], start_theta], dtype=float)
        
        # Initialize EKF filter
        self.ekf = EKFSlam(
            Q_velocity_std=settings.Q_velocity_std,
            Q_omega_std=settings.Q_omega_std,
            sig_lm=settings.sig_lm,
            initial_landmark_cov=settings.initial_landmark_cov
        )
        # EKF starts at ground truth position with small error
        self.ekf.x = self.gt_x.copy()
        self.ekf.P = np.eye(3, dtype=float) * 0.0001
        
        # History buffers
        self.history_gt: List[List[float]] = [self.gt_x.tolist()]
        self.history_ekf: List[List[float]] = [self.ekf.x[:3].tolist()]
        self.timestep = 0

    def _generate_landmarks(self) -> np.ndarray:
        """Generates ground truth landmark coordinates."""
        # Using the same grid placement as the MATLAB simulation if seed/count match default,
        # or seeded random distribution.
        np.random.seed(self.settings.landmark_seed)
        
        if self.settings.num_landmarks == 16:
            # Match MATLAB: 4x4 grid in [0.5, 4.5]
            vals = np.linspace(0.5, 4.5, 4)
            lmx, lmy = np.meshgrid(vals, vals)
            landmarks = np.column_stack((lmx.flatten(), lmy.flatten()))
        else:
            # Seeded random landmarks inside [0.5, 4.5]
            landmarks = np.random.uniform(0.5, 4.5, (self.settings.num_landmarks, 2))
            
        return landmarks

    def run_controller(self) -> float:
        """
        Runs line-following controller (Pure Pursuit).
        Returns ideal steering command (omega) in rad/s.
        """
        pos = self.gt_x[:2]
        theta = self.gt_x[2]
        
        # Lookahead point
        lookahead = self.track.get_lookahead_point(pos, lookahead_dist=0.6)
        
        # Angle to target point
        target_angle = np.atan2(lookahead[1] - pos[1], lookahead[0] - pos[0])
        angle_diff = target_angle - theta
        
        # Normalize to [-pi, pi]
        angle_diff = (angle_diff + np.pi) % (2.0 * np.pi) - np.pi
        
        # Proportional controller for steering
        kp = 3.5
        omega_ideal = kp * angle_diff
        
        # Cap maximum angular velocity to keep simulation realistic
        omega_ideal = np.clip(omega_ideal, -2.5, 2.5)
        
        return float(omega_ideal)

    def step(self) -> Dict[str, any]:
        """
        Advance the simulation by one timestep dt.
        Performs noise injection, kinematics update, sensor scan, and EKF update.
        """
        dt = self.settings.dt
        
        # 1. Run controller to get commanded angular velocity
        omega_ideal = self.run_controller()
        
        # Inject controller noise (noisy line-following steering execution)
        steer_noise = np.random.normal(0.0, self.settings.steer_noise_std)
        omega_cmd = omega_ideal + steer_noise
        v_cmd = self.settings.vehicle_speed
        
        # 2. Actuation process noise (actual physical movement drifts from commanded)
        v_noise = np.random.normal(0.0, self.settings.Q_velocity_std)
        omega_noise = np.random.normal(0.0, self.settings.Q_omega_std)
        v_act = v_cmd + v_noise
        omega_act = omega_cmd + omega_noise
        
        # 3. Update ground truth robot state (unicycle kinematics)
        gt_x, gt_y, gt_theta = self.gt_x[0], self.gt_x[1], self.gt_x[2]
        self.gt_x[0] = gt_x + dt * np.cos(gt_theta) * v_act
        self.gt_x[1] = gt_y + dt * np.sin(gt_theta) * v_act
        self.gt_x[2] = gt_theta + dt * omega_act
        self.gt_x[2] = (self.gt_x[2] + np.pi) % (2.0 * np.pi) - np.pi
        
        # Save to history
        self.history_gt.append(self.gt_x.tolist())
        
        # 4. EKF Prediction step (uses commanded/odometry inputs, NOT actual physical ones)
        self.ekf.predict(dt, v_cmd, omega_cmd)
        
        # 5. Sensor scan (observe landmarks within range and FOV)
        observed_ids, observed_measurements = self.sensor_scan()
        
        # 6. EKF Update step
        self.ekf.update(observed_ids, observed_measurements)
        self.history_ekf.append(self.ekf.x[:3].tolist())
        
        self.timestep += 1
        
        # Compute metrics
        pos_error = float(np.linalg.norm(self.gt_x[:2] - self.ekf.x[:2]))
        cov_trace = float(np.trace(self.ekf.P[:3, :3]))
        landmark_rmse = self.compute_landmark_rmse()
        
        return {
            "timestep": self.timestep,
            "gt_pose": self.gt_x.tolist(),
            "ekf_pose": self.ekf.x[:3].tolist(),
            "ekf_cov": self.ekf.P[:3, :3].tolist(),
            "observed_ids": observed_ids,
            "landmarks": self.ekf.get_landmark_positions(),
            "metrics": {
                "pos_error": pos_error,
                "cov_trace": cov_trace,
                "landmark_rmse": landmark_rmse
            }
        }

    def sensor_scan(self) -> Tuple[List[int], np.ndarray]:
        """
        Scans environment for visible landmarks.
        Injects Gaussian measurement noise on relative body-frame coordinates.
        Returns:
            List of observed landmark IDs
            1D array of observed coordinates [z1_x, z1_y, z2_x, z2_y, ...]
        """
        pos = self.gt_x[:2]
        theta = self.gt_x[2]
        
        observed_ids = []
        measurements = []
        
        # Body to global rotation matrix: R = [cos(theta), -sin(theta); sin(theta), cos(theta)]
        # Inverse rotation (global to body): R^T = [cos(theta), sin(theta); -sin(theta), cos(theta)]
        cos_t, sin_t = np.cos(theta), np.sin(theta)
        R_T = np.array([
            [cos_t, sin_t],
            [-sin_t, cos_t]
        ])
        
        fov_rad = np.radians(self.settings.sensor_fov_deg)
        
        for idx, lmk in enumerate(self.landmarks_true):
            rel_global = lmk - pos
            dist = np.linalg.norm(rel_global)
            
            # Check sensor range
            if dist > self.settings.sensor_range:
                continue
                
            # Check FOV (angle of relative vector compared to heading theta)
            angle_to_lmk = np.atan2(rel_global[1], rel_global[0])
            angle_diff = angle_to_lmk - theta
            # Normalize to [-pi, pi]
            angle_diff = (angle_diff + np.pi) % (2.0 * np.pi) - np.pi
            
            # If within sensor FOV cone
            if abs(angle_diff) <= (fov_rad / 2.0):
                observed_ids.append(idx)
                
                # Transform to body frame
                rel_body = R_T @ rel_global
                
                # Inject Gaussian measurement noise
                noise_x = np.random.normal(0.0, np.sqrt(self.settings.sig_lm))
                noise_y = np.random.normal(0.0, np.sqrt(self.settings.sig_lm))
                
                measurements.extend([rel_body[0] + noise_x, rel_body[1] + noise_y])
                
        return observed_ids, np.array(measurements)

    def compute_landmark_rmse(self) -> float:
        """
        Computes the standard RMSE between true landmark positions and EKF estimates.
        If no landmarks are discovered yet, returns 0.0.
        """
        if not self.ekf.idx2num:
            return 0.0
            
        sq_errors = []
        for idx, lmk_id in enumerate(self.ekf.idx2num):
            true_pos = self.landmarks_true[lmk_id]
            x_idx = 3 + 2 * idx
            y_idx = x_idx + 1
            est_pos = np.array([self.ekf.x[x_idx], self.ekf.x[y_idx]])
            sq_errors.append(np.sum((true_pos - est_pos) ** 2))
            
        return float(np.sqrt(np.mean(sq_errors)))
        
    def compute_armse(self) -> float:
        """
        Computes the Alignment-corrected RMSE (aRMSE) using SVD Procrustes alignment.
        This matches the MATLAB code (aRMSE.m).
        """
        n = len(self.ekf.idx2num)
        if n < 2:
            return 0.0
            
        # Get true and estimated matrices of shape (2, n)
        true_pts = np.zeros((2, n))
        est_pts = np.zeros((2, n))
        
        for idx, lmk_id in enumerate(self.ekf.idx2num):
            true_pts[:, idx] = self.landmarks_true[lmk_id]
            x_idx = 3 + 2 * idx
            est_pts[:, idx] = self.ekf.x[x_idx:x_idx+2]
            
        # Calculate centroids
        mu_true = np.mean(true_pts, axis=1, keepdims=True)
        mu_est = np.mean(est_pts, axis=1, keepdims=True)
        
        # Center points
        true_centered = true_pts - mu_true
        est_centered = est_pts - mu_est
        
        # Compute covariance matrix Sigma = 1/N * (true_centered @ est_centered^T)
        Sigma = (true_centered @ est_centered.T) / n
        
        # SVD of Sigma
        try:
            U, D, V_T = np.linalg.svd(Sigma)
            # Note: numpy SVD returns V^T. In MATLAB it was [U,D,V] = svd(Sigma), which is the standard mathematical SVD.
            # V in MATLAB is V_T.T in Python.
            V = V_T.T
            
            # Check reflection
            if np.linalg.det(Sigma) >= 0:
                A = np.eye(2)
            else:
                A = np.diag([1, -1])
                
            # Rotation matrix: R_S = V * A * U^T
            R_S = V @ A @ U.T
            # Translation vector: x_S = mu_est - R_S @ mu_true
            x_S = mu_est - R_S @ mu_true
            
            # Compute aRMSE sum: norm( R_S^T * (est_pos - x_S) - true_pos )^2
            armse_sum = 0.0
            for i in range(n):
                est_i = est_pts[:, i:i+1]
                true_i = true_pts[:, i:i+1]
                aligned_est = R_S.T @ (est_i - x_S)
                armse_sum += np.linalg.norm(aligned_est - true_i) ** 2
                
            return float(np.sqrt(armse_sum / n))
        except Exception:
            return 0.0
