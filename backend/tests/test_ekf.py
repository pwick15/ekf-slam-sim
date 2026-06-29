import numpy as np
import pytest
from backend.ekf_slam import EKFSlam

def test_ekf_initialization():
    ekf = EKFSlam()
    assert len(ekf.x) == 3
    assert ekf.P.shape == (3, 3)
    assert np.allclose(ekf.x, np.array([1.5, 1.5, np.pi/2.0]))
    assert ekf.idx2num == []

def test_ekf_predict():
    ekf = EKFSlam()
    dt = 0.1
    # Move forward with 1.0 m/s, angular rate 0
    # Robot points along y axis (pi/2)
    # Expected: x remains 1.5, y increases by dt * 1.0 = 0.1, theta remains pi/2
    ekf.predict(dt, 1.0, 0.0)
    assert np.allclose(ekf.x[:3], np.array([1.5, 1.6, np.pi/2.0]))
    # Covariance should grow in direction of motion (y axis)
    assert ekf.P[1, 1] > 1e-4

def test_ekf_landmark_augmentation():
    ekf = EKFSlam()
    # Mock single observation
    # Robot is at (1.5, 1.5, pi/2). Relative measurement is [0.0, 1.0] (1m ahead of robot in body frame)
    # Global position should be:
    # lx = x + cos(theta)*0 - sin(theta)*1 = 1.5 - 1.0 = 0.5
    # ly = y + sin(theta)*0 + cos(theta)*1 = 1.5 + 0.0 = 1.5
    ids = [10]
    z = np.array([0.0, 1.0])
    
    # We call _add_new_landmarks directly to test augmentation BEFORE the update step modifies it
    ekf._add_new_landmarks(ids, z)
    
    # State length should be 3 + 2 = 5
    assert len(ekf.x) == 5
    assert ekf.idx2num == [10]
    # Check landmark position
    assert np.allclose(ekf.x[3:5], np.array([0.5, 1.5]))
    # Check expanded covariance shape
    assert ekf.P.shape == (5, 5)
    # Expanded diagonal element should match initial covariance
    assert np.allclose(ekf.P[3, 3], ekf.initial_landmark_cov)
    assert np.allclose(ekf.P[4, 4], ekf.initial_landmark_cov)
    
    # Now run update and verify it converges towards measurement noise
    ekf.update(ids, z)
    # The updated covariance for the landmark should be small, close to sig_lm (0.01)
    assert ekf.P[3, 3] < 0.1
    assert ekf.P[4, 4] < 0.1

def test_ekf_update_correction():
    ekf = EKFSlam(sig_lm=0.1) # Higher noise so update is more gradual/visible
    # Add a landmark
    ekf.update([5], np.array([0.0, 1.0]))
    
    # Run prediction step (robot moves)
    ekf.predict(0.1, 1.0, 0.0)
    
    # Measure the landmark again, but with a large error
    z_measured = np.array([-0.5, 0.5])
    
    # Make update
    prev_pose = ekf.x[:3].copy()
    ekf.update([5], z_measured)
    
    # Check that state has updated
    # Pose should have adjusted to reduce the error (not exactly equal)
    assert not np.array_equal(ekf.x[:3], prev_pose)
    # Check that the change is non-trivial
    diff = np.linalg.norm(ekf.x[:3] - prev_pose)
    assert diff > 1e-5
