import * as THREE from 'three';
import { makeSoftParticle } from './textures.js';

const VERT = `
  attribute float size;
  attribute float alpha;
  attribute vec3 pcolor;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vFog;
  uniform float uScale;
  uniform float uFogNear;
  uniform float uFogFar;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uScale / max(-mv.z, 0.1);
    vAlpha = alpha;
    vColor = pcolor;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  }`;
const FRAG = `
  uniform sampler2D uTex;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vFog;
  void main() {
    vec4 t = texture2D(uTex, gl_PointCoord);
    float a = t.a * vAlpha;
    if (a < 0.003) discard;
    vec3 col = vColor;
    if (uAdditive > 0.5) { a *= (1.0 - vFog); }
    else { col = mix(col, uFogColor, vFog); }
    gl_FragColor = vec4(col, a);
  }`;

class Particles {
  constructor(scene, max, additive, tex, fog) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTex: { value: tex }, uScale: { value: 500 }, uFogColor: { value: fog.color },
        uFogNear: { value: fog.near }, uFogFar: { value: fog.far }, uAdditive: { value: additive ? 1 : 0 },
      },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
    // sim data
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
  }
  emit(px, py, pz, vx, vy, vz, life, s0, s1, a0, c0, c1, drag = 0, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.c0[i * 3] = c0[0]; this.c0[i * 3 + 1] = c0[1]; this.c0[i * 3 + 2] = c0[2];
    this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
    this.drag[i] = drag; this.grav[i] = grav;
  }
  copy(d, s) {
    const a3 = [this.pos, this.vel, this.c0, this.c1, this.col];
    for (const a of a3) { a[d * 3] = a[s * 3]; a[d * 3 + 1] = a[s * 3 + 1]; a[d * 3 + 2] = a[s * 3 + 2]; }
    for (const a of [this.life, this.maxLife, this.s0, this.s1, this.a0, this.drag, this.grav, this.size, this.alpha]) a[d] = a[s];
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) { this.copy(i, --this.n); continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      const fadeIn = Math.min(1, t * 8);
      this.alpha[i] = this.a0[i] * fadeIn * (1 - t) * (1 - t * 0.3);
      for (let c = 0; c < 3; c++) this.col[i * 3 + c] = this.c0[i * 3 + c] + (this.c1[i * 3 + c] - this.c0[i * 3 + c]) * Math.min(1, t * 1.6);
      i++;
    }
    for (const a of ['position', 'pcolor', 'size', 'alpha']) { const at = this.geo.attributes[a]; at.needsUpdate = true; }
    this.geo.setDrawRange(0, this.n);
  }
}

const R = () => Math.random() - 0.5;

