# Extended Kalman Filter SLAM (EKF-SLAM) Refresher

This document provides a mathematical refresher on the Extended Kalman Filter (EKF) applied to the Simultaneous Localization and Mapping (SLAM) problem in a two-dimensional plane. It is written for developers and engineers who have a solid foundation in mathematics and robotics but need a quick, rigorous refresher.

---

## 1. Problem Formulation & State Representation

The goal of 2D EKF-SLAM is to jointly estimate the state of a mobile robot (pose) and the positions of landmarks (map) in a common global reference frame.

### The Augmented State Vector
The state vector $x_k$ at time step $k$ is augmented to contain both the 3-DOF robot pose and the 2D coordinates of $N$ discovered landmarks:

$$
x_k = \begin{bmatrix}
x_r \\
y_r \\
\theta \\
l_1^x \\
l_1^y \\
\vdots \\
l_N^x \\
l_N^y
\end{bmatrix} \in \mathbb{R}^{3 + 2N}
$$

where:
*   $(x_r, y_r)$ represents the robot's position.
*   $\theta$ is the robot's heading angle (yaw).
*   $(l_i^x, l_i^y)$ represents the coordinates of the $i$-th landmark in the global frame.

### The Augmented Covariance Matrix
The uncertainty of the joint state is represented by the symmetric covariance matrix $P_k$:

$$
P_k = \begin{bmatrix}
P_{rr} & P_{rl_1} & \cdots & P_{rl_N} \\
P_{l_1 r} & P_{l_1 l_1} & \cdots & P_{l_1 l_N} \\
\vdots & \vdots & \ddots & \vdots \\
P_{l_N r} & P_{l_N l_1} & \cdots & P_{l_N l_N}
\end{bmatrix} \in \mathbb{R}^{(3+2N) \times (3+2N)}
$$

where:
*   $P_{rr} \in \mathbb{R}^{3 \times 3}$ is the robot's pose covariance.
*   $P_{l_i l_i} \in \mathbb{R}^{2 \times 2}$ is the self-covariance of the $i$-th landmark.
*   $P_{rl_i} \in \mathbb{R}^{3 \times 2}$ represents the cross-covariance between the robot and the $i$-th landmark.

---

## 2. Motion Model (Unicycle Kinematics)

The robot's movement is modeled using discrete-time unicycle kinematics. The commanded inputs are $u_k = [v_k, \omega_k]^T$, representing commanded linear velocity and angular velocity.

### State Transition Function
The ideal state transition function for the robot pose is:

$$
x_{r,k} = f_r(x_{r,k-1}, u_k, dt) = \begin{bmatrix}
x_{r,k-1} + dt \cdot v_k \cos(\theta_{k-1}) \\
y_{r,k-1} + dt \cdot v_k \sin(\theta_{k-1}) \\
\theta_{k-1} + dt \cdot \omega_k
\end{bmatrix}
$$

Since the landmarks are stationary in the environment, the state transition for the landmarks is the identity: $l_{i,k} = l_{i,k-1}$. The full state transition $f(x_{k-1}, u_k)$ is therefore:

$$
x_k = f(x_{k-1}, u_k) = \begin{bmatrix}
f_r(x_{r,k-1}, u_k, dt) \\
l_{1,k-1} \\
\vdots \\
l_{N,k-1}
\end{bmatrix}
$$

### Motion Jacobians
Because the state transition function $f$ is non-linear, the EKF propagates covariance by linearizing around the current estimate using the Taylor series expansion.

#### Jacobian with respect to the state ($A_k$):
$A_k = \frac{\partial f}{\partial x}\Big|_{x_{k-1}, u_k}$ has a block structure:

$$
A_k = \begin{bmatrix}
A_{rr} & 0_{3 \times 2N} \\
0_{2N \times 3} & I_{2N \times 2N}
\end{bmatrix}
$$

where the robot block $A_{rr} \in \mathbb{R}^{3 \times 3}$ is:

$$
A_{rr} = \begin{bmatrix}
1 & 0 & -dt \cdot v_k \sin(\theta_{k-1}) \\
0 & 1 & dt \cdot v_k \cos(\theta_{k-1}) \\
0 & 0 & 1
\end{bmatrix}
$$

