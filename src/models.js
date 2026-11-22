import * as THREE from 'three';
import { makeCamoTexture } from './textures.js';

const cache = {};
function mat(key, make) { return cache[key] || (cache[key] = make()); }
const std = (color, rough = 0.7, metal = 0.2, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

function mesh(geo, m, x = 0, y = 0, z = 0, parent) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
}

export function makeHeliModel(scheme = 'player') {
  const g = new THREE.Group();
  const colors = { player: 0x4c5a3c, enemy: 0x3d3f44, medevac: 0xe9e6de };
  const bodyMat = mat('heli-' + scheme, () => std(0xffffff, 0.55, 0.35, { map: makeCamoTexture('#' + new THREE.Color(colors[scheme]).getHexString(), scheme.length * 7) }));
  const dark = mat('dark', () => std(0x1d1f22, 0.6, 0.5));
  const glass = mat('glass', () => std(0x0d1a22, 0.05, 0.9, { envMapIntensity: 1.5 }));
  const body = mesh(new THREE.SphereGeometry(1.6, 20, 14), bodyMat, 0, 0, 0, g); body.scale.set(1, 1.05, 2.3);
  const canopy = mesh(new THREE.SphereGeometry(1.35, 20, 14), glass, 0, 0.35, -1.75, g); canopy.scale.set(0.95, 0.82, 1.35);
  mesh(new THREE.BoxGeometry(1.6, 0.8, 2.6), bodyMat, 0, 1.45, 0.6, g);
  const boom = mesh(new THREE.CylinderGeometry(0.22, 0.5, 6.4, 10).rotateX(Math.PI / 2), bodyMat, 0, 0.45, 5.6, g);
  boom.rotation.x = -0.05;
  mesh(new THREE.BoxGeometry(0.16, 2.0, 1.1), bodyMat, 0, 1.35, 8.6, g).rotation.x = -0.35;
  mesh(new THREE.BoxGeometry(2.4, 0.08, 0.6), bodyMat, 0, 0.55, 7.4, g);
  // skids
  for (const sx of [-1.15, 1.15]) {
    const sk = mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.8, 6).rotateX(Math.PI / 2), dark, sx, -1.95, -0.3, g);
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), dark, sx * 0.85, -1.4, -1.3, g).rotation.z = sx * 0.3;
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), dark, sx * 0.85, -1.4, 0.8, g).rotation.z = sx * 0.3;
  }
  // stub wings + pods
  mesh(new THREE.BoxGeometry(4.8, 0.1, 0.8), bodyMat, 0, -0.25, -0.1, g);
  for (const sx of [-2.1, 2.1]) {
    mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.8, 10).rotateX(Math.PI / 2), dark, sx, -0.55, -0.3, g);
  }
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6).rotateX(Math.PI / 2), dark, 0, -1.1, -3.5, g);
  // main rotor
  const rotor = new THREE.Group(); rotor.position.set(0, 2.05, 0.2); g.add(rotor);
  mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.4, 10), dark, 0, 0, 0, rotor);
  const bladeGeo = new THREE.BoxGeometry(0.38, 0.05, 6.4).translate(0, 0, 3.3);
  for (let i = 0; i < 4; i++) { const b = mesh(bladeGeo, dark, 0, 0, 0, rotor); b.rotation.y = (i * Math.PI) / 2; }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(6.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.copy(rotor.position); g.add(disc);
  // tail rotor
  const tail = new THREE.Group(); tail.position.set(0.2, 1.5, 8.7); g.add(tail);
  const tb = new THREE.BoxGeometry(0.04, 2.0, 0.18);
  mesh(tb, dark, 0, 0, 0, tail); mesh(tb, dark, 0, 0, 0, tail).rotation.x = Math.PI / 2;
  // nav lights
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.2), toneMapped: false }));
  red.position.set(-2.45, -0.25, -0.1); g.add(red);
  const green = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 4, 0.4), toneMapped: false }));
  green.position.set(2.45, -0.25, -0.1); g.add(green);
  return { group: g, rotor, tail, disc };
}

