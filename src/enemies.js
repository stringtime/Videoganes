import * as THREE from 'three';
import { makeAAGun, makeTank, makeTruck, makeSAM, makeRadar, makeBunker, makeHeliModel, makeTent } from './models.js';
import { clamp } from './noise.js';

const charred = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1, metalness: 0 });
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

export class Enemy {
  constructor(game, x, z, o = {}) {
    this.game = game;
    this.pos = new THREE.Vector3(x, game.world.groundAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.alive = true; this.tag = o.tag || null; this.air = false;
    this.hp = this.maxHp = o.hp || 100; this.radius = o.radius || 3; this.score = o.score || 100;
    this.name = o.name || 'ZIEL'; this.cd = Math.random() * 2; this.yOff = 0; this.heading = o.heading || 0;
  }
  attach(group) {
    this.group = group; group.position.copy(this.pos); group.rotation.y = this.heading;
    this.game.scene.add(group); this.game.enemies.push(this);
  }
  center() { return this.pos; }
  damage(n) {
    if (!this.alive) return;
    this.hp -= n;
    if (this.hp <= 0) this.destroy();
  }
  destroy() {
    this.alive = false;
    const g = this.game;
    g.effects.explosion(this.pos, this.bigBoom || 1, g.camera.position);
    g.audio.burst('explosion', g.volumeAt(this.pos));
    g.effects.addBurning(_v.copy(this.pos).setY(this.groundY ?? this.pos.y - this.yOff), 25);
    this.group.traverse((o) => { if (o.isMesh) o.material = charred; });
    if (this.turret) { this.turret.rotation.z = 0.4; this.turret.position.y -= 0.3; }
    g.onEnemyDestroyed(this);
  }
  canSee(range) {
    const P = this.game.player;
    if (!P.alive) return false;
    const d = this.pos.distanceTo(P.pos);
    if (d > range) return false;
    return !this.game.world.terrainBlocks(_w.copy(this.pos).setY(this.pos.y + 2), P.pos);
  }
  // aim turret toward point, returns true when aligned
  aimTurret(target, dt, rate = 1.5) {
    if (!this.turret) return false;
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const want = Math.atan2(-dx, -dz) - this.group.rotation.y;
    const cur = this.turret.rotation.y;
    const d = angleDiff(cur, want);
    this.turret.rotation.y = cur + clamp(d, -rate * dt, rate * dt);
    if (this.barrel) {
      const el = Math.atan2(target.y - this.pos.y - 2, Math.hypot(dx, dz));
      this.barrel.rotation.x = clamp(el, -0.05, 1.3);
    }
    return Math.abs(d) < 0.12;
  }
  lead(speed, err = 0) {
    const P = this.game.player;
    const t = this.pos.distanceTo(P.pos) / speed;
    const p = _w.copy(P.pos).addScaledVector(P.vel, t * (0.7 + Math.random() * 0.4));
    p.x += (Math.random() - 0.5) * err; p.y += (Math.random() - 0.5) * err; p.z += (Math.random() - 0.5) * err;
    return p;
  }
  update() {}
}

export class AAGun extends Enemy {
  constructor(game, x, z, o = {}) {
    super(game, x, z, { hp: 90, radius: 3.5, score: 150, name: 'FLAK', ...o });
    const m = makeAAGun(); this.turret = m.turret; this.barrel = m.barrel;
    this.attach(m.group); this.pos.y += 1.5; this.yOff = 1.5;
    this.burst = 0; this.range = o.range || 800;
  }
  update(dt) {
    if (!this.alive) return;
    const P = this.game.player;
    this.cd -= dt;
    if (!this.canSee(this.range)) { this.burst = 0; return; }
    const aim = this.lead(420, 13);
    const aligned = this.aimTurret(aim, dt, 1.8);
    if (this.cd <= 0 && aligned) {
      if (this.burst <= 0) this.burst = 8;
      this.burst--; this.cd = this.burst > 0 ? 0.09 : 2.4 + Math.random();
      const muzzle = _v.copy(this.pos).setY(this.pos.y + 1.2);
      const dir = aim.clone().sub(muzzle).normalize();
      this.game.weapons.fireBullet('enemy', muzzle, dir, 420, 1.7, null, true);
      this.game.effects.muzzle(muzzle, dir);
      this.game.audio.burst('enemyMg', this.game.volumeAt(this.pos) * 0.7);
    }
  }
}

class PathMover extends Enemy {
  setPath(points, speed, loop = false) { this.path = points; this.pi = 1; this.speed = speed; this.loop = loop; this.arrived = false; }
  move(dt) {
    if (!this.path || this.arrived) { this.vel.set(0, 0, 0); return; }
    const t = this.path[this.pi];
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 6) {
      this.pi++;
      if (this.pi >= this.path.length) { if (this.loop) this.pi = 0; else { this.arrived = true; return; } }
      return;
    }
    const want = Math.atan2(-dx, -dz);
    this.heading += clamp(angleDiff(this.heading, want), -dt * 0.8, dt * 0.8);
    const sp = this.speed * (Math.abs(angleDiff(this.heading, want)) > 0.6 ? 0.4 : 1);
    this.vel.set(-Math.sin(this.heading) * sp, 0, -Math.cos(this.heading) * sp);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const w = this.game.world;
    const gy = w.groundAt(this.pos.x, this.pos.z);
    this.pos.y = gy + this.yOff;
    this.group.position.set(this.pos.x, gy, this.pos.z);
    this.group.rotation.y = this.heading;
    // pitch along slope
    const ahead = w.groundAt(this.pos.x - Math.sin(this.heading) * 3, this.pos.z - Math.cos(this.heading) * 3);
    this.group.rotation.x = Math.atan2(ahead - gy, 3);
  }
}

