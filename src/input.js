import { clamp, damp } from './noise.js';

const DZ = 0.14;
const dz = (v) => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));
const pick = (...v) => v.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);

export class Input {
  constructor(canvas) {
    this.state = { pitch: 0, roll: 0, yaw: 0, collective: 0, mg: false, rocket: false };
    this.edges = new Set(); // one-shot actions: flare, view, pause, confirm, up, down, back
    this.keys = new Set();
    this.kb = { pitch: 0, roll: 0, yaw: 0, collective: 0 };
    this.mouse = { left: false, right: false };
    this.touch = { lx: 0, ly: 0, rx: 0, ry: 0, mg: false, rocket: false };
    this.tilt = { enabled: false, available: false, beta: 0, gamma: 0, b0: 0, g0: 0, invert: false, sens: 1 };
    this.gamepad = null;
    this.padPrev = [];
    this.lastDevice = 'keyboard';
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.lastDevice = 'keyboard';
      const map = { KeyG: 'flare', KeyL: 'flare', KeyV: 'view', KeyP: 'pause', Escape: 'pause', Enter: 'confirm', KeyM: 'mute', KeyT: 'calib' };
      if (map[e.code]) this.edges.add(map[e.code]);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      this.lastDevice = 'keyboard';
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('deviceorientation', (e) => {
      if (e.beta == null) return;
      this.tilt.available = true;
      this.tilt.beta = e.beta; this.tilt.gamma = e.gamma;
      if (!this.tilt.calibrated) this.calibrate();
    });
    this.setupTouch();
  }

  async requestTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      this.tilt.enabled = true;
      this.tilt.calibrated = false;
      return true;
    } catch { return false; }
  }

  calibrate() { this.tilt.b0 = this.tilt.beta; this.tilt.g0 = this.tilt.gamma; this.tilt.calibrated = true; }

  tiltAxes() {
    const t = this.tilt;
    if (!t.enabled || !t.available) return [0, 0];
    const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    const db = t.beta - t.b0, dg = t.gamma - t.g0;
    let p, r;
    if (ang === 90) { p = -dg; r = db; }
    else if (ang === 270 || ang === -90) { p = dg; r = -db; }
    else { p = db; r = dg; }
    const full = 22 / t.sens;
    p = clamp(p / full, -1, 1); r = clamp(r / full, -1, 1);
    if (t.invert) p = -p;
    const tdz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
    return [tdz(p), tdz(r)];
  }

  setupTouch() {
    const bindStick = (id, setter) => {
      const el = document.getElementById(id);
      if (!el) return;
      const knob = el.querySelector('.knob');
      let tid = null, cx = 0, cy = 0;
      const R = () => el.clientWidth * 0.4;
      const move = (t) => {
        let dx = (t.clientX - cx) / R(), dy = (t.clientY - cy) / R();
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        knob.style.transform = `translate(${dx * R()}px, ${dy * R()}px)`;
        setter(dx, dy);
      };
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0]; tid = t.identifier;
        const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        move(t); this.lastDevice = 'touch';
      }, { passive: false });
      el.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === tid) move(t);
      }, { passive: false });
      const end = (e) => {
        for (const t of e.changedTouches) if (t.identifier === tid) { tid = null; knob.style.transform = ''; setter(0, 0); }
      };
      el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    };
    bindStick('stickL', (x, y) => { this.touch.lx = x; this.touch.ly = y; });
    bindStick('stickR', (x, y) => { this.touch.rx = x; this.touch.ry = y; });

    document.querySelectorAll('[data-btn]').forEach((b) => {
      const k = b.dataset.btn;
      const down = (e) => {
        e.preventDefault(); b.classList.add('on'); this.lastDevice = 'touch';
        if (k === 'mg' || k === 'rocket') this.touch[k] = true; else this.edges.add(k);
      };
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); if (k === 'mg' || k === 'rocket') this.touch[k] = false; };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('mousedown', down); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);
    });
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.gamepad = gp;
    if (!gp) return null;
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const pressed = (i) => b(i) && !this.padPrev[i];
    const map = { 0: 'confirm', 1: 'back', 4: 'flare', 3: 'view', 9: 'pause', 8: 'calib', 12: 'up', 13: 'down' };
    for (const [i, e] of Object.entries(map)) if (pressed(+i)) { this.edges.add(e); this.lastDevice = 'gamepad'; }
    if (pressed(1)) this.edges.add('flare');
    this.padPrev = gp.buttons.map((_, i) => b(i));
    const ax = (i) => dz(gp.axes[i] || 0);
    const r = {
      yaw: ax(0), collective: -ax(1), roll: ax(2), pitch: -ax(3),
      mg: b(7), rocket: b(6) || b(5),
    };
    // analog trigger axes on some browsers
    if (Math.abs(r.yaw) + Math.abs(r.collective) + Math.abs(r.roll) + Math.abs(r.pitch) > 0.05 || r.mg || r.rocket) this.lastDevice = 'gamepad';
    // menu navigation with stick
    const ly = gp.axes[1] || 0;
    if (ly < -0.6 && !this.stickNav) { this.edges.add('up'); this.stickNav = true; }
    else if (ly > 0.6 && !this.stickNav) { this.edges.add('down'); this.stickNav = true; }
    else if (Math.abs(ly) < 0.3) this.stickNav = false;
    return r;
  }

  update(dt) {
    const k = (c) => this.keys.has(c);
    const target = {
      pitch: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      roll: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      yaw: (k('KeyE') || k('ArrowRight') ? 1 : 0) - (k('KeyQ') || k('ArrowLeft') ? 1 : 0),
      collective: (k('Space') || k('ArrowUp') || k('ShiftLeft') ? 1 : 0) - (k('KeyC') || k('ArrowDown') || k('ControlLeft') ? 1 : 0),
    };
    for (const a in target) this.kb[a] = damp(this.kb[a], target[a], target[a] === 0 ? 7 : 4, dt);

    const gp = this.pollGamepad() || { pitch: 0, roll: 0, yaw: 0, collective: 0, mg: false, rocket: false };
    const [tp, tr] = this.tiltAxes();
    const s = this.state;
    s.pitch = clamp(pick(this.kb.pitch, gp.pitch, tp, -this.touch.ry), -1, 1);
    s.roll = clamp(pick(this.kb.roll, gp.roll, tr, this.touch.rx), -1, 1);
    s.yaw = clamp(pick(this.kb.yaw, gp.yaw, this.touch.lx), -1, 1);
    s.collective = clamp(pick(this.kb.collective, gp.collective, -this.touch.ly), -1, 1);
    s.mg = k('KeyJ') || this.mouse.left || gp.mg || this.touch.mg;
    s.rocket = k('KeyK') || this.mouse.right || gp.rocket || this.touch.rocket;
    if (this.edges.has('calib')) this.calibrate();
    if (this.tilt.enabled) this.lastDevice = this.lastDevice === 'gamepad' ? 'gamepad' : 'touch';
  }

  consume(e) { if (this.edges.has(e)) { this.edges.delete(e); return true; } return false; }
  clearEdges() { this.edges.clear(); }
}