export function makeTank() {
  const g = new THREE.Group();
  const camo = mat('tank', () => std(0xffffff, 0.8, 0.3, { map: makeCamoTexture('#6b6440', 3) }));
  const dark = mat('dark', () => std(0x1d1f22, 0.6, 0.5));
  mesh(new THREE.BoxGeometry(3.4, 1.1, 6.6), camo, 0, 1.05, 0, g);
  for (const sx of [-1.65, 1.65]) mesh(new THREE.BoxGeometry(0.7, 1.1, 6.9), dark, sx, 0.6, 0, g);
  const turret = new THREE.Group(); turret.position.y = 1.6; g.add(turret);
  mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.9, 8), camo, 0, 0.45, 0.3, turret);
  const barrel = new THREE.Group(); barrel.position.set(0, 0.5, -0.8); turret.add(barrel);
  mesh(new THREE.CylinderGeometry(0.12, 0.15, 4.2, 8).rotateX(Math.PI / 2), dark, 0, 0, -2.1, barrel);
  return { group: g, turret, barrel };
}

export function makeTruck(cover = 0x4f5a37) {
  const g = new THREE.Group();
  const paint = mat('truck', () => std(0x515a3a, 0.75, 0.2));
  const canvas = mat('canvas' + cover, () => std(cover, 0.95, 0));
  const dark = mat('dark', () => std(0x1d1f22, 0.6, 0.5));
  const glass = mat('glass', () => std(0x0d1a22, 0.05, 0.9));
  mesh(new THREE.BoxGeometry(2.4, 1.8, 2.0), paint, 0, 1.6, -2.4, g);
  mesh(new THREE.BoxGeometry(2.2, 0.7, 0.1), glass, 0, 2.0, -3.42, g);
  mesh(new THREE.BoxGeometry(2.4, 0.4, 6.6), dark, 0, 0.85, -0.2, g);
  mesh(new THREE.CylinderGeometry(1.25, 1.25, 4.2, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), canvas, 0, 1.6, 1.1, g);
  mesh(new THREE.BoxGeometry(2.5, 0.6, 4.2), canvas, 0, 1.35, 1.1, g);
  const wg = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2);
  for (const z of [-2.4, 0.5, 1.8]) for (const x of [-1.15, 1.15]) mesh(wg, dark, x, 0.5, z, g);
  return { group: g };
}

export function makeAAGun() {
  const g = new THREE.Group();
  const paint = mat('aa', () => std(0xffffff, 0.8, 0.3, { map: makeCamoTexture('#5e6345', 9) }));
  const dark = mat('dark', () => std(0x1d1f22, 0.6, 0.5));
  const sand = mat('sand', () => std(0x9b8a68, 1, 0, { flatShading: true }));
  const ring = mesh(new THREE.TorusGeometry(3.6, 0.7, 6, 14).rotateX(Math.PI / 2), sand, 0, 0.5, 0, g);
  ring.scale.y = 1.2;
  mesh(new THREE.CylinderGeometry(1.4, 1.7, 0.8, 10), paint, 0, 0.4, 0, g);
  const turret = new THREE.Group(); turret.position.y = 0.9; g.add(turret);
  mesh(new THREE.BoxGeometry(1.8, 1.0, 1.6), paint, 0, 0.5, 0, turret);
  const barrel = new THREE.Group(); barrel.position.set(0, 0.8, -0.3); turret.add(barrel);
  for (const sx of [-0.35, 0.35]) mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 6).rotateX(Math.PI / 2), dark, sx, 0, -1.6, barrel);
  return { group: g, turret, barrel };
}