#### Jacobian with respect to the control inputs ($B_k$):
$B_k = \frac{\partial f}{\partial u}\Big|_{x_{k-1}, u_k}$ relates input noise to the state space:

$$
B_k = \begin{bmatrix}
B_r \\
0_{2N \times 2}
\end{bmatrix} \in \mathbb{R}^{(3+2N) \times 2}
$$

where the robot control Jacobian $B_r \in \mathbb{R}^{3 \times 2}$ is:

$$
B_r = \begin{bmatrix}
dt \cos(\theta_{k-1}) & 0 \\
dt \sin(\theta_{k-1}) & 0 \\
0 & dt
\end{bmatrix}
$$

---

## 3. EKF Prediction Step

In the prediction step, we project the state and covariance forward using the odometry controls:

1.  **State Prediction**:
    $$
    \bar{x}_k = f(x_{k-1}, u_k)
    $$
2.  **Covariance Prediction**:
    $$
    \bar{P}_k = A_k P_{k-1} A_k^T + B_k Q B_k^T
    $$

where $Q$ is the process noise covariance matrix representing input uncertainty:

$$
Q = \begin{bmatrix}
\sigma_v^2 & 0 \\
0 & \sigma_\omega^2
\end{bmatrix}
$$

---

## 4. Observation Model

The landmark sensor measures relative landmark positions in the robot's **body frame**. This maps directly to a 2D laser range/bearing sensor or a stereo vision camera.

### The Measurement Function
For a landmark $i$ located at global coordinates $(l_i^x, l_i^y)$, the true relative position $z_i = [z_i^x, z_i^y]^T$ in the robot's body frame is obtained by translating the landmark and rotating it back by the robot's heading $\theta$:

$$
h_i(x_k) = R(\theta)^T \begin{bmatrix}
l_i^x - x_r \\
l_i^y - y_r
\end{bmatrix} = \begin{bmatrix}
\cos\theta & \sin\theta \\
-\sin\theta & \cos\theta
\end{bmatrix} \begin{bmatrix}
l_i^x - x_r \\
l_i^y - y_r
\end{bmatrix}
$$

This expands to:

$$
h_i(x_k) = \begin{bmatrix}
-\cos\theta(x_r - l_i^x) - \sin\theta(y_r - l_i^y) \\
\sin\theta(x_r - l_i^x) - \cos\theta(y_r - l_i^y)
\end{bmatrix}
$$

### Measurement Jacobian ($C_i$)
The Jacobian matrix $C_i = \frac{\partial h_i}{\partial x}\Big|_{\bar{x}_k}$ has non-zero blocks only for the robot states and the $i$-th landmark states:

$$
C_i = \begin{bmatrix}
C_{i,r} & 0 & \cdots & C_{i,l} & \cdots & 0
\end{bmatrix}
$$

#### 1. Derivative with respect to robot position $(x_r, y_r)$:
$$
C_{i,xy} = \begin{bmatrix}
-\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta
\end{bmatrix}
$$

#### 2. Derivative with respect to robot heading $\theta$:
$$
C_{i,\theta} = \begin{bmatrix}
\sin\theta(x_r - l_i^x) - \cos\theta(y_r - l_i^y) \\
\cos\theta(x_r - l_i^x) + \sin\theta(y_r - l_i^y)
\end{bmatrix}
$$

Combined robot block $C_{i,r} = [C_{i,xy} \mid C_{i,\theta}] \in \mathbb{R}^{2 \times 3}$.

#### 3. Derivative with respect to landmark position $(l_i^x, l_i^y)$:
$$
C_{i,l} = \begin{bmatrix}
\cos\theta & \sin\theta \\
-\sin\theta & \cos\theta
\end{bmatrix}
$$

---

## 5. EKF Correction (Update) Step

When the robot observes $M$ landmarks with IDs $[id_1, \dots, id_M]$ and relative measurements $z = [z_1^T, \dots, z_M^T]^T \in \mathbb{R}^{2M}$:

1.  **Compute expected measurements**:
    $$
    \bar{z}_k = \begin{bmatrix}
    h_{id_1}(\bar{x}_k) \\
    \vdots \\
    h_{id_M}(\bar{x}_k)
    \end{bmatrix} \in \mathbb{R}^{2M}
    $$
