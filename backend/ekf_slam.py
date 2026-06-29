import numpy as np
from typing import List, Tuple, Dict, Any

class EKFSlam:
    def __init__(self, Q_velocity_std: float = 0.05, Q_omega_std: float = 0.05, sig_lm: float = 0.01, initial_landmark_cov: float = 10.0):
        # State vector: [x, y, theta]
        self.x = np.array([1.5, 1.5, np.pi / 2.0], dtype=float)
        # State covariance
        self.P = np.eye(3, dtype=float) * 0.0001
        
        # Noise parameters
        self.Q_velocity_std = Q_velocity_std
        self.Q_omega_std = Q_omega_std
        self.sig_lm = sig_lm
        self.initial_landmark_cov = initial_landmark_cov
        
        # Mapping from landmark ID to its index in the state vector.
        # State vector structure: [x_r, y_r, theta_r, l1_x, l1_y, l2_x, l2_y, ...]
        # idx2num contains the landmark IDs in the order they were discovered.
        # Landmark ID at idx2num[i] corresponds to state index 3 + 2*i and 3 + 2*i + 1
        self.idx2num: List[int] = []

    @property
    def Q_0(self) -> np.ndarray:
        """Process noise covariance for inputs [v, omega]."""
        return np.diag([self.Q_velocity_std ** 2, self.Q_omega_std ** 2])

    def predict(self, dt: float, lin_velocity: float, ang_velocity: float) -> None:
        """
        Perform the EKF prediction step.
        Updates state and covariance estimates using the input velocities.
        """
        x_r, y_r, theta = self.x[0], self.x[1], self.x[2]
        
        # Number of states
        N = len(self.x)
        
        # 1. State Jacobian A (w.r.t state vector x)
        A = np.eye(N)
        A[0, 2] = -dt * lin_velocity * np.sin(theta)
        A[1, 2] = dt * lin_velocity * np.cos(theta)
        
        # 2. Input Jacobian B (w.r.t control inputs [v, omega])
        B = np.zeros((N, 2))
        B[0, 0] = dt * np.cos(theta)
        B[1, 0] = dt * np.sin(theta)
        B[2, 1] = dt
        
        # 3. Covariance prediction: P = A * P * A.T + B * Q_0 * B.T
        self.P = A @ self.P @ A.T + B @ self.Q_0 @ B.T
        
        # 4. State prediction (Unicycle kinematics)
        self.x[0] = x_r + dt * np.cos(theta) * lin_velocity
        self.x[1] = y_r + dt * np.sin(theta) * lin_velocity
        self.x[2] = theta + dt * ang_velocity
        
        # Normalize theta to [-pi, pi]
        self.x[2] = (self.x[2] + np.pi) % (2.0 * np.pi) - np.pi

    def update(self, ids: List[int], z: np.ndarray) -> None:
        """
        Perform EKF correction/innovation step.
        ids: List of observed landmark IDs.
        z: Observed body-frame landmark coordinates [z1_x, z1_y, z2_x, z2_y, ...] (1D array of shape 2*M)
        """
        if len(ids) == 0:
            return

        # 1. Augment state vector with any newly seen landmarks
        new_ids = [i for i in ids if i not in self.idx2num]
        if new_ids:
            self._add_new_landmarks(ids, z)

        # Current robot pose estimate
        x_h, y_h, theta_h = self.x[0], self.x[1], self.x[2]
        
        M = len(ids)
        N = len(self.x)
        
        z_hat = np.zeros(M * 2)
        C = np.zeros((M * 2, N))
        
        for c, curr_id in enumerate(ids):
            # Find landmark's index in the state vector
            lm_idx = self.idx2num.index(curr_id)
            idx_x = 3 + lm_idx * 2
            idx_y = idx_x + 1
            
            lx_i = self.x[idx_x]
            ly_i = self.x[idx_y]
            
            # Expected measurement in robot body frame: R(theta)^T * (p_lm - p_robot)
            # which matches the MATLAB implementation:
            z_i = np.array([
                -np.cos(theta_h) * (x_h - lx_i) - np.sin(theta_h) * (y_h - ly_i),
                np.sin(theta_h) * (x_h - lx_i) - np.cos(theta_h) * (y_h - ly_i)
            ])
            z_hat[2 * c : 2 * c + 2] = z_i
            
            # Jacobian w.r.t robot x, y
            C[2 * c : 2 * c + 2, 0:2] = np.array([
                [-np.cos(theta_h), -np.sin(theta_h)],
                [np.sin(theta_h),  np.cos(theta_h)]
            ])
            
            # Jacobian w.r.t robot theta
            C[2 * c : 2 * c + 2, 2] = np.array([
                np.sin(theta_h) * (x_h - lx_i) - np.cos(theta_h) * (y_h - ly_i),
                np.cos(theta_h) * (x_h - lx_i) + np.sin(theta_h) * (y_h - ly_i)
            ])
            
            # Jacobian w.r.t landmark coordinates
            C[2 * c : 2 * c + 2, idx_x:idx_y+1] = np.array([
                [np.cos(theta_h),  np.sin(theta_h)],
                [-np.sin(theta_h), np.cos(theta_h)]
            ])
            
        # Measurement noise covariance matrix R
        R = np.eye(M * 2) * self.sig_lm
        
        # Kalman Gain: K = P * C.T * inv(C * P * C.T + R)
        S = C @ self.P @ C.T + R
        try:
            K = self.P @ C.T @ np.linalg.inv(S)
        except np.linalg.LinAlgError:
            # Fallback in case of singular matrix
            K = self.P @ C.T @ np.linalg.pinv(S)
            
        # Update covariance matrix: P = (I - K * C) * P
        I_mat = np.eye(N)
        # Using Joseph form for numerical stability: P = (I - KC) P (I - KC)^T + K R K^T
        IKC = I_mat - K @ C
        self.P = IKC @ self.P @ IKC.T + K @ R @ K.T
        
        # Update state: x = x - K * (z_hat - z) -> matches EKF: x = x + K * (z - z_hat)
        innovation = z - z_hat
        self.x = self.x + K @ innovation
        
        # Normalize theta to [-pi, pi]
        self.x[2] = (self.x[2] + np.pi) % (2.0 * np.pi) - np.pi

    def _add_new_landmarks(self, ids: List[int], z: np.ndarray) -> None:
        """
        Augment the state vector and covariance matrix with newly observed landmarks.
        """
        x_h, y_h, theta_h = self.x[0], self.x[1], self.x[2]
        
        old_len = len(self.x)
        # Find which IDs are new
        new_ids = [i for i in ids if i not in self.idx2num]
        
        # Expand state vector
        new_state = np.zeros(old_len + len(new_ids) * 2)
        new_state[:old_len] = self.x
        
        # Expand covariance matrix
        new_cov = np.eye(old_len + len(new_ids) * 2)
        new_cov[:old_len, :old_len] = self.P
        
        for c, curr_id in enumerate(new_ids):
            # Find the position of this landmark in the measurements array
            idx = ids.index(curr_id)
            z_i = z[idx * 2 : idx * 2 + 2]
            
            # Compute estimated global coordinates of this landmark
            lx = x_h + np.cos(theta_h) * z_i[0] - np.sin(theta_h) * z_i[1]
            ly = y_h + np.sin(theta_h) * z_i[0] + np.cos(theta_h) * z_i[1]
            
            # Place in state vector
            new_state[old_len + 2 * c] = lx
            new_state[old_len + 2 * c + 1] = ly
            
            # Add to index mapping
            self.idx2num.append(curr_id)
            
            # Initialize uncertainty for this landmark
            new_cov[old_len + 2 * c : old_len + 2 * c + 2, old_len + 2 * c : old_len + 2 * c + 2] = np.eye(2) * self.initial_landmark_cov
            
        self.x = new_state
        self.P = new_cov

    def output_robot(self) -> Tuple[np.ndarray, np.ndarray]:
        """Returns the robot state [x, y, theta] and its 3x3 covariance matrix."""
        return self.x[:3], self.P[:3, :3]

    def output_landmarks(self) -> Tuple[np.ndarray, np.ndarray]:
        """Returns the landmark state vector [lx1, ly1, ...] and its covariance matrix."""
        return self.x[3:], self.P[3:, 3:]
        
    def get_landmark_positions(self) -> Dict[int, Dict[str, Any]]:
        """Helper to get a dictionary of estimated landmark positions and their 2x2 covariances."""
        landmarks = {}
        for idx, lmk_id in enumerate(self.idx2num):
            x_idx = 3 + 2 * idx
            y_idx = x_idx + 1
            landmarks[lmk_id] = {
                "x": self.x[x_idx],
                "y": self.x[y_idx],
                "cov": self.P[x_idx:y_idx+1, x_idx:y_idx+1].tolist()
            }
        return landmarks