export class Effects {
  constructor(scene, fog, quality) {
    this.scene = scene;
    const tex = makeSoftParticle();
    this.fire = new Particles(scene, quality.particles, true, tex, fog);
    this.smoke = new Particles(scene, quality.particles, false, tex, fog);
    this.shake = 0;
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 120, 1.6);
      scene.add(l); this.lights.push({ l, t: 0 });
    }
    this.burning = []; // {pos, t, rate}

    // tracers
    this.maxTracers = 500;
    const tg = new THREE.BoxGeometry(0.12, 0.12, 1).translate(0, 0, -0.5);
    this.tracerMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), this.maxTracers);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    scene.add(this.tracerMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._f = new THREE.Vector3(0, 0, -1); this._d = new THREE.Vector3();
    this._tc = new THREE.Color();
  }

  setViewport(height, fovDeg) {
    const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.fire.mat.uniforms.uScale.value = s; this.smoke.mat.uniforms.uScale.value = s;
  }

  beginTracers() { this.tracerMesh.count = 0; }
  addTracer(pos, vel, len, color) {
    const i = this.tracerMesh.count;
    if (i >= this.maxTracers) return;
    this._d.copy(vel).normalize();
    this._q.setFromUnitVectors(this._f, this._d);
    this._s.set(1, 1, len);
    this._m.compose(pos, this._q, this._s);
    this.tracerMesh.setMatrixAt(i, this._m);
    this.tracerMesh.setColorAt(i, color);
    this.tracerMesh.count = i + 1;
  }
  endTracers() {
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
  }

  flash(pos, intensity, dur = 0.25) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.copy(pos); L.t = dur; L.dur = dur; L.i = intensity;
  }

  explosion(pos, scale = 1, camPos = null) {
    const s = scale;
    for (let i = 0; i < 26 * s + 6; i++) {
      const v = 14 * s;
      this.fire.emit(pos.x + R() * 2 * s, pos.y + R() * 2 * s, pos.z + R() * 2 * s, R() * v, R() * v + 5 * s, R() * v,
        0.45 + Math.random() * 0.6, 3 * s, 11 * s + Math.random() * 6 * s, 1, [4, 2.4, 0.9], [1.6, 0.35, 0.08], 2.5, -2);
    }
    for (let i = 0; i < 22 * s + 4; i++) {
      const v = 8 * s;
      const g = 0.12 + Math.random() * 0.1;
      this.smoke.emit(pos.x + R() * 3 * s, pos.y + R() * 2 * s, pos.z + R() * 3 * s, R() * v, Math.random() * v * 0.8 + 3, R() * v,
        2.5 + Math.random() * 3 * s, 5 * s, 22 * s + Math.random() * 10, 0.8, [g, g, g], [0.35, 0.34, 0.33], 1.2, -1.5);
    }
    for (let i = 0; i < 30 * s; i++) {
      const v = 40 * s;
      this.fire.emit(pos.x, pos.y, pos.z, R() * v, Math.random() * v * 0.7, R() * v,
        0.6 + Math.random() * 0.8, 0.5, 0.2, 1, [4, 3, 1.4], [1.5, 0.5, 0.1], 0.6, 25);
    }
    this.flash(pos, 60 * s, 0.35);
    if (camPos) this.shake = Math.max(this.shake, Math.min(1.2, (60 * s) / Math.max(20, camPos.distanceTo(pos))));
  }

  impact(pos, dirt = true) {
    for (let i = 0; i < 4; i++)
      this.fire.emit(pos.x, pos.y, pos.z, R() * 12, Math.random() * 10, R() * 12, 0.25, 0.6, 0.1, 1, [4, 3, 1.5], [2, 0.8, 0.1], 0, 20);
    if (dirt) for (let i = 0; i < 3; i++)
      this.smoke.emit(pos.x, pos.y, pos.z, R() * 3, 2 + Math.random() * 4, R() * 3, 0.9 + Math.random() * 0.6, 1.2, 4.5, 0.7, [0.45, 0.38, 0.28], [0.55, 0.5, 0.42], 1.5, 3);
  }

  splash(pos) {
    for (let i = 0; i < 10; i++)
      this.smoke.emit(pos.x + R(), pos.y, pos.z + R(), R() * 4, 6 + Math.random() * 10, R() * 4, 0.9, 1, 3, 0.8, [0.9, 0.95, 1], [0.8, 0.85, 0.9], 0.5, 18);
  }

  muzzle(pos, dir) {
    this.fire.emit(pos.x, pos.y, pos.z, dir.x * 20, dir.y * 20, dir.z * 20, 0.06, 1.2, 0.4, 1, [4, 3, 1.6], [3, 1.5, 0.4]);
  }

  rocketTrail(from, to, vel) {
    this.fire.emit(to.x, to.y, to.z, -vel.x * 0.05, -vel.y * 0.05, -vel.z * 0.05, 0.12, 2.2, 0.8, 1, [5, 3.2, 1.4], [3, 0.8, 0.2]);
    const d = from.distanceTo(to), n = Math.min(24, Math.ceil(d / 1.6));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      this.smoke.emit(x + R() * 0.3, y + R() * 0.3, z + R() * 0.3, R() * 1.2, R() * 1.2 + 0.4, R() * 1.2,
        1.6 + Math.random() * 1.2, 1.4, 6.5, 0.32, [0.88, 0.88, 0.88], [0.62, 0.62, 0.64], 0.8, -0.3);
    }
  }

  flare(pos) {
    this.fire.emit(pos.x, pos.y, pos.z, R(), R(), R(), 0.15, 5, 2, 1, [6, 5, 3.5], [4, 2, 0.6]);
    this.smoke.emit(pos.x, pos.y, pos.z, R(), R() + 0.5, R(), 1.5, 1.5, 4, 0.4, [0.9, 0.9, 0.9], [0.7, 0.7, 0.7], 0.5);
  }

  signalSmoke(pos, color) {
    this.smoke.emit(pos.x + R(), pos.y + 0.5, pos.z + R(), R() * 1.5 + 1.5, 4 + Math.random() * 2, R() * 1.5 + 0.8,
      6 + Math.random() * 3, 1.5, 14, 0.75, color, [color[0] * 0.8 + 0.15, color[1] * 0.8 + 0.15, color[2] * 0.8 + 0.15], 0.25, -0.2);
  }

  downwash(pos, strength, water) {
    if (strength <= 0) return;
    const n = Math.random() < strength ? 2 : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
      const c = water ? [0.85, 0.9, 0.95] : [0.6, 0.53, 0.42];
      this.smoke.emit(pos.x + Math.cos(a) * r, pos.y + 0.3, pos.z + Math.sin(a) * r, Math.cos(a) * 14, 1 + Math.random() * 2, Math.sin(a) * 14,
        1.2, 2, 7, 0.35 * strength, c, c, 1.2, 0);
    }
  }

  addBurning(pos, dur = 25) { this.burning.push({ pos: pos.clone(), t: dur, acc: 0 }); }

  damageSmoke(pos, amount) {
    if (Math.random() < amount) {
      const g = 0.15 + Math.random() * 0.1;
      this.smoke.emit(pos.x + R(), pos.y + R(), pos.z + R(), R() * 2, 1.5, R() * 2, 2.5, 1.5, 7, 0.6, [g, g, g], [0.3, 0.3, 0.3], 0.6);
    }
  }

  update(dt) {
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const b = this.burning[i]; b.t -= dt; b.acc += dt;
      if (b.t <= 0) { this.burning.splice(i, 1); continue; }
      while (b.acc > 0.12) {
        b.acc -= 0.12;
        const k = Math.min(1, b.t / 8);
        this.fire.emit(b.pos.x + R() * 2, b.pos.y + 0.5, b.pos.z + R() * 2, R() * 1, 2 + Math.random() * 2, R() * 1, 0.5 + Math.random() * 0.4, 2.5 * k, 0.8, 1, [3.5, 1.6, 0.4], [1.2, 0.2, 0.05], 0.5, -2);
        const g = 0.08 + Math.random() * 0.08;
        this.smoke.emit(b.pos.x + R() * 2, b.pos.y + 1.5, b.pos.z + R() * 2, R() * 2 + 1, 4 + Math.random() * 2, R() * 2 + 0.5, 4 + Math.random() * 3, 3, 16, 0.6 * k + 0.1, [g, g, g], [0.4, 0.4, 0.4], 0.3, -0.3);
      }
    }
    for (const L of this.lights) {
      if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.t / L.dur) * L.i * 1000; } else L.l.intensity = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.fire.update(dt); this.smoke.update(dt);
  }
}
