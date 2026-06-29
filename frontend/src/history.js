/**
 * HistoryManager handles communication with backend history endpoints (save, load, delete, clear)
 * and keeps a list of runs synced.
 */
export class HistoryManager {
  constructor(backendUrl) {
    this.backendUrl = backendUrl;
    this.runs = [];
  }

  async fetchRuns() {
    try {
      const response = await fetch(`${this.backendUrl}/api/history/runs`);
      if (response.ok) {
        this.runs = await response.json();
      } else {
        console.error("Failed to fetch runs from backend");
      }
    } catch (e) {
      console.error("Error connecting to backend history API, using localStorage fallback:", e);
      // Fallback to localStorage if backend is unreachable
      const localData = localStorage.getItem('ekf_slam_runs');
      this.runs = localData ? JSON.parse(localData) : [];
    }
    return this.runs;
  }

  async saveRun(settings, metricsHistory, finalMetrics) {
    const newRun = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      track_type: settings.track_type,
      params: {
        Q_velocity_std: settings.Q_velocity_std,
        Q_omega_std: settings.Q_omega_std,
        steer_noise_std: settings.steer_noise_std,
        sig_lm: settings.sig_lm,
        sensor_range: settings.sensor_range,
        sensor_fov_deg: settings.sensor_fov_deg,
        initial_landmark_cov: settings.initial_landmark_cov
      },
      final_metrics: {
        pos_error: finalMetrics.pos_error,
        landmark_rmse: finalMetrics.landmark_rmse,
        cov_trace: finalMetrics.cov_trace
      },
      history: metricsHistory // Array of {timestep, pos_error, cov_trace, landmark_rmse}
    };

    try {
      const response = await fetch(`${this.backendUrl}/api/history/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRun)
      });
      
      if (response.ok) {
        console.log("Run saved to backend");
      } else {
        console.error("Failed to save run to backend");
      }
    } catch (e) {
      console.error("Error saving to backend, saving to localStorage:", e);
    }

    // Always update local runs list and fallback save
    this.runs.push(newRun);
    localStorage.setItem('ekf_slam_runs', JSON.stringify(this.runs));
    return this.runs;
  }

  async deleteRun(id) {
    this.runs = this.runs.filter(run => run.id !== id);
    
    // Save updated list to localStorage
    localStorage.setItem('ekf_slam_runs', JSON.stringify(this.runs));

    // For backend, since we don't have a single-delete endpoint, we clear all and re-save
    // or just clear backend and save the remaining ones.
    try {
      await fetch(`${this.backendUrl}/api/history/clear`, { method: 'POST' });
      for (const run of this.runs) {
        await fetch(`${this.backendUrl}/api/history/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(run)
        });
      }
    } catch (e) {
      console.error("Failed to delete run on backend:", e);
    }
    
    return this.runs;
  }

  async clearHistory() {
    this.runs = [];
    localStorage.removeItem('ekf_slam_runs');
    
    try {
      await fetch(`${this.backendUrl}/api/history/clear`, { method: 'POST' });
    } catch (e) {
      console.error("Failed to clear history on backend:", e);
    }
    
    return this.runs;
  }
}
