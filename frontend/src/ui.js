/**
 * Handles Tab navigation, synchronization of slider inputs, live telemetry metrics,
 * and drawing high-performance Canvas2D sparklines/history charts.
 */

export class UIManager {
  constructor(callbacks) {
    this.callbacks = callbacks; // restart, updateParams, saveRun, clearRuns
    
    // Tab State
    this.activeTab = 'tuning';
    
    // Sparkline history buffers
    this.posErrorHistory = [];
    this.lmRmseHistory = [];
    this.covTraceHistory = [];
    
    this._initDomElements();
    this._bindEvents();
    this.resizeCharts();
  }

  _initDomElements() {
    // Tabs
    this.tabButtons = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');
    
    // Sliders & value displays
    this.sliders = {
      qVel: { input: document.getElementById('slider-q-vel'), val: document.getElementById('val-q-vel'), suffix: '' },
      qOmega: { input: document.getElementById('slider-q-omega'), val: document.getElementById('val-q-omega'), suffix: '' },
      qSteer: { input: document.getElementById('slider-q-steer'), val: document.getElementById('val-q-steer'), suffix: '' },
      rNoise: { input: document.getElementById('slider-r-noise'), val: document.getElementById('val-r-noise'), suffix: '' },
      range: { input: document.getElementById('slider-sensor-range'), val: document.getElementById('val-sensor-range'), suffix: 'm' },
      fov: { input: document.getElementById('slider-sensor-fov'), val: document.getElementById('val-sensor-fov'), suffix: '°' },
      lmInitCov: { input: document.getElementById('slider-lm-init-cov'), val: document.getElementById('val-lm-init-cov'), suffix: '' }
    };
    
    // Track & speed
    this.selectTrack = document.getElementById('select-track');
    this.inputSpeed = document.getElementById('input-speed');
    this.btnApplyRestart = document.getElementById('btn-apply-restart');
    
    // Playback HUD
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.iconPlay = this.btnPlayPause.querySelector('.icon-play');
    this.iconPause = this.btnPlayPause.querySelector('.icon-pause');
    this.btnStep = document.getElementById('btn-step');
    this.btnReset = document.getElementById('btn-reset');
    this.sliderSpeed = document.getElementById('slider-speed');
    this.valSpeed = document.getElementById('val-speed');
    
    // HUD labels
    this.hud = {
      step: document.getElementById('hud-step'),
      posError: document.getElementById('hud-pos-error'),
      armse: document.getElementById('hud-armse'),
      covTrace: document.getElementById('hud-cov-trace')
    };

    // Telemetry text boxes
    this.telemetry = {
      posError: document.getElementById('metrics-pos-error'),
      lmRmse: document.getElementById('metrics-lm-rmse'),
      covTrace: document.getElementById('metrics-cov-trace'),
      discoveredLm: document.getElementById('metrics-discovered-lm')
    };
    
    // Sparkline canvases
    this.sparklineCanvas = {
      pos: document.getElementById('sparkline-pos'),
      lm: document.getElementById('sparkline-lm'),
      cov: document.getElementById('sparkline-cov')
    };
    
    // Main charts
    this.chartError = document.getElementById('error-history-chart');
    
    // History tab controls
    this.btnSaveCurrent = document.getElementById('btn-save-current');
    this.btnClearHistory = document.getElementById('btn-clear-history');
    this.tableRunsBody = document.getElementById('table-runs-body');
    this.comparisonSection = document.getElementById('comparison-section');
    this.chartCompare = document.getElementById('compare-runs-chart');
  }

