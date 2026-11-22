import * as THREE from 'three';
import { makeHeliModel } from './models.js';
import { Cockpit } from './cockpit.js';
import { clamp, damp } from './noise.js';

const G = 9.81;
const EYE = new THREE.Vector3(0, 0.45, -1.7);
const GUN = new THREE.Vector3(0, -1.15, -3.4);
const PODS = [new THREE.Vector3(-2.1, -0.55, -1.3), new THREE.Vector3(2.1, -0.55, -1.3)];
const SKID = 2.0;

export const MAX = { hp: 100, mg: 900, rockets: 16, flares: 16, seats: 8 };

export class Player {
  constructor(game) {
    this.game = game;
    this.model = makeHeliModel('player');
    game.scene.add(this.model.group);
    this.cockpit = new Cockpit();
    game.scene.add(this.cockpit.group);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion(); this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3();
    this.view = 'cockpit';
    this.chasePos = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.radius = 4;
  }

  reset(pos, yaw) {
    this.pos.copy(pos); this.pos.y = this.game.world.groundAt(pos.x, pos.z) + SKID + 0.4;
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0; this.roll = 0; this.yawRate = 0;
    this.rpm = 0.0; this.hp = MAX.hp; this.mg = MAX.mg; this.rockets = MAX.rockets; this.flares = MAX.flares;
    this.passengers = 0; this.landed = true; this.dead = false; this.deathTimer = 0;
    this.mgCd = 0; this.rocketCd = 0; this.flareCd = 0; this.pod = 0; this.hoist = false; this.hoistProgress = 0;
    this.rearmAcc = 0; this.onPad = false; this.agl = 0; this.damageTaken = 0; this.hitFlash = 0;
    this.chasePos.copy(this.pos);
    this.spin = 0;
    this.updateTransform();
  }

  get alive() { return !this.dead; }

  updateTransform() {
    this.euler.set(-this.pitch, this.yaw, -this.roll, 'YXZ');
    this.quat.setFromEuler(this.euler);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.model.group.position.copy(this.pos);
    this.model.group.quaternion.copy(this.quat);
  }

  worldPoint(local, out) { return out.copy(local).applyQuaternion(this.quat).add(this.pos); }

  damage(n) {
    if (this.dead || this.game.godMode) return;
    this.hp -= n; this.damageTaken += n; this.hitFlash = 0.25;
    this.game.effects.shake = Math.max(this.game.effects.shake, Math.min(0.6, n / 25));
    this.game.audio.burst('impact', 0.6);
    if (this.hp <= 0) this.kill();
  }

  kill() {
    if (this.dead) return;
    this.hp = 0; this.dead = true; this.deathTimer = 0;
    this.game.effects.explosion(this.pos, 1.4, this.pos);
    this.game.audio.burst('explosion', 1);
    this.game.hud.message('HUBSCHRAUBER ZERSTÖRT', 3);
  }

