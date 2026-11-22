import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, LOC } from './world.js';
import { Effects } from './effects.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { HUD } from './hud.js';
import { MISSIONS } from './missions.js';
import { makeHeliModel } from './models.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('stahlfalke.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('stahlfalke.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const params = new URLSearchParams(location.search);
const qualityName = params.get('q') || store.get('quality', isTouch ? 'low' : 'high');
const QUALITY = {
  high: { pixelRatio: Math.min(devicePixelRatio, 2), shadows: true, shadowSize: 2048, trees: 5000, clouds: 40, particles: 5000, bloom: true, aa: true },
  medium: { pixelRatio: Math.min(devicePixelRatio, 1.25), shadows: true, shadowSize: 1024, trees: 3000, clouds: 25, particles: 3000, bloom: true, aa: true },
  low: { pixelRatio: Math.min(devicePixelRatio, 1), shadows: false, shadowSize: 512, trees: 1600, clouds: 12, particles: 1800, bloom: false, aa: true },
}[qualityName] || {};
const settings = {
  tilt: store.get('tilt', true), invert: store.get('invert', false), sens: store.get('sens', 1), sound: store.get('sound', true),
};
if (isTouch) document.body.classList.add('touch');

// ------------------------------------------------------------ renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(QUALITY.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = QUALITY.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 30000);
scene.add(camera);

let composer = null;
if (QUALITY.bloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.5, 0.92));
  composer.addPass(new OutputPass());
}

// ------------------------------------------------------------ game object
const game = {
  scene, camera, renderer, time: 0, dt: 0, enemies: [], missionObjects: [], mission: null, missionIndex: 0,
  state: 'menu', paused: false, lockWarn: false, stats: null, godMode: params.has('god'),
  volumeAt(p) { return 1 / (1 + camera.position.distanceTo(p) / 140); },
  onEnemyDestroyed(e) {
    this.stats.kills++; this.stats.score += e.score;
    this.hud.message(`${e.name} ZERSTÖRT  +${e.score}`, 1.6);
  },
};

window.game = game;

function setLoad(t) { $('loadText').textContent = t; }

async function boot() {
  setLoad('Gelände wird erzeugt …');
  await new Promise((r) => setTimeout(r, 30));
  game.world = new World(scene, renderer, QUALITY);
  game.effects = new Effects(scene, scene.fog, QUALITY);
  game.input = new Input(canvas);
  game.input.tilt.invert = settings.invert; game.input.tilt.sens = settings.sens;
  game.audio = new Audio();
  game.hud = new HUD();
  game.weapons = new Weapons(game);
  game.player = new Player(game);
  // decoration: parked medevac helicopter at base
  const park = makeHeliModel('medevac');
  park.group.position.set(LOC.base.x - 30, LOC.base.h + 2.0, LOC.base.z - 8); park.group.rotation.y = 0.6;
  scene.add(park.group);
  game.player.reset(game.world.basePad, 0);
  onResize();
  // compile shaders up front for smoother start
  renderer.compile(scene, camera);
  $('loading').classList.add('hidden');
  buildMenu();
  showScreen('menu');
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------ UI
const screens = ['menu', 'briefing', 'pause', 'debrief', 'settings', 'controls'];
let focusIdx = 0, returnScreen = 'menu';
function showScreen(name) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== name);
  game.ui = name;
  focusIdx = 0; updateFocus();
}
function focusables() {
  if (!game.ui) return [];
  return [...$(game.ui).querySelectorAll('button:not(:disabled), select, input')];
}
function updateFocus() {
  const f = focusables();
  f.forEach((b, i) => b.classList.toggle('focus', i === focusIdx && game.input && game.input.lastDevice === 'gamepad'));
}

function buildMenu() {
  const unlocked = store.get('unlocked', 1);
  const stars = store.get('stars', {});
  const list = $('missionList');
  list.innerHTML = '';
  MISSIONS.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'mission';
    b.disabled = i + 1 > unlocked && !params.has('all');
    b.innerHTML = `<div class="n">EINSATZ ${m.id}</div><div class="t">${m.title}</div><div class="s">${m.subtitle}</div><div class="st">${'★'.repeat(stars[m.id] || 0)}</div>`;
    b.onclick = () => openBriefing(i);
    list.appendChild(b);
  });
  const dev = isTouch ? 'Touch-Gerät erkannt – Querformat & Neigungssteuerung empfohlen.' : 'Tastatur/Maus oder Controller (einfach anschließen und eine Taste drücken).';
  $('deviceInfo').textContent = `Grafik: ${qualityName.toUpperCase()} · ${dev}`;
}

function openBriefing(i) {
  game.missionIndex = i;
  const m = MISSIONS[i];
  $('brTitle').textContent = `EINSATZ ${m.id}: ${m.title}`;
  $('brText').textContent = m.brief.join('\n');
  showScreen('briefing');
}

