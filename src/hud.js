import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = $('hud');
    this.hdg = $('hdg').getContext('2d');
    this.radar = $('radar').getContext('2d');
    this.msgEl = $('msg'); this.msgT = 0;
    this.markerPool = []; this.bracketPool = [];
    this.hoist = 0; this.frame = 0;
    this.els = {
      spd: $('spd').querySelector('b'), alt: $('alt').querySelector('b'), ralt: $('ralt'), obj: $('objectives'),
      warn: $('warn'), lockwarn: $('lockwarn'), hoist: $('hoist'), hoistBar: $('hoist').querySelector('i'),
      hp: document.querySelector('#status .bar.hp i'), hpBar: document.querySelector('#status .bar.hp'),
      mg: $('ammoMg'), rk: $('ammoRk'), fl: $('ammoFl'), pax: $('pax'), hit: $('hitflash'), reticle: $('reticle'),
      fpm: $('fpm'), hint: $('hint'), markers: $('markers'),
    };
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  message(text, dur = 2) { this.msgEl.textContent = text; this.msgEl.classList.add('on'); this.msgT = dur; }

  marker(i) {
    if (!this.markerPool[i]) {
      const d = document.createElement('div'); d.className = 'mk';
      d.innerHTML = '<div class="d"></div><div class="l"></div><div class="r"></div>';
      this.els.markers.appendChild(d); this.markerPool[i] = d;
    }
    return this.markerPool[i];
  }
  bracket(i) {
    if (!this.bracketPool[i]) {
      const d = document.createElement('div'); d.className = 'br'; d.innerHTML = '<span></span>';
      this.els.markers.appendChild(d); this.bracketPool[i] = d;
    }
    return this.bracketPool[i];
  }

  project(pos, cam, W, H) {
    _v.copy(pos).project(cam);
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
    if (behind) { x = W - x; y = H - y; }
    const m = 40;
    const on = !behind && x > m && x < W - m && y > m && y < H - m;
    if (!on) {
      const cx = W / 2, cy = H / 2;
      let dx = x - cx, dy = y - cy;
      if (behind && Math.abs(dy) < 1) dy = 1;
      const s = Math.min((W / 2 - m) / Math.abs(dx || 1e-3), (H / 2 - m) / Math.abs(dy || 1e-3));
      if (behind || s < 1) { x = cx + dx * s; y = cy + dy * s; }
    }
    return { x, y, on };
  }

  update(dt, g) {
    const P = g.player, cam = g.camera;
    const W = innerWidth, H = innerHeight;
    this.frame++;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msgEl.classList.remove('on'); }
    const e = this.els;
    const hs = Math.hypot(P.vel.x, P.vel.z) * 3.6;
    e.spd.textContent = Math.round(hs);
    e.alt.textContent = Math.round(Math.max(0, P.pos.y - 2));
    e.ralt.textContent = 'R ' + Math.round(P.agl);
    e.warn.style.display = g.weapons.missileWarning ? 'block' : 'none';
    e.lockwarn.style.display = g.lockWarn && !g.weapons.missileWarning ? 'block' : 'none';
    e.hoist.style.display = P.hoist ? 'block' : 'none';
    e.hoistBar.style.width = (this.hoist * 100).toFixed(0) + '%';
    e.hp.style.width = Math.max(0, P.hp) + '%';
    e.hpBar.classList.toggle('low', P.hp < 35);
    e.mg.textContent = P.mg; e.rk.textContent = P.rockets; e.fl.textContent = P.flares; e.pax.textContent = P.passengers + '/8';
    e.hit.style.opacity = Math.min(1, P.hitFlash * 4 + (P.hp < 25 ? 0.25 + Math.sin(g.time * 6) * 0.1 : 0));
    e.reticle.classList.toggle('locked', !!P.lockTarget);
    const cockpit = P.view === 'cockpit';
    e.reticle.style.display = cockpit ? '' : 'none';

    // flight path marker
    if (cockpit && P.vel.length() > 3) {
      const p = this.project(_v.copy(P.pos).addScaledVector(P.vel, 3), cam, W, H);
      e.fpm.style.display = p.on ? 'block' : 'none';
      e.fpm.style.left = p.x + 'px'; e.fpm.style.top = p.y + 'px';
    } else e.fpm.style.display = 'none';

    // hints
    let hint = '';
    if (P.rpm < 0.95 && P.landed) hint = 'TRIEBWERK LÄUFT AN …';
    else if (P.onPad && (P.hp < 100 || P.rockets < 16 || P.mg < 900)) hint = 'REPARATUR & MUNITION …';
    else if (P.outOfBounds) hint = '⚠ EINSATZGEBIET VERLASSEN – UMKEHREN';
    e.hint.textContent = hint;

    // objectives (low frequency)
    if (this.frame % 10 === 0 && g.mission) {
      const obj = g.mission.objectives(g);
      e.obj.innerHTML = `<div class="t">${g.mission.title}</div>` + obj.map((o) =>
        `<div class="o${o.done ? ' done' : ''}${o.warn ? ' warn' : ''}${o.optional ? ' opt' : ''}">${o.text}</div>`).join('');
    }

    // mission markers
    const marks = g.mission ? g.mission.markers(g) : [];
    let i = 0;
    for (const m of marks) {
      const el = this.marker(i++);
      const p = this.project(_v.copy(m.pos).setY(m.pos.y + 4), cam, W, H);
      el.style.display = 'block';
      el.className = 'mk ' + m.type + (p.on ? '' : ' edge');
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      const d = P.pos.distanceTo(m.pos);
      el.children[1].textContent = m.label;
      el.children[2].textContent = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    }
    for (; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';

    // enemy brackets
    let b = 0;
    for (const en of g.enemies) {
      if (!en.alive) continue;
      const d = P.pos.distanceTo(en.pos);
      if (d > 1400) continue;
      _v.copy(en.pos).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) continue;
      const el = this.bracket(b++);
      const size = Math.max(16, Math.min(80, (en.radius * 2.4 / d) * H * 1.2));
      el.style.display = 'block';
      el.style.left = (_v.x * 0.5 + 0.5) * W + 'px'; el.style.top = (-_v.y * 0.5 + 0.5) * H + 'px';
      el.style.width = el.style.height = size + 'px';
      el.className = 'br' + (P.lockTarget === en ? ' lock' : '');
      el.firstChild.textContent = d < 900 ? en.name : '';
      if (b > 30) break;
    }
    for (; b < this.bracketPool.length; b++) this.bracketPool[b].style.display = 'none';

    if (this.frame % 2 === 0) { this.drawHeading(P); this.drawRadar(g, marks); }
    this.hoist = 0;
  }

  drawHeading(P) {
    const c = this.hdg, W = 420, H = 44;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = c.fillStyle = '#7dff9a'; c.lineWidth = 2; c.font = '16px "Share Tech Mono", monospace'; c.textAlign = 'center';
    c.shadowColor = 'rgba(80,255,120,0.6)'; c.shadowBlur = 6;
    const hdg = ((-P.yaw * 180) / Math.PI % 360 + 360) % 360;
    for (let a = Math.floor((hdg - 50) / 5) * 5; a <= hdg + 50; a += 5) {
      const x = W / 2 + (a - hdg) * 4;
      const v = ((a % 360) + 360) % 360;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, v % 10 === 0 ? 12 : 6); c.stroke();
      if (v % 30 === 0) c.fillText({ 0: 'N', 90: 'O', 180: 'S', 270: 'W' }[v] ?? String(v).padStart(3, '0'), x, 30);
    }
    c.beginPath(); c.moveTo(W / 2, 14); c.lineTo(W / 2 - 6, 22); c.lineTo(W / 2 + 6, 22); c.closePath(); c.fill();
    c.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), W / 2, 43);
  }

  drawRadar(g, marks) {
    const c = this.radar, S = 200, R = 96, P = g.player, range = 1500;
    c.clearRect(0, 0, S, S);
    c.save(); c.translate(S / 2, S / 2);
    c.fillStyle = 'rgba(0,25,8,0.55)'; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(125,255,154,0.5)'; c.lineWidth = 1.5;
    for (const r of [R, R * 0.66, R * 0.33]) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(-R, 0); c.lineTo(R, 0); c.moveTo(0, -R); c.lineTo(0, R); c.stroke();
    // sweep
    const sw = (g.time * 2) % (Math.PI * 2);
    const grd = c.createConicGradient ? c.createConicGradient(sw - 0.6, 0, 0) : null;
    if (grd) { grd.addColorStop(0, 'rgba(125,255,154,0)'); grd.addColorStop(0.095, 'rgba(125,255,154,0.25)'); grd.addColorStop(0.1, 'rgba(125,255,154,0)'); c.fillStyle = grd; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill(); }
    const cos = Math.cos(P.yaw), sin = Math.sin(P.yaw);
    const plot = (p, col, size, shape) => {
      const dx = p.x - P.pos.x, dz = p.z - P.pos.z;
      // rotate so that heli forward is up
      let x = (dx * cos - dz * sin) / range * R, y = (dx * sin + dz * cos) / range * R;
      const l = Math.hypot(x, y); if (l > R - 4) { x *= (R - 4) / l; y *= (R - 4) / l; }
      c.fillStyle = col; c.beginPath();
      if (shape === 'd') { c.moveTo(x, y - size); c.lineTo(x + size, y); c.lineTo(x, y + size); c.lineTo(x - size, y); c.closePath(); }
      else c.arc(x, y, size, 0, Math.PI * 2);
      c.fill();
    };
    plot(g.world.basePad, '#6fc8ff', 5, 'd');
    for (const e of g.enemies) if (e.alive) plot(e.pos, e.air ? '#ff7055' : '#ff3b2a', e.air ? 4 : 3);
    for (const m of marks) plot(m.pos, m.type === 'rescue' ? '#6dff8a' : m.type === 'base' ? '#6fc8ff' : '#ffb020', 5, 'd');
    for (const r of g.weapons.rockets) if (r.homing === P) plot(r.pos, '#fff', 2.5);
    c.restore();
    c.fillStyle = '#7dff9a'; c.beginPath(); c.moveTo(S / 2, S / 2 - 7); c.lineTo(S / 2 - 5, S / 2 + 5); c.lineTo(S / 2 + 5, S / 2 + 5); c.closePath(); c.fill();
  }
}
