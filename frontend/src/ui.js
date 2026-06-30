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
      covTrace: document.getElementById('hud-cov-trace'),
      discoveredLm: document.getElementById('hud-discovered-lm')
    };

    // Legend Popup
    this.btnLegend = document.getElementById('btn-legend');
    this.legendPopup = document.getElementById('legend-popup');
    this.btnCloseLegend = document.getElementById('btn-close-legend');

    // Sparkline canvases
    this.sparklineCanvas = {
      pos: document.getElementById('sparkline-pos'),
      lm: document.getElementById('sparkline-lm'),
      cov: document.getElementById('sparkline-cov')
    };

  }

  _bindEvents() {
    // Legend toggling
    if (this.btnLegend) {
      this.btnLegend.addEventListener('click', () => {
        this.legendPopup.classList.toggle('hidden');
      });
    }
    if (this.btnCloseLegend) {
      this.btnCloseLegend.addEventListener('click', () => {
        this.legendPopup.classList.add('hidden');
      });
    }
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
    


    // Handle resize
    window.addEventListener('resize', () => {
      this.resizeCharts();
      this.renderCharts();
    });
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
    
    const discovered = stateData.landmarks ? Object.keys(stateData.landmarks).length : 0;
    this.hud.discoveredLm.textContent = `${discovered} / ${this.totalLandmarks || 16}`;
    
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
    this._drawSparkline(this.sparklineCanvas.pos, this.posErrorHistory, '#3b82f6');
    this._drawSparkline(this.sparklineCanvas.lm, this.lmRmseHistory, '#10b981');
    this._drawSparkline(this.sparklineCanvas.cov, this.covTraceHistory, '#f97316');
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
}