  _bindEvents() {
    // Tab switching
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Sync sliders values real-time
    Object.entries(this.sliders).forEach(([key, slider]) => {
      slider.input.addEventListener('input', () => {
        slider.val.textContent = `${slider.input.value}${slider.suffix}`;
        
        // Notify dynamic EKF parameter updates
        this._notifyParamUpdates();
      });
    });

    // Playback control events
    this.btnPlayPause.addEventListener('click', () => {
      if (this.isPlaying) {
        this.callbacks.onPause();
      } else {
        this.callbacks.onPlay();
      }
    });

    this.btnStep.addEventListener('click', () => {
      this.callbacks.onStep();
    });

    this.btnReset.addEventListener('click', () => {
      this.callbacks.onReset();
    });

    this.sliderSpeed.addEventListener('input', () => {
      const val = parseFloat(this.sliderSpeed.value);
      this.valSpeed.textContent = `${val.toFixed(2)}x`;
      this.callbacks.onSpeedChange(val);
    });

    // Restart configuration button
    this.btnApplyRestart.addEventListener('click', () => {
      const config = this.getFormConfig();
      this.callbacks.onRestart(config);
    });
    
    // Save current run
    this.btnSaveCurrent.addEventListener('click', () => {
      this.callbacks.onSaveCurrentRun();
    });
    
    // Clear history
    this.btnClearHistory.addEventListener('click', () => {
      if (confirm("Are you sure you want to delete all saved simulation runs?")) {
        this.callbacks.onClearHistory();
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      this.resizeCharts();
      this.renderCharts();
    });
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    
    this.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    
    this.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    this.resizeCharts();
    this.renderCharts();
  }

  _notifyParamUpdates() {
    const params = {
      Q_velocity_std: parseFloat(this.sliders.qVel.input.value),
      Q_omega_std: parseFloat(this.sliders.qOmega.input.value),
      steer_noise_std: parseFloat(this.sliders.qSteer.input.value),
      sig_lm: parseFloat(this.sliders.rNoise.input.value),
      sensor_range: parseFloat(this.sliders.range.input.value),
      sensor_fov_deg: parseFloat(this.sliders.fov.input.value),
      initial_landmark_cov: parseFloat(this.sliders.lmInitCov.input.value)
    };
    this.callbacks.onParamUpdate(params);
  }

  /**
   * Syncs configuration parameters returned from server onto UI sliders/inputs.
   */
  syncConfig(settings, totalLandmarks) {
    this.selectTrack.value = settings.track_type;
    this.inputSpeed.value = settings.vehicle_speed;
    
    this.sliders.qVel.input.value = settings.Q_velocity_std;
    this.sliders.qVel.val.textContent = settings.Q_velocity_std;
    
    this.sliders.qOmega.input.value = settings.Q_omega_std;
    this.sliders.qOmega.val.textContent = settings.Q_omega_std;
    
    this.sliders.qSteer.input.value = settings.steer_noise_std;
    this.sliders.qSteer.val.textContent = settings.steer_noise_std;
    
    this.sliders.rNoise.input.value = settings.sig_lm;
    this.sliders.rNoise.val.textContent = settings.sig_lm;
    
    this.sliders.range.input.value = settings.sensor_range;
    this.sliders.range.val.textContent = `${settings.sensor_range}m`;
    
    this.sliders.fov.input.value = settings.sensor_fov_deg;
    this.sliders.fov.val.textContent = `${settings.sensor_fov_deg}°`;
    
    this.sliders.lmInitCov.input.value = settings.initial_landmark_cov;
    this.sliders.lmInitCov.val.textContent = settings.initial_landmark_cov;
    
    this.totalLandmarks = totalLandmarks;
    this.updateStatus(this.isPlaying);
  }

  getFormConfig() {
    return {
      track_type: this.selectTrack.value,
      vehicle_speed: parseFloat(this.inputSpeed.value),
      Q_velocity_std: parseFloat(this.sliders.qVel.input.value),
      Q_omega_std: parseFloat(this.sliders.qOmega.input.value),
      steer_noise_std: parseFloat(this.sliders.qSteer.input.value),
      sig_lm: parseFloat(this.sliders.rNoise.input.value),
      sensor_range: parseFloat(this.sliders.range.input.value),
      sensor_fov_deg: parseFloat(this.sliders.fov.input.value),
      initial_landmark_cov: parseFloat(this.sliders.lmInitCov.input.value)
    };
  }

  updateStatus(isPlaying) {
    this.isPlaying = isPlaying;
    if (isPlaying) {
      this.iconPlay.classList.add('hidden');
      this.iconPause.classList.remove('hidden');
      this.btnPlayPause.style.background = '#ff4a4a';
      this.btnPlayPause.style.boxShadow = '0 0 20px rgba(255, 74, 74, 0.15)';
    } else {
      this.iconPlay.classList.remove('hidden');
      this.iconPause.classList.add('hidden');
      this.btnPlayPause.style.background = 'var(--color-gt)';
      this.btnPlayPause.style.boxShadow = 'var(--shadow-glow)';
    }
  }

  resetHistory() {
    this.posErrorHistory = [];
    this.lmRmseHistory = [];
    this.covTraceHistory = [];
    this.renderCharts();
  }

  /**
   * Pushes latest metrics to history arrays and updates DOM display metrics.
   */
  updateMetrics(stateData) {
    const m = stateData.metrics;
    
    // 1. Update text displays
    this.hud.step.textContent = stateData.timestep;
    this.hud.posError.textContent = `${m.pos_error.toFixed(3)}m`;
    this.hud.armse.textContent = `${m.landmark_rmse.toFixed(3)}m`;
    this.hud.covTrace.textContent = m.cov_trace.toFixed(3);
    
    this.telemetry.posError.textContent = `${m.pos_error.toFixed(3)} m`;
    this.telemetry.lmRmse.textContent = `${m.landmark_rmse.toFixed(3)} m`;
    this.telemetry.covTrace.textContent = m.cov_trace.toFixed(3);
    
    const discovered = stateData.idx2num ? stateData.idx2num.length : 0;
    this.telemetry.discoveredLm.textContent = `${discovered} / ${this.totalLandmarks || 16}`;
    
    // 2. Append to history buffers for graphing
    this.posErrorHistory.push(m.pos_error);
    this.lmRmseHistory.push(m.landmark_rmse);
    this.covTraceHistory.push(m.cov_trace);
    
    // Cap buffer sizes to keep sparklines readable (last 100 frames)
    if (this.posErrorHistory.length > 200) this.posErrorHistory.shift();
    if (this.lmRmseHistory.length > 200) this.lmRmseHistory.shift();
    if (this.covTraceHistory.length > 200) this.covTraceHistory.shift();

    // 3. Render sparklines and full telemetry chart
    this.renderCharts();
  }

  resizeCharts() {
    const resizeCanvas = (canvas) => {
      if (!canvas) return;
      const rect = canvas.parentNode.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas(this.sparklineCanvas.pos);
    resizeCanvas(this.sparklineCanvas.lm);
    resizeCanvas(this.sparklineCanvas.cov);
    resizeCanvas(this.chartError);
    resizeCanvas(this.chartCompare);
  }

  renderCharts() {
    // Only render sparklines if the metrics tab is active
    if (this.activeTab !== 'metrics') return;

    this._drawSparkline(this.sparklineCanvas.pos, this.posErrorHistory, '#3b82f6');
    this._drawSparkline(this.sparklineCanvas.lm, this.lmRmseHistory, '#10b981');
    this._drawSparkline(this.sparklineCanvas.cov, this.covTraceHistory, '#f97316');
    
    this._drawMainChart();
  }

  _drawSparkline(canvas, data, color) {
    if (!canvas || data.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    
    ctx.clearRect(0, 0, width, height);
    
    const maxVal = Math.max(...data, 0.01);
    const minVal = Math.min(...data, 0);
    const range = maxVal - minVal;
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    data.forEach((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - minVal) / range) * (height - 4) - 2;
      
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    // Draw shading under path
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = color.replace(')', ', 0.08)').replace('#3b82f6', 'rgba(59, 130, 246, 0.08)').replace('#10b981', 'rgba(16, 185, 129, 0.08)').replace('#f97316', 'rgba(249, 115, 22, 0.08)');
    ctx.fill();
    ctx.restore();
  }

  _drawMainChart() {
    const canvas = this.chartError;
    if (!canvas || this.posErrorHistory.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    
    ctx.clearRect(0, 0, width, height);
    
    const maxVal = Math.max(...this.posErrorHistory, 0.1);
    const minVal = 0;
    const range = maxVal - minVal;
    
    const padLeft = 32;
    const padBottom = 16;
    const padTop = 10;
    const padRight = 10;
    
    const chartW = width - padLeft - padRight;
    const chartH = height - padBottom - padTop;
    
    ctx.save();
    
    // Draw background grid lines (horizontal)
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.04)';
    ctx.lineWidth = 1;
    
    const gridLines = 4;
    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    
    for (let i = 0; i <= gridLines; i++) {
      const val = minVal + (range * i) / gridLines;
      const y = padTop + chartH - (i / gridLines) * chartH;
      
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      
      ctx.fillText(val.toFixed(2), padLeft - 6, y + 3);
    }
    
    // Draw data path (Indigo blue curve, no glow shadow)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    
    this.posErrorHistory.forEach((val, idx) => {
      const x = padLeft + (idx / (this.posErrorHistory.length - 1)) * chartW;
      const y = padTop + chartH - ((val - minVal) / range) * chartH;
      
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    // Gradient fill under the error curve
    ctx.shadowBlur = 0;
    ctx.lineTo(padLeft + chartW, padTop + chartH);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.closePath();
    
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Border axes
    ctx.strokeStyle = 'var(--border-glass)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.lineTo(width - padRight, padTop + chartH);
    ctx.stroke();
    
    ctx.restore();
  }

  /**
   * Refreshes the saved runs table.
   */
  updateRunsTable(runs) {
    if (!this.tableRunsBody) return;
    
    if (runs.length === 0) {
      this.tableRunsBody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center">No saved runs in history.</td>
        </tr>
      `;
      this.comparisonSection.classList.add('hidden');
      return;
    }
    
    this.tableRunsBody.innerHTML = '';
    
    // Render descending (newest first)
    runs.slice().reverse().forEach((run, idx) => {
      const tr = document.createElement('tr');
      
      const date = new Date(run.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      tr.innerHTML = `
        <td>${timeStr}</td>
        <td><span class="badge">${run.track_type}</span></td>
        <td>${run.final_metrics.pos_error.toFixed(3)} m</td>
        <td>${run.final_metrics.landmark_rmse.toFixed(3)} m</td>
        <td>
          <button class="btn-delete" data-id="${run.id}">Delete</button>
        </td>
      `;
      
      // Bind delete button
      const btnDel = tr.querySelector('.btn-delete');
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onDeleteRun(run.id);
      });
      
      this.tableRunsBody.appendChild(tr);
    });

    // Draw multi-run comparison line chart
    this.renderComparisonChart(runs);
  }

  renderComparisonChart(runs) {
    const canvas = this.chartCompare;
    if (!canvas || runs.length === 0) {
      this.comparisonSection.classList.add('hidden');
      return;
    }
    
    // Show compare section if there's at least 1 run
    this.comparisonSection.classList.remove('hidden');
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    
    ctx.clearRect(0, 0, width, height);
    
    // Find absolute maximum length of runs and maximum error to size axes
    let maxLen = 0;
    let maxErr = 0.1;
    
    runs.forEach(run => {
      if (run.history.length > maxLen) maxLen = run.history.length;
      run.history.forEach(h => {
        if (h.pos_error > maxErr) maxErr = h.pos_error;
      });
    });
    
    if (maxLen < 2) return;
    
    const padLeft = 32;
    const padBottom = 20;
    const padTop = 10;
    const padRight = 10;
    
    const chartW = width - padLeft - padRight;
    const chartH = height - padBottom - padTop;
    
    ctx.save();
    
    // Grid lines (horizontal)
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.04)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const val = (maxErr * i) / gridLines;
      const y = padTop + chartH - (i / gridLines) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(2), padLeft - 6, y + 3);
    }
    
    // Draw each run with a distinct colored path
    const colors = [
      '#3b82f6', // Indigo blue
      '#f97316', // Orange
      '#10b981', // Emerald green
      '#ef4444', // Coral red
      '#8b5cf6', // Indigo purple
      '#eab308'  // Amber yellow
    ];
    
    runs.forEach((run, rIdx) => {
      const color = colors[rIdx % colors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      
      run.history.forEach((h, hIdx) => {
        const x = padLeft + (hIdx / (maxLen - 1)) * chartW;
        const y = padTop + chartH - (h.pos_error / maxErr) * chartH;
        
        if (hIdx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      
      // Draw small legend key on chart
      ctx.fillStyle = color;
      ctx.fillRect(padLeft + 10 + rIdx*60, padTop, 6, 6);
      ctx.fillStyle = 'var(--text-secondary)';
      ctx.textAlign = 'left';
      ctx.fillText(`Run ${rIdx+1}`, padLeft + 20 + rIdx*60, padTop + 6);
    });
    
    // Bottom X-axis label
    ctx.strokeStyle = 'var(--border-glass)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.lineTo(width - padRight, padTop + chartH);
    ctx.stroke();
    
    ctx.restore();
  }
}
