// Synthesised sound: engine (oscillators at the firing frequency through a
// shaper and a throttle-tracking filter), turbo, tyre squeal, wind, impacts.
// No samples, so nothing to download.

const PROFILES = {
  // [harmonic multiple of firing frequency, waveform, level]
  i6: { voices: [[0.5, 'sawtooth', 0.5], [1, 'sawtooth', 0.55], [2, 'triangle', 0.18]], filter: [260, 2600], drive: 2.2, noise: 0.1 },
  flat6: { voices: [[0.5, 'sawtooth', 0.35], [1, 'sawtooth', 0.55], [1.5, 'sawtooth', 0.28], [3, 'square', 0.07]], filter: [320, 4200], drive: 3.2, noise: 0.16 },
  v8: { voices: [[0.25, 'sawtooth', 0.3], [0.5, 'sawtooth', 0.5], [1, 'sawtooth', 0.5], [2, 'square', 0.1]], filter: [300, 3800], drive: 3.0, noise: 0.14 },
};

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function shaper(ctx, amount) {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('dwp.muted') === '1';
    this.nodes = null;
  }

  // must be called from a user gesture the first time
  start(spec) {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.noise = noiseBuffer(this.ctx);
        this.master = this.ctx.createGain();
        this.comp = this.ctx.createDynamicsCompressor();
        this.master.connect(this.comp);
        this.comp.connect(this.ctx.destination);
      }
      this.ctx.resume();
      this.stop();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this._build(spec);
    } catch (e) {
      console.warn('audio unavailable', e);
      this.nodes = null;
    }
  }

  _noise(filterType, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    return { src, filter, gain };
  }

  _build(spec) {
    const ctx = this.ctx;
    const prof = PROFILES[spec.engine.sound] ?? PROFILES.i6;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const drive = shaper(ctx, prof.drive);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;
    const out = ctx.createGain();
    out.gain.value = 0;
    mix.connect(drive);
    drive.connect(filter);
    filter.connect(out);
    out.connect(this.master);
    const voices = prof.voices.map(([mult, type, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(mix);
      osc.start();
      return { osc, mult };
    });
    const roar = this._noise('bandpass', 900, 0.8);
    const squeal = this._noise('bandpass', 1100, 5);
    const squeal2 = this._noise('bandpass', 1900, 7);
    const scrub = this._noise('lowpass', 420, 0.7);
    const wind = this._noise('lowpass', 500, 0.5);
    let turbo = null;
    if (spec.engine.turbo) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      turbo = { osc, gain: g };
    }
    this.nodes = { prof, voices, filter, out, roar, squeal, squeal2, scrub, wind, turbo, cyl: spec.engine.cylinders, redline: spec.engine.redline };
  }

  update(car, slip, gravel) {
    const n = this.nodes;
    if (!n) return;
    const t = this.ctx.currentTime;
    const rpm = car.rpm;
    const firing = (rpm / 60) * (n.cyl / 2);
    const norm = Math.min(1, rpm / n.redline);
    const thr = car.throttle;
    for (const v of n.voices) v.osc.frequency.setTargetAtTime(firing * v.mult, t, 0.015);
    n.filter.frequency.setTargetAtTime(n.prof.filter[0] + norm * n.prof.filter[1] * (0.35 + 0.65 * thr), t, 0.03);
    n.out.gain.setTargetAtTime(0.1 + 0.42 * Math.pow(thr, 0.7) + 0.12 * norm, t, 0.02);
    n.roar.filter.frequency.setTargetAtTime(500 + norm * 1900, t, 0.05);
    n.roar.gain.gain.setTargetAtTime(n.prof.noise * thr * (0.3 + norm), t, 0.04);
    if (n.turbo) {
      n.turbo.osc.frequency.setTargetAtTime(2600 + car.boost * 6200, t, 0.06);
      n.turbo.gain.gain.setTargetAtTime(car.boost * car.boost * 0.02, t, 0.08);
    }
    const s = Math.min(1, slip);
    n.squeal.filter.frequency.setTargetAtTime(850 + s * 500, t, 0.08);
    n.squeal2.filter.frequency.setTargetAtTime(1500 + s * 900, t, 0.08);
    n.squeal.gain.gain.setTargetAtTime(gravel ? 0 : s * 0.3, t, 0.06);
    n.squeal2.gain.gain.setTargetAtTime(gravel ? 0 : s * s * 0.14, t, 0.06);
    n.scrub.gain.gain.setTargetAtTime((gravel ? 0.5 : 0.12) * Math.min(1, car.speed / 25) * (gravel ? 1 : s), t, 0.08);
    const sp = Math.min(1, car.speed / 70);
    n.wind.filter.frequency.setTargetAtTime(300 + sp * 900, t, 0.1);
    n.wind.gain.gain.setTargetAtTime(sp * sp * 0.3, t, 0.1);
  }

  _burst(type, freq, level, time) {
    if (!this.ctx || !this.nodes) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + time);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + time + 0.05);
  }

  impact(strength) {
    this._burst('lowpass', 500, Math.min(0.9, 0.2 + strength * 0.07), 0.3);
    if (!this.ctx || !this.nodes) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    g.gain.setValueAtTime(Math.min(0.8, 0.2 + strength * 0.06), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  blowoff() {
    this._burst('highpass', 2400, 0.16, 0.38);
  }

  shift() {
    this._burst('bandpass', 1800, 0.07, 0.06);
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('dwp.muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  // silence without tearing the graph down (pause)
  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend();
    else this.ctx.resume();
  }

  stop() {
    const n = this.nodes;
    if (!n) return;
    const kill = (x) => {
      try {
        x.stop();
      } catch {
        /* already stopped */
      }
      x.disconnect();
    };
    for (const v of n.voices) kill(v.osc);
    for (const k of ['roar', 'squeal', 'squeal2', 'scrub', 'wind']) {
      kill(n[k].src);
      n[k].gain.disconnect();
    }
    if (n.turbo) {
      kill(n.turbo.osc);
      n.turbo.gain.disconnect();
    }
    n.out.disconnect();
    this.nodes = null;
  }
}