2.  **Assemble global measurement Jacobian $C_k$**:
    Stack the individual Jacobians vertically:
    $$
    C_k = \begin{bmatrix}
    C_{id_1} \\
    \vdots \\
    C_{id_M}
    \end{bmatrix} \in \mathbb{R}^{2M \times (3+2N)}
    $$
3.  **Compute Innovation Covariance $S_k$**:
    $$
    S_k = C_k \bar{P}_k C_k^T + R_k
    $$
    where $R_k = \sigma_{lm} \cdot I_{2M \times 2M}$ is the measurement noise covariance.
4.  **Compute Kalman Gain $K_k$**:
    $$
    K_k = \bar{P}_k C_k^T S_k^{-1}
    $$
5.  **State Correction**:
    $$
    x_k = \bar{x}_k + K_k (z - \bar{z}_k)
    $$
6.  **Covariance Update**:
    For numerical stability, we use the Joseph stabilized form which guarantees positive semi-definiteness:
    $$
    P_k = (I - K_k C_k) \bar{P}_k (I - K_k C_k)^T + K_k R_k K_k^T
    $$

---

## 6. Landmark State Augmentation

When a new landmark is observed, it must be appended to the state vector.

### The Inverse Observation Model
The landmark's initial global position $l_{new} = [l^x, l^y]^T$ is computed from the current estimated robot position $x_{r} = [x_r, y_r]^T$, estimated heading $\theta$, and the body-frame relative measurement $z_{obs} = [z_x, z_y]^T$:

$$
\begin{bmatrix}
l_{new}^x \\
l_{new}^y
\end{bmatrix} = \begin{bmatrix}
x_r \\
y_r
\end{bmatrix} + \begin{bmatrix}
\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta
\end{bmatrix} \begin{bmatrix}
z_x \\
z_y
\end{bmatrix}
$$

### Covariance Augmentation
If the state vector has size $D$, we expand it to $D+2$. The new covariance matrix is structured as:

$$
P_{new} = \begin{bmatrix}
P_{old} & 0_{D \times 2} \\
0_{2 \times D} & \sigma_{init} \cdot I_{2 \times 2}
\end{bmatrix}
$$

In a full theoretical implementation, the off-diagonal elements are initialized using the Jacobian of the inverse observation model with respect to the robot pose. In this implementation (matching the provided MATLAB script `ekf_slam_v2.m`), the landmark is initialized with a high un-correlated diagonal uncertainty $\sigma_{init}$ (e.g., $10.0$). The cross-covariances are immediately established in the subsequent correction step when the landmark is updated.

---

## 7. Telemetry & Performance Evaluation

### Procrustes Alignment-Corrected RMSE (aRMSE)
Because the coordinate system of SLAM can drift globally over time (absolute location is unobservable, only relative positions are measured), standard RMSE can grow even if the shape of the map is perfect. To evaluate map quality, we perform an SVD-based Procrustes alignment to find the optimal rotation $R_S$ and translation $x_S$ that maps the estimated map onto the ground truth.

Given $n$ landmark pairs $(l_i, \hat{l}_i)$:
1.  **Compute Centroids**:
    $$
    \mu = \frac{1}{n}\sum l_i, \quad \hat{\mu} = \frac{1}{n}\sum \hat{l}_i
    $$
2.  **Compute Cross-Covariance Matrix**:
    $$
    \Sigma = \frac{1}{n} \sum_{i=1}^n (l_i - \mu)(\hat{l}_i - \hat{\mu})^T
    $$
3.  **Perform Singular Value Decomposition (SVD)**:
    $$
    [U, D, V] = \text{SVD}(\Sigma)
    $$
4.  **Determine Reflection-Corrected Rotation**:
    $$
    R_S = V \begin{bmatrix} 1 & 0 \\ 0 & \text{det}(VU^T) \end{bmatrix} U^T
    $$
5.  **Compute Optimal Translation**:
    $$
    x_S = \hat{\mu} - R_S \mu
    $$
6.  **Calculate aRMSE**:
    $$
    aRMSE = \sqrt{\frac{1}{n}\sum_{i=1}^n \| R_S^T(\hat{l}_i - x_S) - l_i \|^2}
    $$