  aimPoint(out) {
    // where the crosshair (camera forward) meets something
    const cam = this.worldPoint(EYE, this._v2);
    let best = null, bestScore = 0.045; // ~2.6 deg aim assist
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const d = this._v.copy(e.pos).sub(cam); const dist = d.length();
      if (dist > 1300 || dist < 5) continue;
      const ang = Math.acos(clamp(d.dot(this.fwd) / dist, -1, 1));
      if (ang < bestScore + e.radius / dist) { best = e; bestScore = ang - e.radius / dist; }
    }
    if (best) { this.lockTarget = best; return out.copy(best.pos).addScaledVector(best.vel || this._v.set(0, 0, 0), cam.distanceTo(best.pos) / 700); }
    this.lockTarget = null;
    const w = this.game.world;
    for (let d = 20; d < 1500; d += 15) {
      out.copy(cam).addScaledVector(this.fwd, d);
      if (out.y < w.groundAt(out.x, out.z)) return out;
    }
    return out.copy(cam).addScaledVector(this.fwd, 600);
  }

  update(dt, input, game) {
    const w = game.world;
    if (this.dead) {
      this.deathTimer += dt;
      this.vel.y -= G * dt; this.vel.multiplyScalar(0.99);
      this.pos.addScaledVector(this.vel, dt);
      this.spin += dt * 4; this.yaw += dt * 4; this.roll += dt * 0.6;
      const gh = w.groundAt(this.pos.x, this.pos.z) + 1;
      if (this.pos.y < gh) { this.pos.y = gh; this.vel.set(0, 0, 0); if (!this.crashed) { this.crashed = true; game.effects.explosion(this.pos, 1.6, this.pos); game.effects.addBurning(this.pos, 30); game.audio.burst('explosion', 1); } }
      game.effects.damageSmoke(this.pos, 1);
      this.updateTransform();
      this.updateCamera(dt, game);
      return;
    }

    // engine spool
    this.rpm = Math.min(1, this.rpm + dt * 0.33);
    const power = clamp((this.rpm - 0.55) / 0.45, 0, 1);

    // attitude (self-levelling arcade model)
    const maxP = 0.52, maxR = 0.62;
    let tp = input.pitch * maxP, tr = input.roll * maxR;
    if (this.landed && input.collective <= 0.05) { tp = 0; tr = 0; }
    this.pitch = damp(this.pitch, tp, 2.6, dt);
    this.roll = damp(this.roll, tr, 3.2, dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const targetYawRate = -input.yaw * 1.5 - this.roll * clamp(hs / 25, 0, 1) * 1.1;
    this.yawRate = damp(this.yawRate, this.landed ? 0 : targetYawRate, 4, dt);
    this.yaw += this.yawRate * dt;
    this.updateTransform();

    // thrust along rotor axis to track commanded climb rate
    const desiredVy = input.collective > 0 ? input.collective * 15 : input.collective * 13;
    const needAy = G + (desiredVy - this.vel.y) * 2.2;
    const T = clamp(needAy / Math.max(this.up.y, 0.35), 0, 24) * power;
    const acc = this._v.copy(this.up).multiplyScalar(T);
    acc.y -= G;
    // drag (linear + quadratic) + hover assist
    const sp = this.vel.length();
    const assist = 1 - Math.min(1, (Math.abs(input.pitch) + Math.abs(input.roll)) * 3);
    acc.x -= this.vel.x * (0.045 + sp * 0.0008 + assist * 0.35);
    acc.z -= this.vel.z * (0.045 + sp * 0.0008 + assist * 0.35);
    acc.y -= this.vel.y * 0.05;
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.torque = T / 24;

    // ceiling & bounds
    if (this.pos.y > 700) this.vel.y = Math.min(this.vel.y, (700 - this.pos.y));
    const r = Math.hypot(this.pos.x, this.pos.z);
    this.outOfBounds = r > 1550;
    if (r > 1750) { this.pos.x *= 1750 / r; this.pos.z *= 1750 / r; }

    // ground contact
    const gh = w.groundAt(this.pos.x, this.pos.z);
    this.agl = this.pos.y - SKID - gh;
    this.landed = false;
    if (this.agl <= 0) {
      const impact = -this.vel.y;
      if (impact > 7.5) this.damage((impact - 7.5) * 9);
      if (hs > 18) this.damage(hs * 0.6);
      this.pos.y = gh + SKID;
      if (this.vel.y < 0) this.vel.y = 0;
      const fr = Math.exp(-6 * dt);
      this.vel.x *= fr; this.vel.z *= fr;
      this.landed = desiredVy <= 1 || this.rpm < 0.9;
      this.agl = 0;
      if (gh <= 0.01 && this.hp > 0 && this.vel.length() < 1) this.inWater = true;
    } else this.inWater = false;
    // static obstacles
    for (const c of w.colliders) {
      const p = this.pos;
      if (p.x > c.min.x - 2 && p.x < c.max.x + 2 && p.z > c.min.z - 2 && p.z < c.max.z + 2 && p.y - SKID < c.max.y && p.y + 1 > c.min.y) {
        const top = c.max.y + SKID;
        if (p.y - SKID > c.max.y - 1.5 && this.vel.y <= 0.5) { p.y = top; this.vel.y = Math.max(0, this.vel.y); this.landed = desiredVy <= 1; this.vel.x *= 0.9; this.vel.z *= 0.9; }
        else {
          const spd = this.vel.length();
          if (spd > 6) this.damage(spd * 1.2);
          const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
          const dx = p.x - cx, dz = p.z - cz;
          if (Math.abs(dx) / (c.max.x - c.min.x) > Math.abs(dz) / (c.max.z - c.min.z)) { p.x = dx > 0 ? c.max.x + 2 : c.min.x - 2; this.vel.x *= -0.3; }
          else { p.z = dz > 0 ? c.max.z + 2 : c.min.z - 2; this.vel.z *= -0.3; }
        }
      }
    }
    this.updateTransform();

    // pad: repair / rearm
    const pad = w.basePad;
    this.onPad = this.landed && Math.hypot(this.pos.x - pad.x, this.pos.z - pad.z) < 20;
    if (this.onPad) {
      this.rearmAcc += dt;
      if (this.rearmAcc > 0.15) {
        this.rearmAcc = 0;
        const before = this.hp + this.mg + this.rockets + this.flares;
        this.hp = Math.min(MAX.hp, this.hp + 2.5);
        this.mg = Math.min(MAX.mg, this.mg + 30);
        if (Math.random() < 0.4) this.rockets = Math.min(MAX.rockets, this.rockets + 1);
        if (Math.random() < 0.4) this.flares = Math.min(MAX.flares, this.flares + 1);
        if (this.hp + this.mg + this.rockets + this.flares > before && Math.random() < 0.2) game.audio.beep(1300, 0.04, 0.05);
      }
    }

    // weapons
    this.mgCd -= dt; this.rocketCd -= dt; this.flareCd -= dt;
    const canFire = this.rpm > 0.6;
    if (canFire && input.mg && this.mgCd <= 0 && this.mg > 0) {
      this.mgCd = 1 / 14; this.mg--;
      const aim = this.aimPoint(this._v2.clone());
      const muzzle = this.worldPoint(GUN, new THREE.Vector3());
      const dir = aim.sub(muzzle).normalize();
      dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.z += (Math.random() - 0.5) * 0.012;
      dir.normalize();
      game.weapons.fireBullet('player', muzzle, dir, 780, 9, this.vel, this.mg % 3 === 0);
      game.effects.muzzle(muzzle.addScaledVector(dir, 1.5), dir);
      game.audio.burst('mg', 0.7);
      game.effects.shake = Math.max(game.effects.shake, 0.06);
      game.stats.shots++;
    }
    if (canFire && input.rocket && this.rocketCd <= 0 && this.rockets > 0) {
      this.rocketCd = 0.28; this.rockets--;
      const aim = this.aimPoint(this._v2.clone());
      const p = this.worldPoint(PODS[this.pod], new THREE.Vector3());
      this.pod ^= 1;
      const dir = aim.sub(p).normalize();
      game.weapons.fireRocket('player', p, dir, this.vel, { speed: 260, dmg: 140, splash: 14 });
      game.audio.burst('rocket', 0.8);
      game.effects.shake = Math.max(game.effects.shake, 0.15);
    }
    if (input.flare && this.flareCd <= 0 && this.flares > 0) {
      this.flareCd = 0.8; this.flares -= 2;
      for (const s of [-1, 1]) {
        const v = this._v.set(s * 14, -4, 6).applyQuaternion(this.quat).add(this.vel);
        game.weapons.dropFlare(this.pos.clone().addScaledVector(this.up, -1), v.clone());
      }
      game.audio.burst('flare', 0.8);
    }

    // damage smoke
    if (this.hp < 50) game.effects.damageSmoke(this.worldPoint(this._v.set(0, 1.5, 1.5), new THREE.Vector3()), (50 - this.hp) / 60);
    // downwash
    if (this.agl < 25 && this.rpm > 0.6) {
      const gp = this._v.set(this.pos.x, w.groundAt(this.pos.x, this.pos.z), this.pos.z);
      game.effects.downwash(gp, (1 - this.agl / 25) * 0.9, w.heightAt(this.pos.x, this.pos.z) < 0);
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.updateCamera(dt, game);
  }

  updateCamera(dt, game) {
    const cam = game.camera;
    const m = this.model;
    // rotor animation
    this.spin += dt * this.rpm * 28;
    m.rotor.rotation.y = this.spin;
    m.tail.rotation.x = this.spin * 2.5;
    const cockpit = this.view === 'cockpit' && !this.dead;
    m.group.traverse((o) => { if (o.isMesh) o.visible = !cockpit; });
    m.disc.visible = true;
    m.disc.material.opacity = cockpit ? 0.1 * this.rpm : 0.12 * this.rpm;
    if (cockpit) for (const b of m.rotor.children) b.visible = this.rpm < 0.75;
    this.cockpit.group.visible = cockpit;

    const shake = game.effects.shake;
    if (cockpit) {
      this.worldPoint(EYE, cam.position);
      cam.quaternion.copy(this.quat);
      // vibration + shake
      const vib = 0.0012 * this.rpm + shake * 0.02;
      cam.position.x += (Math.random() - 0.5) * vib; cam.position.y += (Math.random() - 0.5) * vib;
      cam.rotateX((Math.random() - 0.5) * shake * 0.02);
      cam.rotateY((Math.random() - 0.5) * shake * 0.02);
      this.cockpit.group.position.copy(cam.position);
      this.cockpit.group.quaternion.copy(cam.quaternion);
      this.cockpit.update({
        speed: Math.hypot(this.vel.x, this.vel.z), alt: Math.max(0, this.pos.y - SKID), vs: this.vel.y,
        pitch: this.pitch, roll: this.roll, heading: ((-this.yaw * 180) / Math.PI % 360 + 360) % 360,
        torque: this.torque || 0, rpm: this.rpm, hp: this.hp, missile: game.weapons.missileWarning, hoist: this.hoist, landed: this.landed,
      }, game.input.state);
    } else {
      const back = this._v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const target = this._v2.copy(this.pos).addScaledVector(back, 24); target.y += 7;
      const gmin = game.world.groundAt(target.x, target.z) + 2;
      if (target.y < gmin) target.y = gmin;
      this.chasePos.lerp(target, 1 - Math.exp(-dt * 5));
      cam.position.copy(this.chasePos);
      cam.position.x += (Math.random() - 0.5) * shake * 0.4;
      cam.position.y += (Math.random() - 0.5) * shake * 0.4;
      const look = this._v.copy(this.pos).addScaledVector(this.fwd, 12); look.y += 1.5;
      cam.lookAt(look);
    }
  }
}
