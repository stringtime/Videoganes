import * as THREE from 'three';
import { createNoise2D, fbm, smoothstep, lerp, mulberry32, clamp } from './noise.js';
import { makeDetailTexture, makeWaterNormal, makeCloudTexture, makeHelipadTexture } from './textures.js';

export const SIZE = 3400;
export const SEG = 340;
export const HALF = SIZE / 2;
export const WATER = 0;

// Named places used by missions. h is filled in during generation.
export const LOC = {
  base:     { x: 0, z: 0, r: 75, blend: 90, min: 8 },
  lake:     { x: 700, z: -620, r: 270 },
  island:   { x: 700, z: -620, r: 22 },
  village:  { x: -720, z: -380, r: 130, blend: 90, min: 10 },
  crash:    { x: -260, z: -1050, r: 40, blend: 70, min: 10 },
  depot:    { x: 950, z: 320, r: 100, blend: 90, min: 10 },
  radar:    { x: -900, z: 720, r: 60, blend: 80, min: 30 },
  fortress: { x: 280, z: 1080, r: 120, blend: 90, min: 12 },
  pass:     { x: -1100, z: -100, r: 50, blend: 70, min: 10 },
};

const nA = createNoise2D(1337), nB = createNoise2D(4242), nC = createNoise2D(77);

function rawHeight(x, z) {
  const d = Math.hypot(x, z) / HALF;
  const mask = 1 - smoothstep(0.6, 0.93, d);
  let h = fbm(nA, x * 0.0011, z * 0.0011, 5) * 95 + 38;
  const r = 1 - Math.abs(nB(x * 0.0021, z * 0.0021));
  h += Math.pow(r, 3) * 120 * smoothstep(-0.3, 0.5, fbm(nC, x * 0.0005 + 7, z * 0.0005 - 3, 2));
  h += fbm(nC, x * 0.01, z * 0.01, 3) * 4;
  return lerp(-40, h, mask);
}

function shapedHeight(x, z) {
  let h = rawHeight(x, z);
  // lake
  const L = LOC.lake, dl = Math.hypot(x - L.x, z - L.z);
  h = lerp(h, -16, 1 - smoothstep(L.r * 0.55, L.r, dl));
  const I = LOC.island;
  h = lerp(h, 2.5, 1 - smoothstep(I.r, I.r + 14, dl));
  // flattened zones
  for (const k of ['base', 'village', 'crash', 'depot', 'radar', 'fortress', 'pass']) {
    const p = LOC[k];
    const d = Math.hypot(x - p.x, z - p.z);
    h = lerp(p.h, h, smoothstep(p.r, p.r + p.blend, d));
  }
  return h;
}

