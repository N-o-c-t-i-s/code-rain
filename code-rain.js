/* Fixed-grid code rain, rebuilt from the locally verified Code Review rules. */
(function (global) {
  'use strict';
  const CHARACTERS = '012345789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテトナニヌネノ*+.';
  const DEFAULTS = { speed: 1, brightness: 1, fontSize: 14, density: 1, centerFade: 1, motion: 'original', background: '#181818' };
  const FONT = 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  const clamp = (value, lo, hi, fallback) => Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

  function seededRandom(seed) {
    let state = Math.abs(Math.floor(seed)) % 4294967296;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  function characterAt(value) {
    let hash = Math.trunc(value) | 0;
    hash = Math.imul(hash ^ (hash >>> 16), 569420461);
    hash = Math.imul(hash ^ (hash >>> 15), 1935289751);
    hash = (hash ^ (hash >>> 15)) >>> 0;
    return CHARACTERS[hash % 63] || '0';
  }

  function makeChains(rowCount, random) {
    const lengths = [], gaps = [], heads = [];
    let period = 0, longest = 0;
    for (let index = 0; index < 3; index++) {
      const length = 2 + random() ** 2 * Math.min(26, rowCount * 0.4);
      lengths.push(length);
      longest = Math.max(longest, length);
      const gap = 2 + random() ** 2 * Math.max(3, rowCount * 0.25);
      gaps.push(gap);
      period += length + gap;
    }
    const extraGap = Math.max(0, rowCount + longest + 1 - period) / 3;
    period = 0;
    for (let index = 0; index < 3; index++) {
      period += lengths[index] + gaps[index] + extraGap;
      heads.push(period);
    }
    return { lengths, heads, period };
  }

  function makeModel(seed) {
    let columns = [], rows = 0, columnWidth = 18, rowHeight = 19;
    return {
      resize(size, glyphWidth, glyphHeight, fontSize = 14, density = 1) {
        const random = seededRandom(seed);
        rowHeight = Math.max(19 * fontSize / 14, glyphHeight, size.height / 72);
        rows = Math.min(72, Math.ceil(size.height / rowHeight));
        columnWidth = Math.max(18 * fontSize / 14 / density, glyphWidth, size.width / 128);
        columns = Array.from({ length: Math.min(128, Math.ceil(size.width / columnWidth)) }, () => {
          const chains = makeChains(rows, random);
          return {
            ...chains,
            phase: random() * chains.period,
            speed: 3 + random() * 9,
            cadence: 0.07 + random() * 0.6,
            salt: Math.floor(random() * 100000),
            tick: -1,
            glyphs: Array.from({ length: rows }, () => '0')
          };
        });
      },
      frame(time, paint, motion = 'original') {
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
          const column = columns[columnIndex];
          const tick = Math.floor(motion === 'stepped' ? time * column.speed : time / column.cadence);
          if (tick !== column.tick) {
            for (let row = 0; row < rows; row++) column.glyphs[row] = characterAt(column.salt + row * 7919 + tick);
            column.tick = tick;
          }
          for (let chainIndex = 0; chainIndex < 3; chainIndex++) {
            let head = (column.heads[chainIndex] + column.phase + time * column.speed) % column.period;
            if (motion === 'stepped') head = Math.floor(head);
            const length = column.lengths[chainIndex];
            const bottom = Math.min(rows - 1, Math.floor(head));
            for (let row = Math.max(0, Math.ceil(head - length)); row <= bottom; row++) {
              const distance = head - row;
              const alpha = distance < 0.9 ? 1 : 0.65 * (1 - distance / length) ** 1.7;
              paint(columnIndex * columnWidth, row * rowHeight, column.glyphs[row], alpha);
            }
          }
        }
      }
    };
  }

  class CodeRain {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.atlas = document.createElement('canvas');
      this.atlasCtx = this.atlas.getContext('2d');
      if (!this.ctx || !this.atlasCtx) throw new Error('Canvas 2D is unavailable');
      this.options = { ...DEFAULTS, ...options };
      this.seed = options.seed ?? Math.floor(Math.random() * 4294967296);
      this.model = makeModel(this.seed);
      this.time = 0;
      this.paused = false;
      this.destroyed = false;
      this.raf = null;
      this.motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.frame = this.frame.bind(this);
      this.paint = this.paint.bind(this);
      this.onVisibility = () => { this.last = null; this.schedule(); };
      this.onMotion = () => { this.last = null; this.draw(); this.schedule(); };
      this.onResize = () => this.resize();
      this.observer = new ResizeObserver(this.onResize);
      this.normalize();
      this.resize();
      this.observer.observe(canvas);
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('resize', this.onResize);
      this.motion.addEventListener('change', this.onMotion);
      this.schedule();
    }

    normalize() {
      const opts = this.options;
      opts.speed = clamp(opts.speed, 0, 12, 1);
      opts.brightness = clamp(opts.brightness, 0, 3, 1);
      opts.fontSize = clamp(opts.fontSize, 9, 24, 14);
      opts.density = clamp(opts.density, 0.25, 1.5, 1);
      opts.centerFade = clamp(opts.centerFade, 0, 1, 1);
      opts.motion = opts.motion === 'stepped' ? 'stepped' : 'original';
    }

    updateAppearance() {
      this.canvas.style.opacity = String(Math.min(1, 0.45 * this.options.brightness));
      const centerAlpha = 1 - this.options.centerFade;
      const mask = `radial-gradient(rgba(0,0,0,${centerAlpha}) 28%, #000 85%)`;
      this.canvas.style.maskImage = mask;
      this.canvas.style.webkitMaskImage = mask;
      this.canvas.parentElement?.style.setProperty('background-color', this.options.background);
    }

    resize() {
      if (this.destroyed) return;
      const bounds = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, bounds.width);
      this.height = Math.max(1, bounds.height);
      this.nativeDpr = devicePixelRatio || 1;
      this.dpr = Math.min(this.nativeDpr, 2, Math.sqrt(4000000 / (this.width * this.height)));
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.buildAtlas();
      this.model.resize({ width: this.width, height: this.height }, this.glyphWidth, this.glyphHeight, this.options.fontSize, this.options.density);
      this.time = 0;
      this.last = null;
      this.updateAppearance();
      this.draw();
    }

    buildAtlas() {
      const ctx = this.atlasCtx;
      const font = `${this.options.fontSize}px ${FONT}`;
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      let left = 0, right = 0, ascent = 0, descent = 0;
      for (const char of CHARACTERS) {
        const metrics = ctx.measureText(char);
        left = Math.max(left, metrics.actualBoundingBoxLeft);
        right = Math.max(right, metrics.width, metrics.actualBoundingBoxRight);
        ascent = Math.max(ascent, metrics.actualBoundingBoxAscent);
        descent = Math.max(descent, metrics.actualBoundingBoxDescent);
      }
      this.glyphWidth = Math.ceil(left + right) + 2;
      this.glyphHeight = Math.ceil(ascent + descent) + 2;
      this.tileWidth = Math.ceil(this.glyphWidth * this.dpr);
      this.tileHeight = Math.ceil(this.glyphHeight * this.dpr);
      this.atlas.width = this.tileWidth * CHARACTERS.length;
      this.atlas.height = this.tileHeight;
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = getComputedStyle(this.canvas).color;
      this.tiles = new Map();
      for (let index = 0; index < CHARACTERS.length; index++) {
        const char = CHARACTERS[index];
        this.tiles.set(char, index * this.tileWidth);
        ctx.setTransform(-this.dpr, 0, 0, this.dpr, (index + 1) * this.tileWidth, 0);
        ctx.fillText(char, left + 1, ascent + 1);
      }
    }

    paint(x, y, char, alpha) {
      const sourceX = this.tiles.get(char);
      if (sourceX == null || x + this.glyphWidth < 0 || y + this.glyphHeight < 0 || x > this.width || y > this.height) return;
      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(this.atlas, sourceX, 0, this.tileWidth, this.tileHeight, x, y, this.glyphWidth, this.glyphHeight);
    }

    draw() {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.model.frame(this.time, this.paint, this.options.motion);
      this.ctx.globalAlpha = 1;
    }

    setOptions(patch) {
      const oldFontSize = this.options.fontSize, oldDensity = this.options.density;
      Object.assign(this.options, patch);
      this.normalize();
      if (oldFontSize !== this.options.fontSize || oldDensity !== this.options.density) this.resize();
      else { this.updateAppearance(); this.draw(); }
    }

    reset() {
      this.options = { ...DEFAULTS };
      this.resize();
    }

    setPaused(paused) {
      this.paused = Boolean(paused);
      this.last = null;
      if (this.paused) { cancelAnimationFrame(this.raf); this.raf = null; }
      else this.schedule();
    }

    schedule() {
      if (this.destroyed || this.raf !== null || this.paused || document.hidden || this.motion.matches) return;
      this.raf = requestAnimationFrame(this.frame);
    }

    frame(now) {
      this.raf = null;
      if (this.destroyed || this.paused || document.hidden || this.motion.matches) { this.last = null; return; }
      if ((devicePixelRatio || 1) !== this.nativeDpr) this.resize();
      const dt = this.last == null ? 0 : Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.time += dt * this.options.speed;
      this.draw();
      this.schedule();
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
      this.observer.disconnect();
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('resize', this.onResize);
      this.motion.removeEventListener('change', this.onMotion);
      this.atlas.width = this.atlas.height = 0;
      this.tiles.clear();
    }
  }
  global.CodeRain = CodeRain;
})(window);