export class Truck extends PathMover {
  constructor(game, x, z, o = {}) {
    super(game, x, z, { hp: 45, radius: 3.5, score: 100, name: 'LKW', ...o });
    this.attach(makeTruck(o.cover).group); this.pos.y += 1.5; this.yOff = 1.5;
  }
  update(dt) { if (this.alive) this.move(dt); }
}

export class Tank extends PathMover {
  constructor(game, x, z, o = {}) {
    super(game, x, z, { hp: 180, radius: 3.8, score: 250, name: 'PANZER', ...o });
    const m = makeTank(); this.turret = m.turret; this.barrel = m.barrel;
    this.attach(m.group); this.pos.y += 1.5; this.yOff = 1.5; this.bigBoom = 1.2;
  }
  update(dt) {
    if (!this.alive) return;
    this.move(dt);
    this.cd -= dt;
    if (!this.canSee(650)) return;
    const aim = this.lead(200, 6);
    if (this.aimTurret(aim, dt, 0.9) && this.cd <= 0) {
      this.cd = 4.5 + Math.random() * 2;
      const muzzle = _v.copy(this.pos).setY(this.pos.y + 1.3);
      const dir = aim.clone().sub(muzzle).normalize();
      this.game.weapons.fireRocket('enemy', muzzle.clone().addScaledVector(dir, 5), dir, null, { speed: 200, dmg: 18, splash: 6, life: 5 });
      this.game.effects.muzzle(muzzle.addScaledVector(dir, 5), dir);
      this.game.effects.flash(muzzle, 20, 0.12);
      this.game.audio.burst('impact', this.game.volumeAt(this.pos));
    }
  }
}

