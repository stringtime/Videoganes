import * as THREE from 'three';
import { LOC } from './world.js';
import { makePerson, makeHeliModel } from './models.js';
import { AAGun, Truck, Tank, SAMSite, Structure, EnemyHeli } from './enemies.js';

// ---------------------------------------------------------------- rescue site
export class RescueSite {
  constructor(game, x, z, count, o = {}) {
    this.game = game;
    this.pos = new THREE.Vector3(x, game.world.groundAt(x, z), z);
    this.people = [];
    this.smokeColor = o.smoke || [0.35, 0.95, 0.45];
    this.label = o.label || 'BERGUNG';
    for (let i = 0; i < count; i++) {
      const p = makePerson(o.vest || 0xff6a10);
      const a = (i / count) * Math.PI * 2, r = 3 + Math.random() * 3;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      p.group.position.set(px, game.world.groundAt(px, pz), pz);
      p.group.rotation.y = Math.random() * 6;
      p.phase = Math.random() * 6;
      game.scene.add(p.group); game.missionObjects.push(p.group);
      this.people.push(p);
    }
    this.total = count; this.picked = 0; this.progress = 0; this.smokeAcc = 0;
    this.active = o.active ?? true;
  }
  get done() { return this.picked >= this.total; }
  update(dt) {
    const g = this.game, P = g.player;
    // waving
    const t = g.time;
    for (const p of this.people) {
      const d = P.pos.distanceTo(p.group.position);
      p.group.rotation.y = Math.atan2(P.pos.x - p.group.position.x, P.pos.z - p.group.position.z);
      const wave = d < 600 ? Math.sin(t * 8 + p.phase) * 0.6 : 0;
      p.arm.rotation.z = Math.PI - 0.4 + wave; p.arm2.rotation.z = -Math.PI + 0.4 - wave * 0.6;
    }
    if (this.done) return;
    this.smokeAcc += dt;
    while (this.smokeAcc > 0.09) { this.smokeAcc -= 0.09; g.effects.signalSmoke(this.pos, this.smokeColor); }
    if (!this.active || !P.alive) return;
    const hd = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    const speed = Math.hypot(P.vel.x, P.vel.z);
    const ok = hd < 26 && P.agl < 22 && speed < 8 && P.passengers < 8;
    if (ok) {
      P.hoist = true;
      this.progress += dt / (P.landed ? 1.0 : 2.2);
      if (this.progress >= 1) {
        this.progress = 0; this.picked++; P.passengers++;
        const p = this.people.pop(); g.scene.remove(p.group);
        g.audio.beep(1200, 0.1, 0.12); g.audio.beep(1600, 0.1, 0.1);
        g.hud.message(`PERSON AN BORD (${this.picked}/${this.total})`, 1.5);
      }
      g.hud.hoist = this.progress;
    } else if (hd < 120 && !this.warned) {
      g.hud.message(P.passengers >= 8 ? 'KABINE VOLL – ZUR BASIS' : 'TIEF SCHWEBEN & LANGSAM: WINDE', 2.5);
      this.warned = true;
    }
    if (hd > 200) this.warned = false;
  }
}

// ---------------------------------------------------------------- helpers
const loc = (k) => LOC[k];
function ring(game, Cls, center, n, r, o = {}, off = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; out.push(new Cls(game, center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, o)); }
  return out;
}
const alive = (list) => list.filter((e) => e.alive).length;
const killed = (list) => list.filter((e) => !e.alive).length;

function returnStep(m, g) {
  // unload at base
  const P = g.player;
  if (P.onPad && P.passengers > 0) {
    m.unloadAcc = (m.unloadAcc || 0) + g.dt;
    if (m.unloadAcc > 0.5) { m.unloadAcc = 0; P.passengers--; g.stats.rescued++; g.audio.beep(900, 0.08, 0.1); }
  }
}

