/**
 * Client-side mathematical utilities for coordinate transforms,
 * covariance ellipse calculations, and trajectory metrics.
 */

/**
 * Computes ellipse parameters (semi-major axis, semi-minor axis, rotation angle)
 * from a 2D covariance matrix.
 * 
 * @param {Array<Array<number>>} cov - 2x2 covariance matrix [[Pxx, Pxy], [Pyx, Pyy]]
 * @param {number} scaleFactor - Scaling factor for confidence interval (default: 2.447 for 95% confidence)
 * @returns {Object} { rx: majorRadius, ry: minorRadius, angle: rotationAngleInRadians }
 */
export function getCovarianceEllipse(cov, scaleFactor = 2.447) {
  const Pxx = cov[0][0];
  const Pxy = cov[0][1];
  const Pyy = cov[1][1];

  // Calculate trace and determinant
  const trace = Pxx + Pyy;
  const det = Pxx * Pyy - Pxy * Pxy;

  // Compute eigenvalues
  const discriminant = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const L1 = trace / 2 + discriminant;
  const L2 = trace / 2 - discriminant;

  // Semi-axes lengths
  const rx = Math.sqrt(Math.max(0, L1)) * scaleFactor;
  const ry = Math.sqrt(Math.max(0, L2)) * scaleFactor;

  // Compute rotation angle (direction of the major eigenvector)
  let angle = 0;
  if (Pxy !== 0) {
    angle = Math.atan2(L1 - Pxx, Pxy);
  } else if (Pxx < Pyy) {
    angle = Math.PI / 2;
  }

  return { rx, ry, angle };
}

/**
 * Manages 2D world-to-canvas coordinate transformations with panning and zoom.
 */
export class CoordinateTransformer {
  constructor(canvas) {
    this.canvas = canvas;
    // Default world dimensions [0.0, 5.0] x [0.0, 5.0]
    this.minWorldX = -0.5;
    this.maxWorldX = 5.5;
    this.minWorldY = -0.5;
    this.maxWorldY = 5.5;

    // Viewport transforms (auto-set in resize)
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * Resets transformer zoom and offset to fit the [0, 5] workspace with a margin.
   */
  fitToWorkspace() {
    const pad = 0.5;
    this.minWorldX = 0 - pad;
    this.maxWorldX = 5 + pad;
    this.minWorldY = 0 - pad;
    this.maxWorldY = 5 + pad;
    this.updateScale();
  }

  updateScale() {
    const width = this.canvas.width;
    const height = this.canvas.height;

    const worldWidth = this.maxWorldX - this.minWorldX;
    const worldHeight = this.maxWorldY - this.minWorldY;

    // Fit keeping aspect ratio
    const scaleX = width / worldWidth;
    const scaleY = height / worldHeight;
    this.scale = Math.min(scaleX, scaleY);

    // Center the viewport
    this.offsetX = (width - worldWidth * this.scale) / 2 - this.minWorldX * this.scale;
    // Note: Canvas Y runs downwards, so we flip Y
    this.offsetY = (height - worldHeight * this.scale) / 2 + this.maxWorldY * this.scale;
  }

  /**
   * Translates world coordinate (wx, wy) to canvas coordinate (cx, cy).
   */
  toCanvas(wx, wy) {
    const cx = wx * this.scale + this.offsetX;
    const cy = this.offsetY - wy * this.scale; // Flips Y axis so global Y goes up
    return { x: cx, y: cy };
  }

  /**
   * Translates canvas coordinate (cx, cy) back to world coordinate (wx, wy).
   */
  toWorld(cx, cy) {
    const wx = (cx - this.offsetX) / this.scale;
    const wy = (this.offsetY - cy) / this.scale;
    return { x: wx, y: wy };
  }

  /**
   * Scales a world distance to canvas pixels (without offsets).
   */
  distToCanvas(dist) {
    return dist * this.scale;
  }
}
