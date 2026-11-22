import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Tileable value noise (periodic lattice)
function tileNoise(size, freqs, seed) {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let total = 0;
  for (const [f, amp] of freqs) {
    const g = new Float32Array(f * f);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    total += amp;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * f, fy = (y / size) * f;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % f) * f + (x0 % f)], b = g[(y0 % f) * f + ((x0 + 1) % f)];
      const c = g[((y0 + 1) % f) * f + (x0 % f)], d = g[((y0 + 1) % f) * f + ((x0 + 1) % f)];
      out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function makeDetailTexture() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const n = tileNoise(S, [[4, 0.4], [16, 0.3], [64, 0.2], [128, 0.1]], 7);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 170 + (n[i] - 0.5) * 150;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, v));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makeWaterNormal() {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const waves = [];
  const rand = mulberry32(99);
  for (let i = 0; i < 14; i++) {
    const kx = Math.round((rand() - 0.5) * 16), ky = Math.round((rand() - 0.5) * 16);
    waves.push([kx || 1, ky, rand() * Math.PI * 2, 1 / (1 + Math.hypot(kx, ky) * 0.35)]);
  }
  const h = (u, v) => { let s = 0; for (const [kx, ky, p, a] of waves) s += a * Math.sin(2 * Math.PI * (kx * u + ky * v) + p); return s; };
  const img = ctx.createImageData(S, S);
  const e = 1 / S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const dx = (h(u + e, v) - h(u - e, v)) * 0.6, dy = (h(u, v + e) - h(u, v - e)) * 0.6;
    const nx = -dx, ny = -dy, nz = 1, l = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeSoftParticle() {
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  const n = tileNoise(S, [[4, 0.5], [8, 0.3], [16, 0.2]], 3);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    let a = Math.max(0, 1 - r); a = a * a * (3 - 2 * a);
    a *= 0.55 + n[y * S + x] * 0.9;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

export function makeCloudTexture(seed) {
  const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  for (let i = 0; i < 26; i++) {
    const x = S * (0.2 + rand() * 0.6), y = S * (0.35 + rand() * 0.35), r = S * (0.08 + rand() * 0.16);
    const g = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
    const shade = 225 + rand() * 30;
    g.addColorStop(0, `rgba(${shade},${shade},${shade + 5},0.55)`);
    g.addColorStop(1, 'rgba(200,205,215,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeHelipadTexture() {
  const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3c3e'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},0,0.03)`; ctx.fillRect(Math.random() * S, Math.random() * S, 3, 3); }
  ctx.strokeStyle = '#e8e8e0'; ctx.lineWidth = 18;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f2c21b';
  const w = S * 0.08, hgt = S * 0.42;
  ctx.fillRect(S * 0.32, S / 2 - hgt / 2, w, hgt);
  ctx.fillRect(S * 0.68 - w, S / 2 - hgt / 2, w, hgt);
  ctx.fillRect(S * 0.32, S / 2 - w / 2, S * 0.36, w);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makeCamoTexture(base, seed) {
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, S, S);
  const rand = mulberry32(seed);
  const cols = ['rgba(0,0,0,0.18)', 'rgba(255,255,255,0.07)', 'rgba(60,40,10,0.2)'];
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = cols[i % 3];
    ctx.beginPath(); ctx.ellipse(rand() * S, rand() * S, 6 + rand() * 18, 4 + rand() * 10, rand() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