export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.colliders = []; // {min:Vector3, max:Vector3}
    this.time = 0;
    this.rand = mulberry32(2024);

    for (const k of ['base', 'village', 'crash', 'depot', 'radar', 'fortress', 'pass']) {
      const p = LOC[k];
      p.h = Math.max(rawHeight(p.x, p.z), p.min ?? 6);
    }
    LOC.island.h = 2.5; LOC.lake.h = 0;

    this.buildHeights();
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildVegetation();
    this.buildClouds();
    this.buildBase();
    this.buildVillage();
  }

  buildHeights() {
    const n = SEG + 1;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -HALF + (i / SEG) * SIZE, z = -HALF + (j / SEG) * SIZE;
      this.heights[j * n + i] = shapedHeight(x, z);
    }
  }

  heightAt(x, z) {
    const fx = ((x + HALF) / SIZE) * SEG, fz = ((z + HALF) / SIZE) * SEG;
    if (fx < 0 || fz < 0 || fx >= SEG || fz >= SEG) return -40;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, n = SEG + 1;
    const a = this.heights[j * n + i], b = this.heights[j * n + i + 1];
    const c = this.heights[(j + 1) * n + i], d = this.heights[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  groundAt(x, z) { return Math.max(this.heightAt(x, z), WATER); }

  slopeAt(x, z) {
    const e = 4;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  // true if segment from a to b is blocked by terrain
  terrainBlocks(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / 25);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), z = lerp(a.z, b.z, t);
      if (this.heightAt(x, z) > y + 1) return true;
    }
    return false;
  }

  buildSky() {
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 36), THREE.MathUtils.degToRad(35));
    const horizon = new THREE.Color().setRGB(0.56, 0.68, 0.82);
    const zenith = new THREE.Color().setRGB(0.07, 0.2, 0.52);
    const skyMat = () => new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: this.sunDir }, uHorizon: { value: horizon }, uZenith: { value: zenith }, uGround: { value: new THREE.Color().setRGB(0.32, 0.38, 0.42) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uSun, uHorizon, uZenith, uGround; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
          col = mix(col, uGround, smoothstep(0.0, -0.08, h));
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.85, 0.6) * (pow(s, 6.0) * 0.28 + pow(s, 64.0) * 0.6);
          col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9994, 0.9997, s) * 30.0;
          // warm haze band near horizon
          col += vec3(0.08, 0.06, 0.03) * exp(-abs(h) * 18.0);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), skyMat());
    sky.frustumCulled = false; sky.renderOrder = -10;
    this.scene.add(sky);
    this.sky = sky;

    // environment map from sky
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat()));
    this.scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    this.scene.environmentIntensity = 0.6;

    this.fogColor = horizon.clone().add(new THREE.Color().setRGB(0.08, 0.06, 0.03));
    this.scene.fog = new THREE.Fog(this.fogColor, 600, 4200);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0da, 3.2);
    sun.position.copy(this.sunDir).multiplyScalar(600);
    if (this.quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
      const s = 220;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 1500 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
    }
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  updateSun(focus) {
    // keep shadow frustum centred on the player, snapped to texels to avoid shimmer
    const step = 440 / (this.quality.shadowSize || 1024);
    const fx = Math.round(focus.x / step) * step, fz = Math.round(focus.z / step) * step;
    this.sun.target.position.set(fx, focus.y * 0.5, fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 700);
  }

  buildTerrain() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const n = SEG + 1;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const sand = new THREE.Color().setRGB(0.78, 0.71, 0.52, THREE.SRGBColorSpace);
    const grassA = new THREE.Color().setRGB(0.27, 0.45, 0.17, THREE.SRGBColorSpace);
    const grassB = new THREE.Color().setRGB(0.42, 0.5, 0.22, THREE.SRGBColorSpace);
    const forest = new THREE.Color().setRGB(0.2, 0.33, 0.14, THREE.SRGBColorSpace);
    const rock = new THREE.Color().setRGB(0.47, 0.44, 0.4, THREE.SRGBColorSpace);
    const snow = new THREE.Color().setRGB(0.93, 0.95, 0.98, THREE.SRGBColorSpace);
    const dirt = new THREE.Color().setRGB(0.47, 0.4, 0.3, THREE.SRGBColorSpace);
    const concrete = new THREE.Color().setRGB(0.55, 0.55, 0.52, THREE.SRGBColorSpace);
    const under = new THREE.Color().setRGB(0.36, 0.38, 0.3, THREE.SRGBColorSpace);

    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const h = this.heights[idx];
      const x = pos.getX(idx), z = pos.getZ(idx);
      pos.setY(idx, h);
      const slope = this.slopeAt(x, z);
      const v = fbm(nC, x * 0.004, z * 0.004, 3) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, v);
      c.lerp(forest, smoothstep(0.55, 0.75, fbm(nA, x * 0.002 + 50, z * 0.002, 2) * 0.5 + 0.5) * 0.8);
      if (h < 4.5) c.lerp(sand, smoothstep(4.5, 2, h));
      if (h < -1) c.lerp(under, smoothstep(-1, -8, h));
      c.lerp(rock, smoothstep(0.45, 0.85, slope));
      c.lerp(rock, smoothstep(120, 170, h) * 0.8);
      c.lerp(snow, smoothstep(185, 215, h + v * 20) * (1 - smoothstep(0.6, 1.0, slope)));
      for (const k of ['village', 'crash', 'depot', 'radar', 'fortress', 'pass']) {
        const p = LOC[k], d = Math.hypot(x - p.x, z - p.z);
        c.lerp(dirt, (1 - smoothstep(p.r * 0.7, p.r + 20, d)) * 0.75);
      }
      const db = Math.hypot(x - LOC.base.x, z - LOC.base.z);
      c.lerp(concrete, 1 - smoothstep(LOC.base.r - 10, LOC.base.r + 5, db));
      colors[idx * 3] = c.r; colors[idx * 3 + 1] = c.g; colors[idx * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const detail = makeDetailTexture();
    detail.repeat.set(SIZE / 24, SIZE / 24);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 });
    // second, larger-scale detail layer to break up tiling
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 tA = texture2D( map, vMapUv );
          vec4 tB = texture2D( map, vMapUv * 0.071 + 0.3 );
          diffuseColor.rgb *= mix(vec3(1.0), tA.rgb * 1.35, 0.55) * mix(vec3(1.0), tB.rgb * 1.35, 0.45);
        #endif
      `);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  buildWater() {
    const normal = makeWaterNormal();
    normal.repeat.set(900, 900);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1b4a5c, roughness: 0.06, metalness: 0.2, normalMap: normal,
      normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9, envMapIntensity: 1.2,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), mat);
    water.position.y = WATER;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
  }

  buildVegetation() {
    const count = this.quality.trees;
    const rand = mulberry32(11);
    const conTrunk = new THREE.CylinderGeometry(0.35, 0.5, 3, 5).translate(0, 1.5, 0);
    const conCrown = new THREE.ConeGeometry(3.2, 10, 7).translate(0, 7.5, 0);
    const decCrown = new THREE.IcosahedronGeometry(4, 0).scale(1, 0.9, 1).translate(0, 6.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const trunks = new THREE.InstancedMesh(conTrunk, trunkMat, count);
    const cones = new THREE.InstancedMesh(conCrown, crownMat, count);
    const blobs = new THREE.InstancedMesh(decCrown, crownMat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    let nt = 0, nc = 0, nb = 0, tries = 0;
    const avoid = Object.values(LOC).filter((l) => l !== LOC.lake);
    while (nt < count && tries < count * 20) {
      tries++;
      const x = (rand() - 0.5) * SIZE * 0.92, z = (rand() - 0.5) * SIZE * 0.92;
      const h = this.heightAt(x, z);
      if (h < 4 || h > 175) continue;
      if (this.slopeAt(x, z) > 0.75) continue;
      const dens = fbm(nA, x * 0.002 + 50, z * 0.002, 2) * 0.5 + 0.5;
      if (rand() > smoothstep(0.35, 0.7, dens) + 0.05) continue;
      if (avoid.some((l) => Math.hypot(x - l.x, z - l.z) < (l.r || 30) + 15)) continue;
      const sc = 0.7 + rand() * 0.8;
      p.set(x, h - 0.3, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28); s.set(sc, sc * (0.85 + rand() * 0.4), sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(nt++, m);
      const conifer = h > 60 ? rand() < 0.85 : rand() < 0.35;
      if (conifer) {
        col.setRGB(0.13 + rand() * 0.06, 0.28 + rand() * 0.08, 0.13 + rand() * 0.04, THREE.SRGBColorSpace);
        cones.setColorAt(nc, col); cones.setMatrixAt(nc++, m);
      } else {
        col.setRGB(0.25 + rand() * 0.12, 0.42 + rand() * 0.12, 0.15 + rand() * 0.06, THREE.SRGBColorSpace);
        blobs.setColorAt(nb, col); blobs.setMatrixAt(nb++, m);
      }
    }
    trunks.count = nt; cones.count = nc; blobs.count = nb;
    for (const im of [trunks, cones, blobs]) {
      im.castShadow = this.quality.shadows; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      this.scene.add(im);
    }

    // rocks
    const rockGeo = new THREE.DodecahedronGeometry(2, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 1, flatShading: true }), 600);
    let nr = 0;
    for (let i = 0; i < 4000 && nr < 600; i++) {
      const x = (rand() - 0.5) * SIZE * 0.9, z = (rand() - 0.5) * SIZE * 0.9;
      const h = this.heightAt(x, z);
      if (h < 1 || this.slopeAt(x, z) < 0.35) continue;
      if (avoid.some((l) => Math.hypot(x - l.x, z - l.z) < (l.r || 30))) continue;
      const sc = 0.6 + rand() * 2.2;
      p.set(x, h, z); q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)); s.set(sc, sc * 0.7, sc * 1.2);
      m.compose(p, q, s); rocks.setMatrixAt(nr++, m);
    }
    rocks.count = nr; rocks.castShadow = this.quality.shadows; rocks.receiveShadow = true; rocks.frustumCulled = false;
    this.scene.add(rocks);
  }

  buildClouds() {
    this.clouds = [];
    const texs = [makeCloudTexture(1), makeCloudTexture(2), makeCloudTexture(3)];
    const rand = mulberry32(5);
    for (let i = 0; i < this.quality.clouds; i++) {
      const mat = new THREE.SpriteMaterial({ map: texs[i % 3], transparent: true, depthWrite: false, opacity: 0.85, fog: true });
      const sp = new THREE.Sprite(mat);
      const sc = 260 + rand() * 380;
      sp.scale.set(sc, sc * 0.5, 1);
      sp.position.set((rand() - 0.5) * 5000, 380 + rand() * 260, (rand() - 0.5) * 5000);
      this.scene.add(sp);
      this.clouds.push(sp);
    }
  }

  addCollider(cx, cy, cz, sx, sy, sz) {
    this.colliders.push({ min: new THREE.Vector3(cx - sx / 2, cy, cz - sz / 2), max: new THREE.Vector3(cx + sx / 2, cy + sy, cz + sz / 2) });
  }

  box(w, h, d, mat, x, y, z, ry = 0, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z); m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
    if (collide) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      this.addCollider(x, y, z, w * c + d * s, h, w * s + d * c);
    }
    return m;
  }

  buildBase() {
    const B = LOC.base, y = B.h;
    this.basePad = new THREE.Vector3(B.x, y, B.z);
    // helipad
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.4, 48), [
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
      new THREE.MeshStandardMaterial({ map: makeHelipadTexture(), roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
    ]);
    pad.position.set(B.x, y + 0.2, B.z); pad.receiveShadow = true;
    this.scene.add(pad);
    // pad lights
    const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 0.4), toneMapped: false });
    this.padLights = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), lightMat);
      l.position.set(B.x + Math.cos(a) * 17, y + 0.5, B.z + Math.sin(a) * 17);
      this.scene.add(l); this.padLights.push(l);
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x8b9188, roughness: 0.6, metalness: 0.5 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x59603f, roughness: 0.85 });
    const white = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.8 });
    // hangar (half cylinder)
    const hg = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 36, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), metal);
    hg.position.set(B.x - 45, y, B.z + 30); hg.rotation.y = 0.2; hg.castShadow = hg.receiveShadow = true;
    this.scene.add(hg);
    this.addCollider(B.x - 45, y, B.z + 30, 30, 14, 38);
    // control tower
    this.box(6, 18, 6, white, B.x + 42, y, B.z - 30);
    this.box(9, 4, 9, glass, B.x + 42, y + 18, B.z - 30);
    this.box(10, 0.6, 10, olive, B.x + 42, y + 22, B.z - 30, 0, false);
    // barracks + fuel
    this.box(22, 5, 9, olive, B.x + 35, y, B.z + 38, 0.1);
    this.box(22, 5, 9, olive, B.x + 8, y, B.z + 52, -0.05);
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 7, 16), white);
      t.position.set(B.x - 50 + i * 8, y + 3.5, B.z - 40); t.castShadow = t.receiveShadow = true; this.scene.add(t);
      this.addCollider(B.x - 50 + i * 8, y, B.z - 40, 6, 7, 6);
    }
    // windsock
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 9, 6), metal);
    pole.position.set(B.x + 25, y + 4.5, B.z - 12); this.scene.add(pole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 10, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff6a1a, side: THREE.DoubleSide }));
    sock.position.set(B.x + 27, y + 8.6, B.z - 12); this.scene.add(sock); this.windsock = sock;
    // parked helicopters / jeeps are added by main via makeHeliModel to avoid circular import
  }

  buildVillage() {
    const V = LOC.village, rand = mulberry32(33);
    const wall = [0xd8cdb4, 0xcbb994, 0xe2dccf, 0xb9a68a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    const roof = [0x8a3b28, 0x6e3324, 0x5a4a3e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }));
    this.villageHouses = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.3, r = 30 + rand() * 75;
      const x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      const w = 8 + rand() * 5, d = 7 + rand() * 4, h = 4.5 + rand() * 2;
      const ry = a + Math.PI / 2;
      const y = this.heightAt(x, z) - 0.5;
      this.box(w, h, d, wall[i % 4], x, y, z, ry);
      const rr = d * 0.64;
      const rf = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, w * 1.08, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.6, 1), roof[i % 3]);
      rf.position.set(x, y + h + rr * 0.3, z); rf.rotation.y = ry; rf.castShadow = true;
      this.scene.add(rf);
      this.villageHouses.push(new THREE.Vector3(x, y, z));
    }
    // church tower
    const ct = wall[2];
    this.box(6, 20, 6, ct, V.x, V.h - 0.5, V.z);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.6, 10, 4), roof[0]);
    spire.position.set(V.x, V.h + 24.5, V.z); spire.rotation.y = Math.PI / 4; spire.castShadow = true;
    this.scene.add(spire);
  }

  update(dt, focus) {
    this.time += dt;
    this.water.material.normalMap.offset.set(this.time * 0.004, this.time * 0.0025);
    this.updateSun(focus);
    const pulse = (Math.sin(this.time * 4) * 0.5 + 0.5) * 1.4 + 0.3;
    this.padLights[0].material.color.setRGB(0.25 * pulse, 1.5 * pulse, 0.35 * pulse);
    this.windsock.rotation.y = Math.sin(this.time * 0.7) * 0.25;
    for (const c of this.clouds) { c.position.x += dt * 3; if (c.position.x > 2600) c.position.x -= 5200; }
  }
}