export class SAMSite extends Enemy {
  constructor(game, x, z, o = {}) {
    super(game, x, z, { hp: 110, radius: 4, score: 300, name: 'SAM', ...o });
    const m = makeSAM(); this.turret = m.turret; this.rack = m.barrel;
    this.attach(m.group); this.pos.y += 1.8; this.yOff = 1.8; this.bigBoom = 1.4;
    this.lock = 0; this.cd = 3 + Math.random() * 3;
  }
  update(dt) {
    if (!this.alive) return;
    this.cd -= dt;
    const P = this.game.player;
    const see = this.canSee(1100) && P.agl > 6;
    this.aimTurret(P.pos, dt, 1);
    if (see) this.lock += dt; else this.lock = Math.max(0, this.lock - dt * 2);
    this.game.lockWarn = this.game.lockWarn || (this.lock > 0.3 && see);
    if (see && this.lock > 2 && this.cd <= 0) {
      this.cd = 9 + Math.random() * 4; this.lock = 0;
      const p = _v.copy(this.pos).setY(this.pos.y + 3);
      const dir = P.pos.clone().sub(p).normalize(); dir.y = Math.max(dir.y, 0.5); dir.normalize();
      this.game.weapons.fireRocket('enemy', p, dir, null, { speed: 150, dmg: 34, splash: 9, homing: P, turn: 1.25, life: 11 });
      this.game.audio.burst('rocket', this.game.volumeAt(this.pos));
      this.game.hud.message('RAKETE IM ANFLUG – FLARES!', 2);
    }
  }
}

export class Structure extends Enemy {
  constructor(game, x, z, kind, o = {}) {
    const stats = { radar: { hp: 260, radius: 9, score: 400, name: 'RADAR' }, bunker: { hp: 240, radius: 6.5, score: 300, name: 'BUNKER' },
      tent: { hp: 30, radius: 4, score: 50, name: 'ZELT' }, fuel: { hp: 40, radius: 4, score: 120, name: 'TREIBSTOFF' } }[kind];
    super(game, x, z, { ...stats, ...o });
    this.kind = kind;
    let m;
    if (kind === 'radar') { m = makeRadar(); this.turret = m.turret; this.pos.y += 8; this.yOff = 8; this.bigBoom = 1.8; }
    else if (kind === 'bunker') { m = makeBunker(); this.pos.y += 2; this.yOff = 2; this.bigBoom = 1.5; }
    else if (kind === 'tent') { m = makeTent(); this.pos.y += 1.5; this.yOff = 1.5; }
    else { m = { group: new THREE.Group() };
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 14), new THREE.MeshStandardMaterial({ color: 0x6d7356, roughness: 0.6, metalness: 0.4 }));
      tank.rotation.z = Math.PI / 2; tank.position.y = 3; tank.castShadow = tank.receiveShadow = true; m.group.add(tank);
      this.pos.y += 3; this.yOff = 3; this.bigBoom = 2.2; }
    this.attach(m.group);
    this.groundY = this.pos.y - this.yOff;
  }
  update(dt) { if (this.alive && this.kind === 'radar') this.turret.rotation.y += dt * 0.8; }
}

