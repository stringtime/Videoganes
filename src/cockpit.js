import * as THREE from 'three';

// Interior cockpit attached to the camera rig. Camera sits at local origin looking down -Z.
export class Cockpit {
  constructor() {
    this.group = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.75, metalness: 0.3 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.9, metalness: 0.1 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x3c4434, roughness: 0.8, metalness: 0.1 });
    const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
      o.castShadow = true; o.receiveShadow = true; this.group.add(o); return o;
    };

    // Glare shield (hood above the instrument panel)
    const hood = new THREE.Shape();
    hood.moveTo(-0.82, 0); hood.quadraticCurveTo(0, 0.12, 0.82, 0); hood.lineTo(0.7, -0.3); hood.quadraticCurveTo(0, -0.24, -0.7, -0.3); hood.closePath();
    const hoodGeo = new THREE.ExtrudeGeometry(hood, { depth: 0.04, bevelEnabled: false }).rotateX(-Math.PI / 2 + 0.08);
    add(hoodGeo, panelMat, 0, -0.27, -1.02);

    // Instrument panel with live canvas texture
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 300;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const pbox = add(new THREE.BoxGeometry(1.62, 0.5, 0.05), panelMat, 0, -0.47, -0.97, -0.42);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.44), new THREE.MeshBasicMaterial({ map: this.tex, color: 0xd8d8d8 }));
    panel.position.set(0, 0, 0.03); pbox.add(panel);
    // lower console / chin
    add(new THREE.BoxGeometry(1.7, 0.4, 0.6), olive, 0, -0.85, -0.85, -0.2);

    // A-pillars from dash to roof
    const pillar = (sx) => {
      const a = new THREE.Vector3(sx * 0.82, -0.3, -1.0), b = new THREE.Vector3(sx * 0.9, 0.14, -0.7);
      const len = a.distanceTo(b);
      const m = add(new THREE.BoxGeometry(0.07, len, 0.09), frame, 0, 0, 0);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    };
    pillar(-1); pillar(1);
    // Side window frames (vertical, wide)
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.06, 1.4, 0.06), frame, sx * 1.05, 0.0, -0.2);
      add(new THREE.BoxGeometry(0.06, 0.06, 0.9), frame, sx * 1.02, -0.32, -0.6, 0, 0, 0);
    }
    // Roof bow + overhead console
    const roof = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.028, 6, 28, Math.PI), frame);
    roof.position.set(0, 0.0, -0.7); roof.scale.set(1, 0.46, 1); roof.castShadow = true; this.group.add(roof);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.7), panelMat, 0, 0.66, -0.15);
    // Magnetic compass on the glare shield (off-centre)
    add(new THREE.BoxGeometry(0.07, 0.05, 0.06), panelMat, 0.42, -0.24, -0.98);
    add(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2 }), 0.42, -0.2, -0.98);

    // Cyclic stick top (visible at very bottom on tall screens)
    this.stick = new THREE.Group(); this.stick.position.set(0, -1.05, -0.55); this.group.add(this.stick);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
    grip.position.y = 0.25; this.stick.add(grip);

    this.frame = 0;
  }

  update(data, input) {
    this.stick.rotation.set(-input.pitch * 0.25, 0, -input.roll * 0.25);
    if (this.frame++ % 3) return;
    this.draw(data);
    this.tex.needsUpdate = true;
  }

  gauge(cx, cy, r, label) {
    const c = this.ctx;
    const g = c.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#1d2124'); g.addColorStop(1, '#0a0b0c');
    c.fillStyle = '#2b2f33'; c.beginPath(); c.arc(cx, cy, r + 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7f8a80'; c.font = 'bold 15px monospace'; c.textAlign = 'center';
    c.fillText(label, cx, cy + r * 0.55);
  }

  needle(cx, cy, r, ang, color = '#f3f0e0') {
    const c = this.ctx;
    c.save(); c.translate(cx, cy); c.rotate(ang);
    c.fillStyle = color; c.beginPath(); c.moveTo(-4, 8); c.lineTo(0, -r * 0.88); c.lineTo(4, 8); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = '#333'; c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
  }

  ticks(cx, cy, r, n, a0, a1, labels) {
    const c = this.ctx;
    c.strokeStyle = '#d8d8cc'; c.fillStyle = '#d8d8cc'; c.lineWidth = 2; c.font = '13px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      const big = i % 2 === 0;
      c.beginPath(); c.moveTo(cx + Math.sin(a) * r * (big ? 0.8 : 0.87), cy - Math.cos(a) * r * (big ? 0.8 : 0.87));
      c.lineTo(cx + Math.sin(a) * r * 0.95, cy - Math.cos(a) * r * 0.95); c.stroke();
      if (big && labels) c.fillText(labels(i), cx + Math.sin(a) * r * 0.64, cy - Math.cos(a) * r * 0.64);
    }
    c.textBaseline = 'alphabetic';
  }

  draw(d) {
    const c = this.ctx, W = 1024, H = 300;
    c.fillStyle = '#25292b'; c.fillRect(0, 0, W, H);
    // panel screws / texture
    c.fillStyle = '#1e2224'; c.fillRect(8, 8, W - 16, H - 16);
    const r = 86, cy = 150;

    // 1. Airspeed
    this.gauge(110, cy, r, 'KM/H');
    this.ticks(110, cy, r, 14, -2.6, 2.6, (i) => i * 20);
    this.needle(110, cy, r, -2.6 + Math.min(d.speed * 3.6, 280) / 280 * 5.2);

    // 2. Artificial horizon
    const hx = 310;
    c.save(); c.beginPath(); c.arc(hx, cy, r, 0, Math.PI * 2); c.clip();
    c.translate(hx, cy); c.rotate(d.roll);
    const off = Math.max(-r, Math.min(r, d.pitch * 160));
    c.fillStyle = '#3f7fc4'; c.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
    c.fillStyle = '#7a5532'; c.fillRect(-r * 2, off, r * 4, r * 2);
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-r, off); c.lineTo(r, off); c.stroke();
    for (let i = -3; i <= 3; i++) { if (!i) continue; const y = off - i * 0.0873 * 160; c.beginPath(); c.moveTo(-18 - (i % 2 ? 0 : 10), y); c.lineTo(18 + (i % 2 ? 0 : 10), y); c.stroke(); }
    c.restore();
    c.strokeStyle = '#2b2f33'; c.lineWidth = 10; c.beginPath(); c.arc(hx, cy, r + 4, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#ffb020'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(hx - 50, cy); c.lineTo(hx - 15, cy); c.lineTo(hx - 8, cy + 8); c.moveTo(hx + 50, cy); c.lineTo(hx + 15, cy); c.lineTo(hx + 8, cy + 8); c.stroke();
    c.fillStyle = '#ffb020'; c.beginPath(); c.arc(hx, cy, 4, 0, Math.PI * 2); c.fill();

    // 3. Altimeter
    const ax = 510;
    this.gauge(ax, cy, r, 'ALT M');
    this.ticks(ax, cy, r, 20, 0, Math.PI * 2 * 0.95, (i) => (i / 2) % 10);
    this.needle(ax, cy, r * 0.65, (d.alt / 1000) * Math.PI * 2, '#c9c9b8');
    this.needle(ax, cy, r, ((d.alt % 100) / 100) * Math.PI * 2);
    c.fillStyle = '#000'; c.fillRect(ax - 36, cy + 18, 72, 24);
    c.fillStyle = '#7dff9a'; c.font = 'bold 19px monospace'; c.textAlign = 'center'; c.fillText(String(Math.round(d.alt)).padStart(4, '0'), ax, cy + 37);

    // 4. Vertical speed
    const vx = 710;
    this.gauge(vx, cy, r, 'V/S');
    this.ticks(vx, cy, r, 8, -2.4, 2.4, (i) => Math.abs(i - 4) * 5);
    this.needle(vx, cy, r, Math.max(-2.4, Math.min(2.4, d.vs / 20 * 2.4)));

    // 5. Right column: heading, torque, warning lights
    const rx = 820;
    c.fillStyle = '#050607'; c.fillRect(rx, 40, 180, 54);
    c.save(); c.beginPath(); c.rect(rx, 40, 180, 54); c.clip();
    c.fillStyle = '#7dff9a'; c.font = 'bold 18px monospace'; c.textAlign = 'center';
    const hdg = d.heading;
    for (let a = -60; a <= 60; a += 10) {
      const v = Math.round(hdg / 10) * 10 + a, x = rx + 90 + (v - hdg) * 2.2;
      const vv = ((v % 360) + 360) % 360;
      c.fillRect(x - 1, 40, 2, vv % 30 ? 8 : 14);
      if (vv % 30 === 0) c.fillText({ 0: 'N', 90: 'O', 180: 'S', 270: 'W' }[vv] ?? String(vv / 10), x, 82);
    }
    c.restore();
    c.fillStyle = '#ffb020'; c.beginPath(); c.moveTo(rx + 90, 46); c.lineTo(rx + 84, 36); c.lineTo(rx + 96, 36); c.fill();

    // torque bar
    c.fillStyle = '#050607'; c.fillRect(rx, 110, 80, 130);
    const tq = Math.min(1, d.torque);
    c.fillStyle = tq > 0.9 ? '#ff5040' : '#7dff9a'; c.fillRect(rx + 10, 230 - tq * 110, 25, tq * 110);
    c.fillStyle = '#d0d0c0'; c.font = '13px monospace'; c.fillText('TQ', rx + 22, 252);
    const rpm = d.rpm;
    c.fillStyle = '#7dff9a'; c.fillRect(rx + 45, 230 - rpm * 110, 25, rpm * 110);
    c.fillStyle = '#d0d0c0'; c.fillText('NR', rx + 57, 252);

    // warning lights
    const lights = [
      ['MASTER', d.hp < 35 && (Date.now() / 300) % 2 < 1, '#ff3a2a'],
      ['MISSILE', d.missile && (Date.now() / 150) % 2 < 1, '#ff3a2a'],
      ['WINDE', d.hoist, '#ffb020'],
      ['LANDED', d.landed, '#46ff7a'],
    ];
    lights.forEach(([t, on, col], i) => {
      const y = 112 + i * 34;
      c.fillStyle = on ? col : '#2c2f30'; c.fillRect(rx + 92, y, 88, 26);
      c.fillStyle = on ? '#000' : '#555'; c.font = 'bold 13px monospace'; c.fillText(t, rx + 136, y + 18);
    });
    // screws
    c.fillStyle = '#3a3f42';
    for (const [x, y] of [[16, 16], [W - 16, 16], [16, H - 16], [W - 16, H - 16]]) { c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill(); }
  }
}
