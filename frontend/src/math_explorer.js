/**
 * Manages the Interactive EKF Math & Matrix Explorer dashboard.
 * Uses KaTeX to render live equations and constructs dynamic HTML matrix grids.
 */

export class MathExplorer {
  constructor(containerId, backendUrl) {
    this.container = document.getElementById(containerId);
    this.backendUrl = backendUrl;
    
    this.activeStep = 'predict_x';
    this.inspectMatrix = 'x';
    
    // Cached math state from server
    this.mathState = null;
    
    // Hovered cell state
    this.hoveredCell = null;
    
    this._initDomElements();
    this._bindEvents();
  }

  _initDomElements() {
    this.btnToggle = document.getElementById('btn-toggle-math');
    this.btnClose = document.getElementById('btn-close-math');
    this.selectMatrix = document.getElementById('select-matrix');
    this.matrixGrid = document.getElementById('matrix-grid-container');
    this.cellInfoCard = document.getElementById('cell-info-card');
    this.explanationContainer = document.getElementById('math-explanation');
    this.stepButtons = document.querySelectorAll('.math-step-btn');
    this.mathNotice = document.getElementById('math-notice');
  }

  _bindEvents() {
    // Open panel
    if (this.btnToggle) {
      this.btnToggle.addEventListener('click', () => {
        this.container.classList.remove('hidden');
        this.fetchMathState();
        // Scroll to show it
        this.container.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Select matrix to inspect
    this.selectMatrix.addEventListener('change', () => {
      this.inspectMatrix = this.selectMatrix.value;
      this.renderMatrixGrid();
    });

    // Tab steps navigation
    this.stepButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.stepButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeStep = btn.getAttribute('data-step');
        this.renderExplanation();
      });
    });
  }

  async fetchMathState() {
    try {
      const response = await fetch(`${this.backendUrl}/api/math`);
      if (response.ok) {
        this.mathState = await response.json();
        this.mathNotice.textContent = `Live State - Step ${this.mathState.timestep}`;
        this.mathNotice.className = "drawer-notice live";
        
        // Refresh display
        this.renderExplanation();
        this.renderMatrixGrid();
      }
    } catch (e) {
      console.error("Error fetching math state from backend:", e);
      this.mathNotice.textContent = "Offline - Run backend to view live values";
      this.mathNotice.className = "drawer-notice error";
    }
  }

  renderExplanation() {
    if (!this.explanationContainer) return;
    
    // Check if we have live data
    const hasData = this.mathState && this.mathState.timestep > 0;
    
    let html = '';
    
    // Dynamic values helper
    const getVal = (path, decimals = 3) => {
      if (!hasData) return `[\\text{Live Val}]`;
      try {
        const parts = path.split('.');
        let val = this.mathState;
        for (const part of parts) {
          val = val[part];
        }
        return typeof val === 'number' ? val.toFixed(decimals) : val;
      } catch (e) {
        return `?`;
      }
    };

    switch (this.activeStep) {
      case 'predict_x':
        html = `
          <h4>1. State Prediction (x)</h4>
          <p>The state prediction projects the robot's pose forward in time using <strong>Unicycle Kinematics</strong> based on commanded velocities u = [v, ω]ᵀ. Landmark estimates remain constant.</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-predict-1"></div>
          </div>
          
          <h5>Live Calculation:</h5>
          <div class="equation-box highlight">
            <div class="katex-eq" id="eq-predict-2"></div>
          </div>
          
          <p class="description">Notice that process noise (Q) is not applied to the EKF prediction directly. Instead, process noise represents the <em>uncertainty</em> of our control input, which is handled in the Covariance Prediction step (P).</p>
        `;
        break;
        
      case 'predict_p':
        html = `
          <h4>2. Covariance Prediction (P)</h4>
          <p>Propagates the state uncertainty forward. The robot's motion adds process noise (Q) into the pose covariance, while cross-covariances are propagated using the system Jacobians.</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-cov-1"></div>
          </div>
          
          <p>Where the motion Jacobians represent the partial derivatives of the state transition function f w.r.t the state x (A) and control input u (B):</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-cov-2"></div>
          </div>
          
          <h5>Live Parameters:</h5>
          <ul>
            <li>Nominal control input: u = [v: ${getVal('u.0')}, ω: ${getVal('u.1')}]ᵀ</li>
            <li>Process noise standard deviation: σ_v = ${getVal('Q.0.0', 3)}^(1/2), σ_ω = ${getVal('Q.1.1', 3)}^(1/2)</li>
          </ul>
        `;
        break;
        
      case 'sensor_h':
        html = `
          <h4>3. Landmark Observation Model (h)</h4>
          <p>The onboard laser/camera measures a landmark relative to the robot's pose in the <strong>body frame</strong>. This requires translating the landmark position and rotating it back by the robot heading θ:</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-sensor-1"></div>
          </div>
          
          <h5>Observed Landmarks:</h5>
          <p>${hasData && this.mathState.observed_ids.length > 0 
            ? `Currently observing Landmark ID(s): <strong>${this.mathState.observed_ids.join(', ')}</strong>.` 
            : 'No landmarks currently in the sensor field of view.'}</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-sensor-2"></div>
          </div>
        `;
        break;
        
      case 'correct':
        html = `
          <h4>4. EKF Correction & Gain (K)</h4>
          <p>The Kalman Gain (K) calculates the optimal weight to apply to the sensor measurement error (the innovation vector z - z_hat). It balances motion model prediction uncertainty (P) against sensor accuracy (R):</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-correct-1"></div>
          </div>
          
          <h5>State Correction Update:</h5>
          <div class="equation-box highlight">
            <div class="katex-eq" id="eq-correct-2"></div>
          </div>
          
          <p class="description">If R (measurement noise) is extremely small, K reaches its maximum weight and the filter relies almost entirely on the sensor observations. If R is large, K drops and the filter ignores the measurements, relying on dead reckoning.</p>
        `;
        break;
        
      case 'augment':
        html = `
          <h4>5. Landmark Augmentation</h4>
          <p>When the sensor detects a landmark with a new ID, the state vector is expanded. The initial coordinates are computed using the inverse sensor model:</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-augment-1"></div>
          </div>
          
          <p>The state covariance matrix is augmented with a new 2 &times; 2 diagonal block initialized to the initial uncertainty covariance σ_init (here configured to <strong>${getVal('P.3.3', 1) || 10.0}</strong>):</p>
          
          <div class="equation-box">
            <div class="katex-eq" id="eq-augment-2"></div>
          </div>
        `;
        break;
    }
    
    this.explanationContainer.innerHTML = html;
    
    // Trigger KaTeX rendering
    this._renderKatexEquations(getVal);
  }

  _renderKatexEquations(getVal) {
    if (!window.katex) return;

    try {
      const render = (eqId, latex) => {
        const el = document.getElementById(eqId);
        if (el) window.katex.render(latex, el, { displayMode: true, throwOnError: false });
      };

      if (this.activeStep === 'predict_x') {
        render('eq-predict-1', `x_k = f(x_{k-1}, u_k) = \\begin{bmatrix} x_{r,k-1} + dt \\cdot v_k \\cos(\\theta_{k-1}) \\\\ y_{r,k-1} + dt \\cdot v_k \\sin(\\theta_{k-1}) \\\\ \\theta_{k-1} + dt \\cdot \\omega_k \\end{bmatrix}`);
        
        const xr = getVal('x.0');
        const yr = getVal('x.1');
        const th = getVal('x.2');
        const dt = getVal('dt');
        const v = getVal('u.0') || '0.000';
        const w = getVal('u.1') || '0.000';
        
        render('eq-predict-2', `\\bar{x}_{pred} = \\begin{bmatrix} ${xr} + ${dt} \\cdot (${v}) \\cos(${th}) \\\\ ${yr} + ${dt} \\cdot (${v}) \\sin(${th}) \\\\ ${th} + ${dt} \\cdot (${w}) \\end{bmatrix}`);
      }
      
      else if (this.activeStep === 'predict_p') {
        render('eq-cov-1', `\\bar{P}_k = A_k P_{k-1} A_k^T + B_k Q_k B_k^T`);
        render('eq-cov-2', `A_{3\\times3} = \\begin{bmatrix} 1 & 0 & -dt \\cdot v \\sin\\theta \\\\ 0 & 1 & dt \\cdot v \\cos\\theta \\\\ 0 & 0 & 1 \\end{bmatrix}, \\quad B_{3\\times2} = \\begin{bmatrix} dt \\cos\\theta & 0 \\\\ dt \\sin\\theta & 0 \\\\ 0 & dt \\end{bmatrix}`);
      }
      
      else if (this.activeStep === 'sensor_h') {
        render('eq-sensor-1', `h_i(x) = \\begin{bmatrix} \\cos\\theta & \\sin\\theta \\\\ -\\sin\\theta & \\cos\\theta \\end{bmatrix} \\begin{bmatrix} l_i^x - x_r \\\\ l_i^y - y_r \\end{bmatrix}`);
        
        if (this.mathState && this.mathState.observed_ids.length > 0) {
          const z_x = getVal('z.0');
          const z_y = getVal('z.1');
          const zh_x = getVal('z_hat.0');
          const zh_y = getVal('z_hat.1');
          render('eq-sensor-2', `z_{obs} = \\begin{bmatrix} ${z_x} \\\\ ${z_y} \\end{bmatrix}, \\quad \\hat{z}_{expected} = \\begin{bmatrix} ${zh_x} \\\\ ${zh_y} \\end{bmatrix}`);
        } else {
          render('eq-sensor-2', `z_{obs} = \\emptyset, \\quad \\hat{z}_{expected} = \\emptyset`);
        }
      }
      
      else if (this.activeStep === 'correct') {
        render('eq-correct-1', `K_k = \\bar{P}_k C_k^T (C_k \\bar{P}_k C_k^T + R_k)^{-1}`);
        
        if (this.mathState && this.mathState.observed_ids.length > 0) {
          const inn_x = getVal('innovation.0');
          const inn_y = getVal('innovation.1');
          render('eq-correct-2', `x_k = \\bar{x}_k + K \\underbrace{\\begin{bmatrix} ${inn_x} \\\\ ${inn_y} \\end{bmatrix}}_{z - \\hat{z}}`);
        } else {
          render('eq-correct-2', `x_k = \\bar{x}_k \\quad (\\text{No measurements to correct})`);
        }
      }
      
      else if (this.activeStep === 'augment') {
        render('eq-augment-1', `\\begin{bmatrix} l_{new}^x \\\\ l_{new}^y \\end{bmatrix} = \\begin{bmatrix} x_r \\\\ y_r \\end{bmatrix} + \\begin{bmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{bmatrix} \\begin{bmatrix} z_x \\\\ z_y \\end{bmatrix}`);
        render('eq-augment-2', `P_{new} = \\begin{bmatrix} P_{old} & 0 \\\\ 0 & \\sigma_{init} \\cdot I_2 \\end{bmatrix}`);
      }
    } catch (e) {
      console.warn("KaTeX render failed:", e);
    }
  }

  renderMatrixGrid() {
    if (!this.matrixGrid) return;
    
    const hasData = this.mathState && this.mathState.timestep > 0;
    
    if (!hasData) {
      this.matrixGrid.innerHTML = `
        <div class="matrix-empty">
          <p>Please run the simulation, then pause it to fetch live matrix data.</p>
        </div>
      `;
      return;
    }

    let matrixData = this.mathState[this.inspectMatrix];
    
    if (!matrixData) {
      this.matrixGrid.innerHTML = `
        <div class="matrix-empty">
          <p>The matrix <strong>${this.inspectMatrix}</strong> is not available at the current timestep. This usually occurs when no landmarks are being observed, meaning the correction Jacobians (C, K, R) are empty.</p>
        </div>
      `;
      return;
    }

    // Ensure it is 2D
    const is1D = !Array.isArray(matrixData[0]);
    if (is1D) {
      matrixData = matrixData.map(v => [v]);
    }

    const rows = matrixData.length;
    const cols = matrixData[0].length;
    
    // Max display size limit to prevent lag
    const maxRows = Math.min(rows, 20);
    const maxCols = Math.min(cols, 20);
    
    this.matrixGrid.style.gridTemplateColumns = `repeat(${maxCols}, minmax(65px, 1fr))`;
    this.matrixGrid.innerHTML = '';
    
    for (let r = 0; r < maxRows; r++) {
      for (let c = 0; c < maxCols; c++) {
        const val = matrixData[r][c];
        const cell = document.createElement('div');
        cell.className = 'matrix-cell';
        cell.textContent = typeof val === 'number' ? val.toFixed(4) : val;
        
        // Color coding based on value
        if (Math.abs(val) < 1e-7) {
          cell.classList.add('val-zero');
        } else if (val > 0) {
          cell.classList.add('val-pos');
        } else {
          cell.classList.add('val-neg');
        }
        
        // Add indices mapping tags
        const stateMapping = this._getCellMapping(r, c);
        if (stateMapping.blockType === 'robot') {
          cell.classList.add('cell-robot');
        } else if (stateMapping.blockType === 'landmark') {
          cell.classList.add('cell-lmk');
        } else if (stateMapping.blockType === 'cross') {
          cell.classList.add('cell-cross');
        }
        
        // Add hover listener
        cell.addEventListener('mouseenter', () => {
          this._showCellInfo(r, c, val, stateMapping);
          cell.classList.add('hovered');
        });
        
        cell.addEventListener('mouseleave', () => {
          cell.classList.remove('hovered');
        });

        this.matrixGrid.appendChild(cell);
      }
    }
  }

  _getCellMapping(r, c) {
    const idx2num = this.mathState.idx2num || [];
    
    const getLabel = (idx) => {
      if (idx === 0) return 'Robot X';
      if (idx === 1) return 'Robot Y';
      if (idx === 2) return 'Robot Theta';
      
      const lmIdx = Math.floor((idx - 3) / 2);
      const isY = (idx - 3) % 2 === 1;
      const lmId = idx2num[lmIdx];
      return `Landmark ${lmId || lmIdx} (${isY ? 'Y' : 'X'})`;
    };

    let rowLabel = getLabel(r);
    let colLabel = getLabel(c);
    
    // Determine block type (robot, landmark, cross)
    let blockType = 'other';
    if (this.inspectMatrix === 'P' || this.inspectMatrix === 'A') {
      const isRowRobot = r < 3;
      const isColRobot = c < 3;
      if (isRowRobot && isColRobot) blockType = 'robot';
      else if (!isRowRobot && !isColRobot) blockType = 'landmark';
      else blockType = 'cross';
    } else if (this.inspectMatrix === 'x') {
      blockType = r < 3 ? 'robot' : 'landmark';
    } else if (this.inspectMatrix === 'C') {
      blockType = c < 3 ? 'robot' : 'landmark';
      const obsIdx = Math.floor(r / 2);
      const isY = r % 2 === 1;
      const lmkId = this.mathState.observed_ids[obsIdx];
      rowLabel = `Obs ${lmkId} (${isY ? 'Bearing' : 'Range'})`;
    } else if (this.inspectMatrix === 'K') {
      const isRowRobot = r < 3;
      blockType = isRowRobot ? 'robot' : 'landmark';
      const obsIdx = Math.floor(c / 2);
      const isY = c % 2 === 1;
      const lmkId = this.mathState.observed_ids[obsIdx];
      colLabel = `Gain from Obs ${lmkId} (${isY ? 'Bearing' : 'Range'})`;
    }

    return { rowLabel, colLabel, blockType };
  }

  _showCellInfo(r, c, val, mapping) {
    if (!this.cellInfoCard) return;

    let mathDetail = '';
    
    if (this.inspectMatrix === 'P') {
      if (r === c) {
        mathDetail = `Variance of <strong>${mapping.rowLabel}</strong>. Value represents squared uncertainty ($\u03C3^2$).`;
      } else {
        mathDetail = `Covariance between <strong>${mapping.rowLabel}</strong> and <strong>${mapping.colLabel}</strong>.`;
      }
    } else if (this.inspectMatrix === 'A') {
      if (r === 0 && c === 2) {
        mathDetail = `$$\\frac{\\partial x_{pred}}{\\partial \\theta} = -dt \\cdot v \\sin\\theta$$<br>Represents how much yaw heading error propagates into X coordinate uncertainty per step.`;
      } else if (r === 1 && c === 2) {
        mathDetail = `$$\\frac{\\partial y_{pred}}{\\partial \\theta} = dt \\cdot v \\cos\\theta$$<br>Represents how much yaw heading error propagates into Y coordinate uncertainty per step.`;
      } else if (r === c) {
        mathDetail = `Identity derivative $\\frac{\\partial x_i}{\\partial x_i} = 1.0$.`;
      } else {
        mathDetail = `Uncorrelated derivative (equals 0).`;
      }
    } else if (this.inspectMatrix === 'C') {
      const obsIdx = Math.floor(r / 2);
      const isY = r % 2 === 1; // 0 is x, 1 is y relative measurement
      
      if (c < 3) {
        if (isY) {
          mathDetail = `Partial derivative of relative Y measurement w.r.t robot pose.`;
        } else {
          mathDetail = `Partial derivative of relative X measurement w.r.t robot pose.`;
        }
      } else {
        mathDetail = `Partial derivative of relative measurement w.r.t Landmark coordinates.`;
      }
    }

    this.cellInfoCard.innerHTML = `
      <div class="cell-info-header">
        <span class="cell-coords">Cell [${r}, ${c}]</span>
        <span class="cell-val-badge">Value: ${val.toFixed(6)}</span>
      </div>
      <div class="cell-info-row">
        <strong>Row:</strong> <span>${mapping.rowLabel}</span>
      </div>
      <div class="cell-info-row">
        <strong>Col:</strong> <span>${mapping.colLabel}</span>
      </div>
      <div class="cell-info-math" id="cell-math-render">
        ${mathDetail || 'Standard matrix elements parameter value.'}
      </div>
    `;

    // Render KaTeX in tooltip if formula present
    const mathEl = document.getElementById('cell-math-render');
    if (mathEl && window.katex && mathDetail.includes('$$')) {
      // Find the latex string
      const match = mathDetail.match(/\$\$(.*?)\$\$/);
      if (match) {
        const latex = match[1];
        // Render it
        const div = document.createElement('div');
        window.katex.render(latex, div, { displayMode: true, throwOnError: false });
        mathEl.prepend(div);
        // Replace raw $$ string in element text
        mathEl.innerHTML = mathEl.innerHTML.replace(/\$\$.*?\$\$/, '');
      }
    }
  }
}
