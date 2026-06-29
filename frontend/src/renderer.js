import { getCovarianceEllipse } from './math.js';

export class TopDownRenderer {
  constructor(canvas, transformer) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.transformer = transformer;
    
    // Zoom and pan state
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    
    // Setup mouse events for pan and zoom
    this._initInputHandlers();
  }

  _initInputHandlers() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      
      // Update transformer offsets based on drag
      this.transformer.offsetX += dx;
      this.transformer.offsetY += dy;
      
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      // Get mouse position relative to canvas
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Get mouse position in world coordinates before zoom
      const worldMouse = this.transformer.toWorld(mouseX, mouseY);
      
      // Compute new scale
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(Math.max(5.0, this.transformer.scale * zoomFactor), 500.0);
      
      this.transformer.scale = newScale;
      
      // Adjust offset so mouse position points to same world coordinate after zoom
      this.transformer.offsetX = mouseX - worldMouse.x * this.transformer.scale;
      this.transformer.offsetY = mouseY + worldMouse.y * this.transformer.scale;
    });
  }

  clear() {
    // Clear with a nice radial/linear space gradient matching CSS
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    // Create subtle dark space gradient
    const grad = this.ctx.createRadialGradient(
      width / 2, height / 2, 10,
      width / 2, height / 2, Math.max(width, height)
    );
    grad.addColorStop(0, '#0d0f2b');
    grad.addColorStop(1, '#060713');
    
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, width, height);
    
    // Draw background grid lines
    this._drawGrid();
  }

  _drawGrid() {
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    this.ctx.lineWidth = 1;
    
    const step = 0.5; // Grid lines every 0.5 meters
    const minW = this.transformer.toWorld(0, this.canvas.height);
    const maxW = this.transformer.toWorld(this.canvas.width, 0);
    
    const startX = Math.floor(minW.x / step) * step;
    const endX = Math.ceil(maxW.x / step) * step;
    const startY = Math.floor(minW.y / step) * step;
    const endY = Math.ceil(maxW.y / step) * step;
    
    // Vertical grid lines
    for (let x = startX; x <= endX; x += step) {
      const c1 = this.transformer.toCanvas(x, startY);
      const c2 = this.transformer.toCanvas(x, endY);
      this.ctx.beginPath();
      this.ctx.moveTo(c1.x, c1.y);
      this.ctx.lineTo(c2.x, c2.y);
      this.ctx.stroke();
    }
    
    // Horizontal grid lines
    for (let y = startY; y <= endY; y += step) {
      const c1 = this.transformer.toCanvas(startX, y);
      const c2 = this.transformer.toCanvas(endX, y);
      this.ctx.beginPath();
      this.ctx.moveTo(c1.x, c1.y);
      this.ctx.lineTo(c2.x, c2.y);
      this.ctx.stroke();
    }
    
    // Draw arena boundaries [0, 5] meters
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1.5;
    const p00 = this.transformer.toCanvas(0, 0);
    const p55 = this.transformer.toCanvas(5, 5);
    
    this.ctx.strokeRect(p00.x, p55.y, p55.x - p00.x, p00.y - p55.y);
    this.ctx.restore();
  }

  drawTrack(points) {
    if (!points || points.length === 0) return;
    
    this.ctx.save();
    
    // Subtle road casing
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    this.ctx.lineWidth = this.transformer.distToCanvas(0.2); // 20cm road width
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    
    let start = this.transformer.toCanvas(points[0][0], points[0][1]);
    this.ctx.moveTo(start.x, start.y);
    
    for (let i = 1; i < points.length; i++) {
      let pt = this.transformer.toCanvas(points[i][0], points[i][1]);
      this.ctx.lineTo(pt.x, pt.y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
    
    // Center dashed path
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([4, 6]);
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    
    for (let i = 1; i < points.length; i++) {
      let pt = this.transformer.toCanvas(points[i][0], points[i][1]);
      this.ctx.lineTo(pt.x, pt.y);
    }
    this.ctx.closePath();
    this.ctx.stroke();
    
    this.ctx.restore();
  }

  drawTrails(gtTrail, ekfTrail) {
    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    // 1. Ground truth path (Cyan)
    if (gtTrail && gtTrail.length > 1) {
      this.ctx.strokeStyle = '#00d4ff';
      this.ctx.lineWidth = 2.0;
      this.ctx.shadowBlur = 4;
      this.ctx.shadowColor = '#00d4ff';
      this.ctx.beginPath();
      let start = this.transformer.toCanvas(gtTrail[0][0], gtTrail[0][1]);
      this.ctx.moveTo(start.x, start.y);
      for (let i = 1; i < gtTrail.length; i++) {
        let pt = this.transformer.toCanvas(gtTrail[i][0], gtTrail[i][1]);
        this.ctx.lineTo(pt.x, pt.y);
      }
      this.ctx.stroke();
    }
    
    // 2. EKF Estimated path (Amber)
    if (ekfTrail && ekfTrail.length > 1) {
      this.ctx.strokeStyle = '#ffb347';
      this.ctx.lineWidth = 1.8;
      this.ctx.setLineDash([3, 3]);
      this.ctx.shadowBlur = 0; // Disable shadow for dashed line
      this.ctx.beginPath();
      let start = this.transformer.toCanvas(ekfTrail[0][0], ekfTrail[0][1]);
      this.ctx.moveTo(start.x, start.y);
      for (let i = 1; i < ekfTrail.length; i++) {
        let pt = this.transformer.toCanvas(ekfTrail[i][0], ekfTrail[i][1]);
        this.ctx.lineTo(pt.x, pt.y);
      }
      this.ctx.stroke();
    }
    
    this.ctx.restore();
  }

  drawLandmarks(trueLandmarks, estLandmarks, observedIds) {
    this.ctx.save();
    
    // 1. True Landmarks (Green filled diamonds)
    if (trueLandmarks) {
      trueLandmarks.forEach((lm, idx) => {
        const pt = this.transformer.toCanvas(lm[0], lm[1]);
        const size = 5;
        
        const isObserved = observedIds && observedIds.includes(idx);
        
        this.ctx.save();
        if (isObserved) {
          // Glow green if observed
          this.ctx.shadowBlur = 10;
          this.ctx.shadowColor = '#00ff88';
          this.ctx.fillStyle = '#00ff88';
        } else {
          this.ctx.fillStyle = 'rgba(0, 255, 136, 0.4)';
        }
        
        // Draw diamond
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x, pt.y - size);
        this.ctx.lineTo(pt.x + size, pt.y);
        this.ctx.lineTo(pt.x, pt.y + size);
        this.ctx.lineTo(pt.x - size, pt.y);
        this.ctx.closePath();
        this.ctx.fill();
        
        // Draw little label
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.font = '8px monospace';
        this.ctx.fillText(`L${idx}`, pt.x + 8, pt.y + 3);
        
        this.ctx.restore();
      });
    }

    // 2. Estimated Landmarks & Covariances (Amber circles & Ellipses)
    if (estLandmarks) {
      Object.entries(estLandmarks).forEach(([idStr, est]) => {
        const id = parseInt(idStr);
        const pt = this.transformer.toCanvas(est.x, est.y);
        const isObserved = observedIds && observedIds.includes(id);

        // Draw estimated center
        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, 3, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#ffb347';
        this.ctx.fill();

        // Draw covariance ellipse
        if (est.cov) {
          const ellipse = getCovarianceEllipse(est.cov, 2.447); // 95% confidence
          
          this.ctx.save();
          this.ctx.strokeStyle = isObserved ? 'rgba(255, 179, 71, 0.8)' : 'rgba(255, 179, 71, 0.35)';
          this.ctx.lineWidth = 1;
          if (isObserved) {
            this.ctx.setLineDash([]);
          } else {
            this.ctx.setLineDash([2, 4]);
          }
          
          // Draw rotated ellipse on canvas
          this.ctx.beginPath();
          const rxCanvas = this.transformer.distToCanvas(ellipse.rx);
          const ryCanvas = this.transformer.distToCanvas(ellipse.ry);
          // Note: canvas rotation needs to flip since Y goes down
          this.ctx.ellipse(pt.x, pt.y, rxCanvas, ryCanvas, -ellipse.angle, 0, 2 * Math.PI);
          this.ctx.stroke();
          
          // Draw shaded interior for active observations
          if (isObserved) {
            this.ctx.fillStyle = 'rgba(255, 179, 71, 0.05)';
            this.ctx.fill();
          }
          
          this.ctx.restore();
        }
      });
    }
    
    this.ctx.restore();
  }

  drawVehicle(gtPose, ekfPose, ekfCov, sensorRange, sensorFovDeg, trueLandmarks, observedIds) {
    // 1. Draw FOV Scan Arc on Ground Truth pose
    if (gtPose) {
      this.ctx.save();
      const pos = this.transformer.toCanvas(gtPose[0], gtPose[1]);
      const rangeCanvas = this.transformer.distToCanvas(sensorRange);
      const theta = gtPose[2];
      const fovRad = (sensorFovDeg * Math.PI) / 180.0;
      
      // Draw FOV cone
      this.ctx.fillStyle = 'rgba(0, 212, 255, 0.04)';
      this.ctx.strokeStyle = 'rgba(0, 212, 255, 0.12)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(pos.x, pos.y);
      // Canvas angle runs clockwise, so we flip angles for world coords where Y is up
      // world theta -> canvas -theta
      this.ctx.arc(pos.x, pos.y, rangeCanvas, -theta - fovRad/2, -theta + fovRad/2);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.restore();
    }

    // 2. Draw Active Observation Rays
    if (gtPose && trueLandmarks && observedIds && observedIds.length > 0) {
      this.ctx.save();
      const rPos = this.transformer.toCanvas(gtPose[0], gtPose[1]);
      
      observedIds.forEach(id => {
        if (id < trueLandmarks.length) {
          const lmk = trueLandmarks[id];
          const lPos = this.transformer.toCanvas(lmk[0], lmk[1]);
          
          // Observation ray (gradient glow line)
          const grad = this.ctx.createLinearGradient(rPos.x, rPos.y, lPos.x, lPos.y);
          grad.addColorStop(0, 'rgba(0, 212, 255, 0.6)');
          grad.addColorStop(1, 'rgba(0, 255, 136, 0.1)');
          
          this.ctx.strokeStyle = grad;
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.moveTo(rPos.x, rPos.y);
          this.ctx.lineTo(lPos.x, lPos.y);
          this.ctx.stroke();
        }
      });
      this.ctx.restore();
    }

    // 3. Draw EKF Pose Uncertainty Ellipse
    if (ekfPose && ekfCov) {
      this.ctx.save();
      const pos = this.transformer.toCanvas(ekfPose[0], ekfPose[1]);
      // Extract x-y covariance
      const covXY = [
        [ekfCov[0][0], ekfCov[0][1]],
        [ekfCov[1][0], ekfCov[1][1]]
      ];
      const ellipse = getCovarianceEllipse(covXY, 2.447); // 95% confidence
      
      this.ctx.strokeStyle = '#ffb347';
      this.ctx.lineWidth = 1.5;
      this.ctx.fillStyle = 'rgba(255, 179, 71, 0.08)';
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = '#ffb347';
      
      this.ctx.beginPath();
      const rxCanvas = this.transformer.distToCanvas(ellipse.rx);
      const ryCanvas = this.transformer.distToCanvas(ellipse.ry);
      this.ctx.ellipse(pos.x, pos.y, rxCanvas, ryCanvas, -ellipse.angle, 0, 2 * Math.PI);
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.restore();
    }

    // 4. Draw EKF Estimated Vehicle Icon (Semi-transparent Amber)
    if (ekfPose) {
      this._drawVehicleIcon(ekfPose, '#ffb347', 0.55);
    }

    // 5. Draw Ground Truth Vehicle Icon (Opaque Cyan)
    if (gtPose) {
      this._drawVehicleIcon(gtPose, '#00d4ff', 1.0);
    }
  }

  _drawVehicleIcon(pose, color, alpha) {
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    
    const pt = this.transformer.toCanvas(pose[0], pose[1]);
    const theta = pose[2];
    
    // Shift & rotate coordinate system to vehicle frame
    this.ctx.translate(pt.x, pt.y);
    this.ctx.rotate(-theta); // canvas rotation is clockwise, flip world heading
    
    // Scale vehicle size relative to world grid
    // Robot is approx 24cm long, 16cm wide
    const length = this.transformer.distToCanvas(0.26);
    const width = this.transformer.distToCanvas(0.18);
    
    // Draw vehicle chassis (sleek rectangle)
    this.ctx.fillStyle = color;
    this.ctx.shadowBlur = alpha > 0.8 ? 10 : 0;
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.roundRect(-length/2, -width/2, length, width, this.transformer.distToCanvas(0.04));
    this.ctx.fill();
    
    // Draw wheels (small black rectangles)
    this.ctx.fillStyle = '#050714';
    this.ctx.shadowBlur = 0;
    const wheelL = length * 0.3;
    const wheelW = width * 0.22;
    // Front wheels
    this.ctx.fillRect(length/3 - wheelL/2, -width/2 - wheelW/3, wheelL, wheelW);
    this.ctx.fillRect(length/3 - wheelL/2, width/2 - 2*wheelW/3, wheelL, wheelW);
    // Rear wheels
    this.ctx.fillRect(-length/3 - wheelL/2, -width/2 - wheelW/3, wheelL, wheelW);
    this.ctx.fillRect(-length/3 - wheelL/2, width/2 - 2*wheelW/3, wheelL, wheelW);

    // Front cabin window
    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.roundRect(length/8, -width/3, length/4, 2*width/3, 2);
    this.ctx.fill();

    // Directional heading arrow (small line at front tip)
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2.0;
    this.ctx.beginPath();
    this.ctx.moveTo(length/2, 0);
    this.ctx.lineTo(length/2 + 8, 0);
    this.ctx.stroke();

    this.ctx.restore();
  }
}
