import * as THREE from 'three';
import { makeMissile } from './models.js';

const PLAYER_TRACER = new THREE.Color(3.5, 2.6, 1.0);
const PLAYER_BULLET = new THREE.Color(1.6, 1.3, 0.8);
const ENEMY_TRACER = new THREE.Color(4.0, 0.8, 0.4);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// distance from point p to segment ab (squared)
function segDist2(a, b, p) {
  _a.subVectors(b, a); _b.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _b.dot(_a) / Math.max(1e-6, _a.lengthSq())));
  _c.copy(a).addScaledVector(_a, t);
  return _c.distanceToSquared(p);
}

export class Weapons {
  constructor(game) {
    this.game = game;
    this.bullets = []; this.rockets = []; this.flares = [];
    this.missileWarning = false;
    this.prev = new THREE.Vector3();
  }

  clear() {
    for (const r of this.rockets) this.game.scene.remove(r.mesh);
    this.bullets.length = 0; this.rockets.length = 0; this.flares.length = 0;
  }

  fireBullet(owner, pos, dir, speed, dmg, inherit, tracer = true) {
    const vel = dir.clone().multiplyScalar(speed);
    if (inherit) vel.add(inherit);
    this.bullets.push({ owner, pos: pos.clone(), vel, dmg, life: 2.2, tracer });
  }

  fireRocket(owner, pos, dir, inherit, o) {
    const mesh = makeMissile();
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(o.homing ? 40 : 70);
    if (inherit) vel.add(inherit);
    this.rockets.push({ owner, pos: pos.clone(), vel, dir: dir.clone(), speed: vel.length(), maxSpeed: o.speed, dmg: o.dmg, splash: o.splash,
      life: o.life || 7, mesh, homing: o.homing || null, turn: o.turn || 0, armed: 0 });
  }

  dropFlare(pos, vel) { this.flares.push({ pos, vel, life: 4 }); }

  explode(pos, dmg, splash, owner) {
    const g = this.game;
    g.effects.explosion(pos, splash > 10 ? 0.8 : 0.6, g.camera.position);
    g.audio.burst('explosion', g.volumeAt(pos) * 0.8);
    if (owner === 'player') {
      for (const e of g.enemies) {
        if (!e.alive) continue;
        const d = e.pos.distanceTo(pos) - e.radius;
        if (d < splash) e.damage(dmg * Math.max(0.2, 1 - Math.max(0, d) / splash));
      }
    } else {
      const d = g.player.pos.distanceTo(pos) - g.player.radius;
      if (d < splash) g.player.damage(dmg * Math.max(0.2, 1 - Math.max(0, d) / splash));
    }
  }

  update(dt) {
    const g = this.game, w = g.world, P = g.player;
    const fx = g.effects;
    fx.beginTracers();

    // bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      this.prev.copy(b.pos);
      b.vel.y -= 9.81 * dt * 0.5;
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      if (b.owner === 'player') {
        for (const e of g.enemies) {
          if (!e.alive) continue;
          if (segDist2(this.prev, b.pos, e.pos) < e.radius * e.radius) {
            e.damage(b.dmg); fx.impact(b.pos, false); g.audio.burst('hit', g.volumeAt(b.pos) * 0.5); g.stats.hits++;
            hit = true; break;
          }
        }
      } else if (P.alive) {
        if (segDist2(this.prev, b.pos, P.pos) < P.radius * P.radius) {
          P.damage(b.dmg); hit = true;
          fx.impact(b.pos, false);
        }
      }
      if (!hit) {
        const gh = w.heightAt(b.pos.x, b.pos.z);
        if (b.pos.y < Math.max(gh, 0)) {
          if (gh < 0) fx.splash(_a.set(b.pos.x, 0, b.pos.z)); else fx.impact(_a.set(b.pos.x, gh + 0.2, b.pos.z));
          hit = true;
        }
      }
      if (hit || b.life <= 0) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); continue; }
      if (b.tracer) {
        const len = Math.min(14, b.vel.length() * 0.022);
        fx.addTracer(b.pos, b.vel, len, b.owner === 'player' ? PLAYER_TRACER : ENEMY_TRACER);
      } else if (b.owner === 'player') fx.addTracer(b.pos, b.vel, 3, PLAYER_BULLET);
    }
    fx.endTracers();

    // flares
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.vel.y -= 9.81 * dt * 0.6; f.vel.multiplyScalar(Math.exp(-1.2 * dt));
      f.pos.addScaledVector(f.vel, dt); f.life -= dt;
      fx.flare(f.pos);
      if (f.life <= 0) this.flares.splice(i, 1);
    }

    // rockets & missiles
    this.missileWarning = false;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      this.prev.copy(r.pos);
      r.life -= dt; r.armed += dt;
      if (r.homing) {
        // decoy check
        if (r.homing === P) {
          for (const f of this.flares) {
            if (f.pos.distanceTo(r.pos) < 450 && Math.random() < dt * 2.2) { r.homing = f; break; }
          }
        }
        const tgt = r.homing;
        if (tgt === P && !P.alive) r.homing = null;
        else {
          const tp = _a.copy(tgt.pos);
          if (tgt.vel) tp.addScaledVector(tgt.vel, Math.min(2, r.pos.distanceTo(tp) / Math.max(50, r.speed)));
          const want = tp.sub(r.pos).normalize();
          const ang = r.dir.angleTo(want);
          const maxA = r.turn * dt;
          if (ang > 1e-4) r.dir.lerp(want, Math.min(1, maxA / ang)).normalize();
          if (tgt === P) this.missileWarning = true;
          if (tgt.life !== undefined && tgt.life <= 0) r.homing = null;
        }
      }
      r.speed = Math.min(r.maxSpeed, r.speed + dt * (r.homing ? 120 : 600));
      if (r.homing !== undefined) r.vel.copy(r.dir).multiplyScalar(r.speed);
      r.vel.y -= r.homing ? 0 : 9.81 * dt * 0.15;
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      r.mesh.lookAt(_b.copy(r.pos).add(r.vel));
      r.mesh.rotateY(Math.PI);
      fx.rocketTrail(this.prev, r.pos, r.vel);

      let boom = r.life <= 0;
      if (!boom) {
        const gh = w.heightAt(r.pos.x, r.pos.z);
        if (r.pos.y < Math.max(gh, 0) + 0.3) boom = true;
        for (const c of w.colliders) {
          if (r.pos.x > c.min.x && r.pos.x < c.max.x && r.pos.z > c.min.z && r.pos.z < c.max.z && r.pos.y > c.min.y && r.pos.y < c.max.y) { boom = true; break; }
        }
      }
      if (!boom && r.owner === 'player') {
        for (const e of g.enemies) if (e.alive && segDist2(this.prev, r.pos, e.pos) < (e.radius + 1) ** 2) { boom = true; break; }
      } else if (!boom && P.alive && r.armed > 0.4) {
        const prox = r.homing ? 9 : P.radius + 1.5;
        if (segDist2(this.prev, r.pos, P.pos) < prox * prox) boom = true;
      }
      if (!boom && r.homing && r.homing !== P && r.homing.pos && r.pos.distanceTo(r.homing.pos) < 4) boom = true;
      if (boom) {
        this.explode(r.pos, r.dmg, r.splash, r.owner);
        g.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
  }
}
