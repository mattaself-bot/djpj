// Synthesized DJ sound effects, so there are no sample files to license.
import { at, ramp, xramp } from './engine.js';

export class SFX {
  constructor(engine) {
    this.engine = engine;
    const ctx = (this.ctx = engine.ctx);
    this.out = engine.sfxBus;
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    this.shaper.curve = curve;
    this.hornBus = ctx.createBiquadFilter();
    this.hornBus.type = 'bandpass';
    this.hornBus.frequency.value = 1400;
    this.hornBus.Q.value = 0.6;
    this.shaper.connect(this.hornBus).connect(this.out);
  }

  osc(type, freq, t, stop, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    return o;
  }

  noiseSrc(t, stop, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.connect(dest);
    s.start(t);
    s.stop(stop);
    return s;
  }

  // The classic reggae/club air horn: "bwaa bwa bwa bwaaaa"
  airhorn(t = this.ctx.currentTime) {
    const hits = [[0, 0.13], [0.17, 0.1], [0.31, 0.1], [0.46, 0.65]];
    for (const [off, len] of hits) {
      const g = this.ctx.createGain();
      g.connect(this.shaper);
      const s = t + off, e = s + len;
      at(g.gain, 0, s);
      ramp(g.gain, 0.28, s + 0.012);
      at(g.gain, 0.28, e - 0.04);
      ramp(g.gain, 0, e);
      for (const f of [466, 470, 233, 699]) {
        const o = this.osc('sawtooth', f, s, e + 0.02, g);
        if (len > 0.5) xramp(o.frequency, f * 0.94, e);
      }
    }
  }

  // White-noise sweep that builds tension into a drop.
  riser(t, dur) {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    bp.connect(g).connect(this.out);
    at(bp.frequency, 300, t);
    xramp(bp.frequency, 9000, t + dur);
    at(g.gain, 0.001, t);
    xramp(g.gain, 0.45, t + dur * 0.95);
    ramp(g.gain, 0, t + dur);
    this.noiseSrc(t, t + dur, bp);
    const tone = ctx.createGain();
    tone.connect(this.out);
    at(tone.gain, 0, t);
    ramp(tone.gain, 0.07, t + dur * 0.95);
    ramp(tone.gain, 0, t + dur);
    const o = this.osc('sawtooth', 110, t, t + dur, tone);
    xramp(o.frequency, 880, t + dur);
  }

  // Sub "boom" on the drop.
  impact(t = this.ctx.currentTime) {
    const g = this.ctx.createGain();
    g.connect(this.out);
    at(g.gain, 0.9, t);
    xramp(g.gain, 0.001, t + 0.9);
    const o = this.osc('sine', 150, t, t + 1, g);
    xramp(o.frequency, 34, t + 0.7);
    const ng = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(ng).connect(this.out);
    at(ng.gain, 0.4, t);
    xramp(ng.gain, 0.001, t + 0.35);
    this.noiseSrc(t, t + 0.4, lp);
  }

  laser(t = this.ctx.currentTime) {
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.16;
      const g = this.ctx.createGain();
      g.connect(this.out);
      at(g.gain, 0.16, s);
      xramp(g.gain, 0.001, s + 0.15);
      const o = this.osc('square', 2200, s, s + 0.16, g);
      xramp(o.frequency, 140, s + 0.15);
    }
  }

  siren(t = this.ctx.currentTime, dur = 1.8) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 0.8;
    bp.connect(g).connect(this.out);
    at(g.gain, 0, t);
    ramp(g.gain, 0.22, t + 0.05);
    at(g.gain, 0.22, t + dur - 0.1);
    ramp(g.gain, 0, t + dur);
    const o = this.osc('sawtooth', 900, t, t + dur, bp);
    const lfo = this.osc('triangle', 3.5, t, t + dur, ctx.createGain());
    const depth = ctx.createGain();
    depth.gain.value = 350;
    lfo.disconnect();
    lfo.connect(depth).connect(o.frequency);
  }
}