export class EnemyHeli extends Enemy {
  constructor(game, x, z, o = {}) {
    super(game, x, z, { hp: 120, radius: 5, score: 500, name: 'HELI', ...o });
    this.model = makeHeliModel('enemy');
    this.attach(this.model.group);
    this.air = true;
    this.pos.y = game.world.groundAt(x, z) + (o.alt || 80);
    this.heading = o.heading || 0; this.pitch = 0; this.roll = 0;
    this.state = 'hunt'; this.burst = 0; this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.t = Math.random() * 10;
    this.patrol = o.patrol || null; this.aggro = o.aggro ?? 1400;
    this.spin = 0; this.falling = false;
  }
  destroy() {
    if (this.falling) return;
    this.alive = false; this.falling = true;
    this.game.effects.explosion(this.pos, 0.6, this.game.camera.position);
    this.game.audio.burst('explosion', this.game.volumeAt(this.pos) * 0.7);
    this.game.onEnemyDestroyed(this);
  }
  update(dt) {
    const w = this.game.world, P = this.game.player;
    this.spin += dt * 30; this.model.rotor.rotation.y = this.spin; this.model.tail.rotation.x = this.spin * 2;
    if (this.falling) {
      this.vel.y -= 9.81 * dt; this.pos.addScaledVector(this.vel, dt);
      this.heading += dt * 5; this.group.rotation.set(0.3, this.heading, 0.4);
      this.group.position.copy(this.pos);
      this.game.effects.damageSmoke(this.pos, 1); this.game.effects.damageSmoke(this.pos, 1);
      if (this.pos.y < w.groundAt(this.pos.x, this.pos.z) + 1) {
        this.falling = false;
        this.game.effects.explosion(this.pos, 1.5, this.game.camera.position);
        this.game.effects.addBurning(this.pos, 30);
        this.game.audio.burst('explosion', this.game.volumeAt(this.pos));
        this.group.traverse((o) => { if (o.isMesh) o.material = charred; });
        this.model.disc.visible = false;
      }
      return;
    }
    if (!this.alive) return;
    this.t += dt; this.cd -= dt;
    const toP = _v.copy(P.pos).sub(this.pos);
    const dist = toP.length();
    let target = _w;
    const engaged = P.alive && dist < this.aggro;
    if (!engaged) {
      if (this.patrol) { const a = this.t * 0.15; target.set(this.patrol.x + Math.cos(a) * 250, 0, this.patrol.z + Math.sin(a) * 250); }
      else target.copy(this.pos);
    } else if (dist > 380) target.copy(P.pos);
    else {
      // circle-strafe around player
      const a = Math.atan2(this.pos.z - P.pos.z, this.pos.x - P.pos.x) + this.strafeDir * 0.6;
      target.set(P.pos.x + Math.cos(a) * 280, 0, P.pos.z + Math.sin(a) * 280);
      if (Math.random() < dt * 0.1) this.strafeDir *= -1;
    }
    const minAlt = w.groundAt(this.pos.x, this.pos.z) + 35;
    const ahead = w.groundAt(this.pos.x + this.vel.x * 3, this.pos.z + this.vel.z * 3) + 35;
    target.y = Math.max(minAlt, ahead, engaged ? P.pos.y + 15 : minAlt + 40);
    const desired = target.sub(this.pos);
    const dl = desired.length();
    desired.multiplyScalar(Math.min(42, dl * 0.4) / Math.max(dl, 1));
    const acc = desired.sub(this.vel).clampLength(0, 14);
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    // face player when engaged, otherwise face velocity
    const faceTo = engaged && dist < 650 ? toP : this.vel;
    const want = Math.atan2(-faceTo.x, -faceTo.z);
    this.heading += clamp(angleDiff(this.heading, want), -dt * 1.4, dt * 1.4);
    const fwdx = -Math.sin(this.heading), fwdz = -Math.cos(this.heading);
    const af = acc.x * fwdx + acc.z * fwdz, as = acc.x * -fwdz + acc.z * fwdx;
    this.pitch += (clamp(af / 14, -1, 1) * 0.35 - this.pitch) * dt * 3;
    this.roll += (clamp(as / 14, -1, 1) * 0.4 - this.roll) * dt * 3;
    this.group.position.copy(this.pos);
    this.group.rotation.set(-this.pitch, this.heading, -this.roll, 'YXZ');
    // shooting
    if (engaged && dist < 700) {
      const facing = Math.abs(angleDiff(this.heading, Math.atan2(-toP.x, -toP.z)));
      if (facing < 0.2 && this.cd <= 0 && this.canSee(700)) {
        if (this.burst <= 0) this.burst = 10;
        this.burst--; this.cd = this.burst > 0 ? 0.08 : 2 + Math.random() * 1.5;
        const muzzle = this.pos.clone().add(new THREE.Vector3(fwdx * 3.5, -1, fwdz * 3.5));
        const aim = this.lead(500, 10);
        const dir = aim.sub(muzzle).normalize();
        this.game.weapons.fireBullet('enemy', muzzle, dir, 500, 2, this.vel, true);
        this.game.effects.muzzle(muzzle, dir);
        this.game.audio.burst('enemyMg', this.game.volumeAt(this.pos) * 0.8);
      }
    }
  }
}