async function launch() {
  game.audio.init();
  game.audio.setMuted(!settings.sound);
  if (isTouch) {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch { /* ignore */ }
    try { await screen.orientation.lock('landscape'); } catch { /* ignore */ }
    if (settings.tilt) { const ok = await game.input.requestTilt(); if (!ok) game.hud.message('NEIGUNG NICHT VERFÜGBAR – TOUCH-STICK', 3); }
  }
  startMission(game.missionIndex);
}

function clearMission() {
  for (const e of game.enemies) scene.remove(e.group);
  game.enemies.length = 0;
  for (const o of game.missionObjects) scene.remove(o);
  game.missionObjects.length = 0;
  game.weapons.clear();
  game.effects.burning.length = 0;
}

function startMission(i) {
  clearMission();
  game.missionIndex = i;
  const m = (game.mission = Object.assign(Object.create(null), MISSIONS[i]));
  game.stats = { kills: 0, score: 0, rescued: 0, shots: 0, hits: 0, time: 0 };
  game.player.reset(game.world.basePad, 0);
  game.player.view = 'cockpit';
  m.setup(game);
  game.state = 'playing'; game.paused = false; game.resultT = 0; game.result = null;
  for (const s of screens) $(s).classList.add('hidden');
  game.ui = null;
  game.hud.show(true);
  game.hud.message(m.title, 3);
  $('touch').classList.toggle('hidden', !isTouch);
  game.input.clearEdges();
}

function endMission(result) {
  game.state = 'debrief';
  game.hud.show(false);
  $('touch').classList.add('hidden');
  const m = game.mission, s = game.stats, P = game.player;
  const ok = result === 'success';
  game.audio.jingle(ok);
  let stars = 0;
  if (ok) {
    stars = 1;
    if (P.damageTaken < 40) stars++;
    if (s.time < 300 + m.id * 60) stars++;
    const st = store.get('stars', {}); st[m.id] = Math.max(st[m.id] || 0, stars); store.set('stars', st);
    store.set('unlocked', Math.max(store.get('unlocked', 1), Math.min(MISSIONS.length, m.id + 1)));
  }
  $('dbKicker').textContent = ok ? 'EINSATZ ERFOLGREICH' : 'EINSATZ GESCHEITERT';
  $('dbKicker').style.color = ok ? '' : 'var(--warn)';
  $('dbTitle').textContent = m.title;
  $('dbStars').textContent = ok ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
  const mm = Math.floor(s.time / 60), ss = String(Math.floor(s.time % 60)).padStart(2, '0');
  $('dbText').textContent = [
    `Einsatzzeit ....... ${mm}:${ss}`,
    `Gerettet .......... ${s.rescued}`,
    `Abschüsse ......... ${s.kills}`,
    `MG-Trefferquote ... ${acc}%`,
    `Schaden erlitten .. ${Math.round(P.damageTaken)}`,
    `Punkte ............ ${s.score + s.rescued * 250 + (ok ? 1000 : 0)}`,
    '',
    ok ? '★ Erfolg  ★ Wenig Schaden  ★ Schnell' : (P.dead ? 'Der Hubschrauber wurde zerstört.' : 'Das Einsatzziel wurde verfehlt.'),
  ].join('\n');
  $('btnDbNext').classList.toggle('hidden', !ok || m.id >= MISSIONS.length);
  buildMenu();
  showScreen('debrief');
}

function setPaused(p) {
  if (game.state !== 'playing') return;
  game.paused = p;
  if (p) showScreen('pause'); else { for (const s of screens) $(s).classList.add('hidden'); game.ui = null; }
  if (game.audio.ctx) p ? game.audio.ctx.suspend() : game.audio.ctx.resume();
}

function openSettings(from) {
  returnScreen = from;
  $('setQuality').value = qualityName;
  $('setTilt').checked = settings.tilt; $('setInvert').checked = settings.invert;
  $('setSens').value = settings.sens; $('setSound').checked = settings.sound;
  showScreen('settings');
}

