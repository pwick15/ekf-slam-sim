/**
 * Manages the interactive onboarding tutorial slides for EKF-SLAM.
 * Uses KaTeX to render slide equations, and guides the user through the simulator's components.
 */

export class TutorialManager {
  constructor(callbacks = {}) {
    this.overlay = document.getElementById('tutorial-overlay');
    this.slides = document.querySelectorAll('.tutorial-slide');
    this.dots = document.querySelectorAll('.tutorial-dots .dot');
    this.btnPrev = document.getElementById('btn-tutorial-prev');
    this.btnNext = document.getElementById('btn-tutorial-next');
    this.btnSkip = document.getElementById('btn-skip-tutorial');
    this.progressLine = document.getElementById('tutorial-progress-line');
    
    this.currentSlide = 0;
    this.totalSlides = this.slides.length;
    this.onOpen = callbacks.onOpen;
    this.onClose = callbacks.onClose;
    
    this._bindEvents();
    this.updateUI();
    this.renderMath();
  }

  _bindEvents() {
    // Next button click
    this.btnNext.addEventListener('click', () => {
      if (this.currentSlide < this.totalSlides - 1) {
        this.goToSlide(this.currentSlide + 1);
      } else {
        this.close();
      }
    });

    // Previous button click
    this.btnPrev.addEventListener('click', () => {
      if (this.currentSlide > 0) {
        this.goToSlide(this.currentSlide - 1);
      }
    });

    // Skip/Close button click
    this.btnSkip.addEventListener('click', () => this.close());

    // Dot indicators clicks
    this.dots.forEach((dot, idx) => {
      dot.addEventListener('click', () => this.goToSlide(idx));
    });

    // Global tutorial open button hook
    const btnOpen = document.getElementById('btn-open-tutorial');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => this.open());
    }
  }

  goToSlide(index) {
    if (index < 0 || index >= this.totalSlides) return;
    this.currentSlide = index;
    this.updateUI();
  }

  updateUI() {
    // Set active slide
    this.slides.forEach((slide, idx) => {
      slide.classList.toggle('active', idx === this.currentSlide);
    });

    // Set active dot
    this.dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === this.currentSlide);
    });

    // Configure buttons
    this.btnPrev.disabled = (this.currentSlide === 0);
    
    if (this.currentSlide === this.totalSlides - 1) {
      this.btnNext.textContent = "Start Simulation";
    } else {
      this.btnNext.textContent = "Next";
    }

    // Progress line update
    const percentage = ((this.currentSlide + 1) / this.totalSlides) * 100;
    this.progressLine.style.width = `${percentage}%`;
  }

  open() {
    this.overlay.classList.remove('hidden');
    this.goToSlide(0);
    if (this.onOpen) this.onOpen();
  }

  close() {
    this.overlay.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  renderMath() {
    if (!window.katex) {
      // Retry in case KaTeX is loading asynchronously
      setTimeout(() => this.renderMath(), 200);
      return;
    }

    try {
      const stateEl = document.getElementById('slide-katex-state');
      if (stateEl) {
        window.katex.render(
          `x = \\begin{bmatrix} x_r & y_r & \\theta & m_{1,x} & m_{1,y} & \\dots \\end{bmatrix}^T`,
          stateEl,
          { displayMode: true, throwOnError: false }
        );
      }

      const covEl = document.getElementById('slide-katex-cov');
      if (covEl) {
        window.katex.render(
          `P = \\begin{bmatrix} \\Sigma_{rr} & \\Sigma_{rm} \\\\ \\Sigma_{mr} & \\Sigma_{mm} \\end{bmatrix}`,
          covEl,
          { displayMode: true, throwOnError: false }
        );
      }
    } catch (e) {
      console.warn("KaTeX slide rendering failed:", e);
    }
  }
}
