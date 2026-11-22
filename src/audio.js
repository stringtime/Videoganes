// Fully synthesized audio (no asset files)
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.listener = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }

    // Rotor: filtered noise amplitude-modulated at blade passing frequency
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7;
    this.rotorAM = ctx.createGain(); this.rotorAM.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 17;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(this.rotorAM.gain);
    this.rotorGain = ctx.createGain(); this.rotorGain.gain.value = 0;
    src.connect(lp).connect(this.rotorAM).connect(this.rotorGain).connect(this.master);
    src.start(); lfo.start();
    this.rotorLfo = lfo; this.rotorLp = lp;
    // thump: low sine also modulated
    const thump = ctx.createOscillator(); thump.type = 'sine'; thump.frequency.value = 55;
    const thumpG = ctx.createGain(); thumpG.gain.value = 0;
    const tam = ctx.createGain(); tam.gain.value = 0;
    lfo.connect(tam.gain);
    thump.connect(tam).connect(thumpG).connect(this.master); thump.start();
    this.thumpG = thumpG;
    // turbine whine
    const tw = ctx.createOscillator(); tw.type = 'sawtooth'; tw.frequency.value = 900;
    const twf = ctx.createBiquadFilter(); twf.type = 'bandpass'; twf.frequency.value = 2200; twf.Q.value = 6;
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    tw.connect(twf).connect(this.whineG).connect(this.master); tw.start();
    this.whine = tw;
    // wind
    const ws = ctx.createBufferSource(); ws.buffer = this.noise; ws.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 800; wf.Q.value = 0.5;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    ws.connect(wf).connect(this.windG).connect(this.master); ws.start();
    // warning tone
    const wo = ctx.createOscillator(); wo.type = 'square'; wo.frequency.value = 1100;
    this.warnG = ctx.createGain(); this.warnG.gain.value = 0;
    wo.connect(this.warnG).connect(this.master); wo.start();
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }

  engine(rpm, load, speed, warn, inCockpit) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = inCockpit ? 1 : 0.8;
    this.rotorGain.gain.setTargetAtTime(rpm * (0.45 + load * 0.35) * k, t, 0.1);
    this.thumpG.gain.setTargetAtTime(rpm * (0.35 + load * 0.3) * k, t, 0.1);
    this.rotorLfo.frequency.setTargetAtTime(4 + rpm * 13 + load * 1.5, t, 0.1);
    this.rotorLp.frequency.setTargetAtTime(250 + load * 300 + rpm * 100, t, 0.1);
    this.whine.frequency.setTargetAtTime(300 + rpm * 900 + load * 120, t, 0.2);
    this.whineG.gain.setTargetAtTime(rpm * 0.035, t, 0.2);
    this.windG.gain.setTargetAtTime(Math.min(0.25, speed / 300), t, 0.2);
    const on = warn && (t * 4) % 1 < 0.5;
    this.warnG.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.01);
  }

  burst(type, vol = 1) {
    if (!this.ctx || this.muted || vol < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    let dur;
    if (type === 'mg') { f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8; dur = 0.07; g.gain.setValueAtTime(0.5 * vol, t); }
    else if (type === 'enemyMg') { f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1; dur = 0.06; g.gain.setValueAtTime(0.25 * vol, t); }
    else if (type === 'rocket') { f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.8); dur = 0.9; g.gain.setValueAtTime(0.6 * vol, t); }
    else if (type === 'explosion') { f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(80, t + 1.8); dur = 2.2; g.gain.setValueAtTime(1.4 * vol, t); src.playbackRate.value = 0.5; }
    else if (type === 'hit') { f.type = 'highpass'; f.frequency.value = 2000; dur = 0.05; g.gain.setValueAtTime(0.5 * vol, t); }
    else if (type === 'impact') { f.type = 'lowpass'; f.frequency.value = 600; dur = 0.25; g.gain.setValueAtTime(0.9 * vol, t); }
    else if (type === 'flare') { f.type = 'highpass'; f.frequency.value = 1500; dur = 0.4; g.gain.setValueAtTime(0.35 * vol, t); }
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  beep(freq = 880, dur = 0.12, vol = 0.15, type = 'square') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  jingle(ok = true) {
    const notes = ok ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    notes.forEach((n, i) => setTimeout(() => this.beep(n, 0.22, 0.12, 'triangle'), i * 140));
  }
}