$('btnSettings').onclick = () => openSettings('menu');
$('btnPauseSettings').onclick = () => openSettings('pause');
$('btnControls').onclick = () => showScreen('controls');
$('btnCtlClose').onclick = () => showScreen('menu');
$('btnSetClose').onclick = () => {
  const q = $('setQuality').value;
  settings.tilt = $('setTilt').checked; settings.invert = $('setInvert').checked; settings.sens = +$('setSens').value; settings.sound = $('setSound').checked;
  for (const k in settings) store.set(k, settings[k]);
  game.input.tilt.invert = settings.invert; game.input.tilt.sens = settings.sens;
  game.audio.setMuted(!settings.sound);
  if (q !== qualityName) { store.set('quality', q); location.reload(); return; }
  showScreen(returnScreen);
};
$('btnBack').onclick = () => showScreen('menu');
$('btnLaunch').onclick = launch;
$('btnResume').onclick = () => setPaused(false);
$('btnRestart').onclick = () => { game.paused = false; if (game.audio.ctx) game.audio.ctx.resume(); startMission(game.missionIndex); };
$('btnQuit').onclick = () => { game.paused = false; if (game.audio.ctx) game.audio.ctx.resume(); clearMission(); game.state = 'menu'; game.mission = null; game.hud.show(false); $('touch').classList.add('hidden'); showScreen('menu'); };
$('btnDbMenu').onclick = () => { clearMission(); game.state = 'menu'; game.mission = null; showScreen('menu'); };
$('btnDbRetry').onclick = () => startMission(game.missionIndex);
$('btnDbNext').onclick = () => openBriefing(game.missionIndex + 1);

// ------------------------------------------------------------ resize
function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 90 : w / h < 1.5 ? 76 : 70;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  if (game.effects) game.effects.setViewport(h * renderer.getPixelRatio(), camera.fov);
  $('rotate').classList.toggle('hidden', !(isTouch && h > w && game.state === 'playing'));
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 200));
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'playing' && !game.paused) setPaused(true); });

function simulate(dt) {
  const input = game.input;
  game.time += dt; game.stats.time += dt;
  input.state.flare = input.consume('flare');
  if (input.consume('view')) game.player.view = game.player.view === 'cockpit' ? 'chase' : 'cockpit';
  game.lockWarn = false;
  game.player.hoist = false;
  for (const e of game.enemies) e.update(dt);
  const r = game.mission.update(dt, game);
  game.player.update(dt, input.state, game);
  game.weapons.update(dt);
  if (!game.result) {
    if (r) { game.result = r; game.resultT = r === 'success' ? 2.5 : 2; game.hud.message(r === 'success' ? 'EINSATZ ERFOLGREICH!' : 'EINSATZ GESCHEITERT', 3); }
    else if (game.player.dead && game.player.deathTimer > 3.5) { game.result = 'fail'; game.resultT = 0.01; }
  } else if ((game.resultT -= dt) <= 0) endMission(game.result);
  game.hud.update(dt, game);
  if (isTouch) $('touch').classList.toggle('tilt', input.tilt.enabled && input.tilt.available);
  const P = game.player;
  game.audio.engine(P.rpm, P.dead ? 0 : Math.max(0, P.torque || 0), P.vel.length(), game.weapons.missileWarning || (P.hp < 25 && !P.dead), P.view === 'cockpit');
}
game.simulate = simulate;

// ------------------------------------------------------------ loop
let last = performance.now();
const menuCam = { a: 0 };
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.dt = dt;
  const input = game.input;
  input.update(dt);

  // global edges
  if (input.consume('mute')) { settings.sound = !settings.sound; store.set('sound', settings.sound); game.audio.setMuted(!settings.sound); }

  if (game.ui) {
    // gamepad / keyboard menu navigation
    const f = focusables();
    if (input.consume('down')) { focusIdx = (focusIdx + 1) % f.length; updateFocus(); }
    if (input.consume('up')) { focusIdx = (focusIdx - 1 + f.length) % f.length; updateFocus(); }
    if (input.consume('confirm') && input.lastDevice === 'gamepad' && f[focusIdx]) f[focusIdx].click();
    if (input.consume('back') || input.consume('pause')) {
      if (game.ui === 'pause') setPaused(false);
      else if (game.ui !== 'menu' && game.ui !== 'debrief') showScreen(game.ui === 'settings' ? returnScreen : 'menu');
    }
    input.edges.delete('flare'); input.edges.delete('view');
    if (input.lastDevice === 'gamepad') updateFocus();
  }

  if (game.state === 'playing' && !game.paused) {
    if (input.consume('pause')) { setPaused(true); }
    else simulate(dt);
  } else if (game.state !== 'playing') {
    // attract mode camera: slow orbit around the base
    menuCam.a += dt * 0.05;
    const B = game.world.basePad;
    camera.position.set(B.x + Math.cos(menuCam.a) * 90, B.y + 28, B.z + Math.sin(menuCam.a) * 90);
    camera.lookAt(B.x, B.y + 4, B.z);
    game.player.view = 'chase';
    game.player.cockpit.group.visible = false;
    game.player.model.group.traverse((o) => { if (o.isMesh) o.visible = true; });
    if (game.audio.ctx) game.audio.engine(0, 0, 0, false, false);
  }

  game.effects.update(game.paused ? 0 : dt);
  game.world.update(game.paused ? 0 : dt, game.player.pos);
  if (composer) composer.render(); else renderer.render(scene, camera);
}

boot().catch((e) => { console.error(e); setLoad('Fehler: ' + e.message); });