// ---------------------------------------------------------------- missions
export const MISSIONS = [
  {
    id: 1, title: 'BERGUNG AM SEE', subtitle: 'Rettung',
    brief: [
      'Ein Fischerboot ist im Bergsee gekentert.',
      'Vier Überlebende haben sich auf die kleine Insel gerettet.',
      'Folge dem grünen Rauch, schwebe tief und langsam über',
      'den Personen und hole sie mit der Winde an Bord.',
      'Bring alle sicher zur Basis zurück und lande auf dem H.',
    ],
    setup(g) {
      this.site = new RescueSite(g, loc('island').x, loc('island').z, 4);
    },
    objectives(g) {
      return [
        { text: `Überlebende bergen (${this.site.picked}/4)`, done: this.site.done },
        { text: `Zur Basis bringen (${g.stats.rescued}/4)`, done: g.stats.rescued >= 4 },
      ];
    },
    markers(g) {
      const m = [];
      if (!this.site.done) m.push({ pos: this.site.pos, label: 'INSEL', type: 'rescue' });
      if (g.player.passengers > 0 || this.site.done) m.push({ pos: g.world.basePad, label: 'BASIS', type: 'base' });
      return m;
    },
    update(dt, g) {
      this.site.update(dt);
      returnStep(this, g);
      if (g.stats.rescued >= 4) return 'success';
    },
  },
  {
    id: 2, title: 'KONVOI STOPPEN', subtitle: 'Angriff',
    brief: [
      'Ein feindlicher Nachschubkonvoi verlässt das Depot im Osten.',
      'Vier LKW mit Munition, begleitet von einem Panzer.',
      'Das Depot wird von Flak-Stellungen geschützt.',
      'Zerstöre alle LKW, bevor sie den Gebirgspass erreichen.',
      'Tipp: Raketen (Rechtsklick / LT) gegen Fahrzeuge.',
    ],
    setup(g) {
      const D = loc('depot');
      const path = [
        new THREE.Vector3(D.x, 0, D.z), new THREE.Vector3(D.x - 250, 0, D.z + 180), new THREE.Vector3(500, 0, 560),
        new THREE.Vector3(150, 0, 600), new THREE.Vector3(-300, 0, 520), new THREE.Vector3(-700, 0, 300), new THREE.Vector3(loc('pass').x, 0, loc('pass').z),
      ];
      this.trucks = [];
      for (let i = 0; i < 4; i++) {
        const t = new Truck(g, D.x + 12 + i * 14, D.z - 10 - i * 10, { tag: 'target' });
        t.setPath([new THREE.Vector3(t.pos.x, 0, t.pos.z), ...path.slice(1)], 7.5);
        t.startDelay = 6 + i * 3.5;
        this.trucks.push(t);
      }
      const tank = new Tank(g, D.x - 10, D.z + 10);
      tank.setPath([new THREE.Vector3(tank.pos.x, 0, tank.pos.z), ...path.slice(1)], 6.5);
      tank.startDelay = 4;
      this.movers = [...this.trucks, tank];
      ring(g, AAGun, D, 2, 60, {}, 0.5);
      new Structure(g, D.x + 30, D.z + 40, 'fuel'); new Structure(g, D.x + 40, D.z + 30, 'fuel');
      new Structure(g, D.x - 30, D.z - 40, 'tent'); new Structure(g, D.x - 45, D.z - 25, 'tent');
      this.escaped = 0;
    },
    objectives() {
      return [
        { text: `LKW zerstören (${killed(this.trucks)}/4)`, done: killed(this.trucks) === 4 },
        { text: `Entkommen: ${this.escaped} (max. 1)`, done: false, warn: this.escaped > 0 },
      ];
    },
    markers(g) {
      return this.trucks.filter((t) => t.alive).map((t) => ({ pos: t.pos, label: 'LKW', type: 'target' }));
    },
    update(dt, g) {
      for (const m of this.movers) {
        if (m.startDelay > 0) { m.startDelay -= dt; m.vel.set(0, 0, 0); m._path = m._path || m.path; m.path = null; if (m.startDelay <= 0) m.path = m._path; }
      }
      for (const t of this.trucks) if (t.alive && t.arrived && !t.counted) { t.counted = true; t.alive = false; t.group.visible = false; this.escaped++; g.hud.message('EIN LKW IST ENTKOMMEN!', 2.5); }
      if (this.escaped > 1) return 'fail';
      if (this.trucks.every((t) => !t.alive)) return 'success';
    },
  },
  {
    id: 3, title: 'ABGESCHOSSEN', subtitle: 'Rettung unter Feuer',
    brief: [
      'Ein Transporthubschrauber wurde im Südtal abgeschossen.',
      'Zwei Besatzungsmitglieder haben überlebt und warten mit',
      'rotem Rauch an der Absturzstelle.',
      'Feindliche Flak und Panzer rücken auf die Stelle vor.',
      'Hol die Crew raus. Rechne mit feindlicher Luftunterstützung.',
    ],
    setup(g) {
      const C = loc('crash');
      this.site = new RescueSite(g, C.x, C.z, 2, { smoke: [1.0, 0.25, 0.2], vest: 0x445533 });
      const wreck = makeHeliModel('medevac');
      const wy = g.world.groundAt(C.x + 22, C.z + 10);
      wreck.group.position.set(C.x + 22, wy + 0.8, C.z + 10); wreck.group.rotation.set(0.15, 2.2, 1.2);
      wreck.rotor.rotation.z = 0.5; wreck.disc.visible = false;
      g.scene.add(wreck.group); g.missionObjects.push(wreck.group);
      g.effects.addBurning(new THREE.Vector3(C.x + 22, wy + 1, C.z + 10), 9999);
      this.defenders = [
        new AAGun(g, C.x + 260, C.z - 120), new AAGun(g, C.x - 240, C.z + 160),
      ];
      const t1 = new Tank(g, C.x + 400, C.z + 200); t1.setPath([new THREE.Vector3(t1.pos.x, 0, t1.pos.z), new THREE.Vector3(C.x + 70, 0, C.z + 50)], 4);
      const t2 = new Tank(g, C.x - 350, C.z - 250); t2.setPath([new THREE.Vector3(t2.pos.x, 0, t2.pos.z), new THREE.Vector3(C.x - 60, 0, C.z - 40)], 4);
      this.defenders.push(t1, t2);
      this.heliSpawned = false;
    },
    objectives(g) {
      return [
        { text: `Crew bergen (${this.site.picked}/2)`, done: this.site.done },
        { text: `Zur Basis bringen (${g.stats.rescued}/2)`, done: g.stats.rescued >= 2 },
        { text: `Optional: Feinde (${killed(this.defenders)}/${this.defenders.length})`, done: alive(this.defenders) === 0, optional: true },
      ];
    },
    markers(g) {
      const m = [];
      if (!this.site.done) m.push({ pos: this.site.pos, label: 'CREW', type: 'rescue' });
      if (g.player.passengers > 0 || this.site.done) m.push({ pos: g.world.basePad, label: 'BASIS', type: 'base' });
      return m;
    },
    update(dt, g) {
      this.site.update(dt);
      returnStep(this, g);
      if (this.site.picked > 0 && !this.heliSpawned) {
        this.heliSpawned = true;
        const P = g.player.pos;
        this.defenders.push(new EnemyHeli(g, P.x + 900, P.z - 600, { alt: 120 }));
        g.hud.message('FEINDLICHER HUBSCHRAUBER IM ANFLUG!', 3);
      }
      if (g.stats.rescued >= 2) return 'success';
    },
  },
  {
    id: 4, title: 'FLAK-GÜRTEL', subtitle: 'Angriff',
    brief: [
      'Die Radarstation auf dem Nordwest-Plateau koordiniert',
      'die feindliche Luftabwehr. Sie wird von SAM-Stellungen',
      'und Flak geschützt, Kampfhubschrauber patrouillieren.',
      'Zerstöre die Radarstation und beide SAM-Stellungen.',
      'Bei Raketenwarnung: FLARES (G / LB) und Deckung im Gelände!',
    ],
    setup(g) {
      const R = loc('radar');
      this.radar = new Structure(g, R.x, R.z, 'radar', { tag: 'target' });
      this.sams = [new SAMSite(g, R.x + 45, R.z - 35, { tag: 'target' }), new SAMSite(g, R.x - 50, R.z + 30, { tag: 'target' })];
      ring(g, AAGun, R, 3, 75, {}, 0.3);
      new Structure(g, R.x + 20, R.z + 35, 'bunker');
      this.helis = [new EnemyHeli(g, R.x + 300, R.z - 300, { patrol: R, alt: 100, aggro: 900 }), new EnemyHeli(g, R.x - 200, R.z - 400, { patrol: new THREE.Vector3(-400, 0, 300), alt: 90, aggro: 900 })];
    },
    objectives() {
      return [
        { text: 'Radarstation zerstören', done: !this.radar.alive },
        { text: `SAM-Stellungen (${killed(this.sams)}/2)`, done: alive(this.sams) === 0 },
        { text: `Optional: Hubschrauber (${killed(this.helis)}/2)`, done: alive(this.helis) === 0, optional: true },
      ];
    },
    markers() {
      const m = [];
      if (this.radar.alive) m.push({ pos: this.radar.pos, label: 'RADAR', type: 'target' });
      for (const s of this.sams) if (s.alive) m.push({ pos: s.pos, label: 'SAM', type: 'target' });
      return m;
    },
    update() {
      if (!this.radar.alive && alive(this.sams) === 0) return 'success';
    },
  },
  {
    id: 5, title: 'OPERATION STURMVOGEL', subtitle: 'Finale',
    brief: [
      'Der Feind hält sechs Geiseln in seiner Festung im Norden.',
      'Schalte die Bunker und die Luftabwehr der Festung aus,',
      'dann lande im Hof und befreie die Gefangenen.',
      'Rechne mit mehreren Wellen feindlicher Hubschrauber.',
      'Das ist es, Pilot. Viel Glück – Stahlfalke, Ende.',
    ],
    setup(g) {
      const F = loc('fortress');
      this.bunkers = [0, 1, 2].map((i) => { const a = 0.4 + (i / 3) * Math.PI * 2; return new Structure(g, F.x + Math.cos(a) * 70, F.z + Math.sin(a) * 70, 'bunker', { tag: 'target' }); });
      this.sams = [new SAMSite(g, F.x + 110, F.z + 20), new SAMSite(g, F.x - 100, F.z - 50)];
      this.aa = ring(g, AAGun, F, 4, 105, {}, 1.0);
      new Tank(g, F.x + 40, F.z - 80).setPath(null, 0);
      for (let i = 0; i < 4; i++) new Structure(g, F.x - 30 + i * 15, F.z + 45, 'tent');
      this.site = new RescueSite(g, F.x, F.z, 6, { smoke: [1, 0.85, 0.2], vest: 0xd8d0c0, active: false });
      this.wave = 0; this.waveT = 30; this.helis = [];
    },
    objectives(g) {
      return [
        { text: `Bunker zerstören (${killed(this.bunkers)}/3)`, done: alive(this.bunkers) === 0 },
        { text: `Geiseln befreien (${this.site.picked}/6)`, done: this.site.done },
        { text: `Zur Basis bringen (${g.stats.rescued}/6)`, done: g.stats.rescued >= 6 },
      ];
    },
    markers(g) {
      const m = [];
      if (alive(this.bunkers) > 0) for (const b of this.bunkers) { if (b.alive) m.push({ pos: b.pos, label: 'BUNKER', type: 'target' }); }
      else if (!this.site.done) m.push({ pos: this.site.pos, label: 'GEISELN', type: 'rescue' });
      if (g.player.passengers > 0 || this.site.done) m.push({ pos: g.world.basePad, label: 'BASIS', type: 'base' });
      return m;
    },
    update(dt, g) {
      if (!this.site.active && alive(this.bunkers) === 0) { this.site.active = true; g.hud.message('BUNKER AUSGESCHALTET – GEISELN BERGEN!', 3); }
      this.site.update(dt);
      returnStep(this, g);
      this.waveT -= dt;
      if (this.waveT <= 0 && this.wave < 3) {
        this.wave++; this.waveT = 70;
        const P = g.player.pos;
        for (let i = 0; i < Math.min(this.wave, 2); i++) {
          const a = Math.random() * Math.PI * 2;
          this.helis.push(new EnemyHeli(g, P.x + Math.cos(a) * 1000, P.z + Math.sin(a) * 1000, { alt: 120 }));
        }
        g.hud.message(`WELLE ${this.wave}: FEINDLICHE HUBSCHRAUBER!`, 3);
      }
      if (g.stats.rescued >= 6) return 'success';
    },
  },
];