export function makeSAM() {
  const g = new THREE.Group();
  const paint = mat('sam', () => std(0xffffff, 0.8, 0.3, { map: makeCamoTexture('#5a5f48', 12) }));
  const dark = mat('dark', () => std(0x1d1f22, 0.6, 0.5));
  const white = mat('mwhite', () => std(0xdedad0, 0.5, 0.2));
  mesh(new THREE.BoxGeometry(2.8, 1.2, 6.5), paint, 0, 1.2, 0, g);
  const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12).rotateZ(Math.PI / 2);
  for (const z of [-2.2, 0, 2.2]) for (const x of [-1.3, 1.3]) mesh(wg, dark, x, 0.55, z, g);
  const turret = new THREE.Group(); turret.position.set(0, 1.9, 0.8); g.add(turret);
  const rack = new THREE.Group(); turret.add(rack);
  mesh(new THREE.BoxGeometry(2.0, 0.3, 4.5), paint, 0, 0, 0, rack);
  for (const x of [-0.6, 0.6]) for (const y of [0.35, 0.85]) mesh(new THREE.CylinderGeometry(0.2, 0.2, 4.2, 8).rotateX(Math.PI / 2), white, x, y, 0, rack);
  rack.rotation.x = 0.5;
  return { group: g, turret, barrel: rack };
}

export function makeRadar() {
  const g = new THREE.Group();
  const metal = mat('radarmetal', () => std(0x9a9e97, 0.5, 0.6));
  const white = mat('mwhite', () => std(0xdedad0, 0.5, 0.2));
  mesh(new THREE.BoxGeometry(8, 4, 6), metal, 0, 2, 0, g);
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) mesh(new THREE.CylinderGeometry(0.18, 0.25, 12, 6), metal, x, 10, z, g);
  mesh(new THREE.BoxGeometry(4, 0.5, 4), metal, 0, 16, 0, g);
  const turret = new THREE.Group(); turret.position.y = 16.5; g.add(turret);
  const dish = mesh(new THREE.SphereGeometry(5, 20, 10, 0, Math.PI * 2, 0, 0.9), white, 0, 3, 0, turret);
  dish.rotation.x = Math.PI / 2 + 0.3; dish.material = white;
  dish.geometry.translate(0, -4, 0);
  mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 6), metal, 0, 1.5, 0, turret);
  return { group: g, turret };
}

export function makeBunker() {
  const g = new THREE.Group();
  const concrete = mat('concrete', () => std(0x8a8a80, 0.95, 0, { flatShading: true }));
  const b = mesh(new THREE.CylinderGeometry(5, 6.5, 3.5, 8), concrete, 0, 1.75, 0, g);
  mesh(new THREE.BoxGeometry(5, 0.5, 1), mat('dark', () => std(0x1d1f22, 0.6, 0.5)), 0, 2.2, -5.6, g);
  return { group: g, body: b };
}

export function makeTent() {
  const g = new THREE.Group();
  const canvas = mat('tentcanvas', () => std(0x5d6040, 1, 0, { side: THREE.DoubleSide }));
  const t = mesh(new THREE.CylinderGeometry(3, 3, 7, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 6 + Math.PI / 2), canvas, 0, 1.5, 0, g);
  t.scale.set(1, 1, 1);
  return { group: g };
}

export function makePerson(vest = 0xff6a10) {
  const g = new THREE.Group();
  const vestM = mat('vest' + vest, () => std(vest, 0.8, 0));
  const skin = mat('skin', () => std(0xd6a684, 0.8, 0));
  const pants = mat('pants', () => std(0x2d3340, 0.9, 0));
  mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.7, 8), vestM, 0, 1.25, 0, g);
  mesh(new THREE.SphereGeometry(0.17, 10, 8), skin, 0, 1.78, 0, g);
  for (const x of [-0.12, 0.12]) mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.9, 6), pants, x, 0.45, 0, g);
  const arm = new THREE.Group(); arm.position.set(0.3, 1.5, 0); g.add(arm);
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), vestM, 0, 0.35, 0, arm);
  const arm2 = new THREE.Group(); arm2.position.set(-0.3, 1.5, 0); g.add(arm2);
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), vestM, 0, 0.35, 0, arm2);
  g.scale.setScalar(1.15);
  return { group: g, arm, arm2 };
}

export function makeMissile() {
  const g = new THREE.Group();
  const white = mat('mwhite', () => std(0xdedad0, 0.5, 0.2));
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 6).rotateX(Math.PI / 2), white);
  g.add(m);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6).rotateX(-Math.PI / 2), white);
  nose.position.z = -0.85; g.add(nose);
  return g;
}
