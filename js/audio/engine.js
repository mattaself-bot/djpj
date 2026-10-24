// Web Audio graph.
//   deck: sources -> srcGain/fxGain -> trim -> low/mid/high EQ -> high-pass -> low-pass -> fader -> mix bus
//                                                                     fader -> delay send / reverb send
//   mix bus -> flanger -> phaser -> limiter -> volume -> analyser -> speakers

export const at = (p, v, t) => p.setValueAtTime(v, t);
export const ramp = (p, v, t) => p.linearRampToValueAtTime(v, t);
export const xramp = (p, v, t) => p.exponentialRampToValueAtTime(Math.max(v, 0.0001), t);
export function hold(p, t) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
}

export function reverseSlice(ctx, buf, from, to) {
  const sr = buf.sampleRate;
  const i0 = Math.max(0, Math.floor(from * sr)), i1 = Math.min(buf.length, Math.floor(to * sr));
  const n = Math.max(1, i1 - i0);
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
    for (let i = 0; i < n; i++) dst[i] = src[i1 - 1 - i];
  }
  return out;
}

class Echo {
  constructor(ctx) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.delay.delayTime.value = 0.375;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'highpass';
    this.tone.frequency.value = 280;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.5;
    this.input.connect(this.delay);
    this.delay.connect(this.tone);
    this.tone.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.tone.connect(this.output);
  }
  setTime(sec, t) { at(this.delay.delayTime, Math.min(sec, 3.9), t); }
}

class Reverb {
  constructor(ctx, seconds = 3) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    conv.buffer = ir;
    this.input.connect(conv);
    conv.connect(this.output);
    this.output.gain.value = 0.8;
  }
}

// Insert effects with a dry/wet mix; mix 0 = bypass.
class Insert {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
    this.on = false;
  }
  set(on, t = this.ctx.currentTime, dur = 0.4, amount = 0.7) {
    this.on = on;
    hold(this.wet.gain, t);
    hold(this.dry.gain, t);
    ramp(this.wet.gain, on ? amount : 0, t + dur);
    ramp(this.dry.gain, on ? 1 - amount * 0.4 : 1, t + dur);
  }
}

class Flanger extends Insert {
  constructor(ctx) {
    super(ctx);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.005;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const depth = ctx.createGain();
    depth.gain.value = 0.0035;
    const fb = ctx.createGain();
    fb.gain.value = 0.6;
    lfo.connect(depth).connect(delay.delayTime);
    this.input.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.wet);
    lfo.start();
  }
}

class Phaser extends Insert {
  constructor(ctx) {
    super(ctx);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const depth = ctx.createGain();
    depth.gain.value = 800;
    lfo.connect(depth);
    let node = this.input;
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 600 + i * 400;
      ap.Q.value = 0.7;
      depth.connect(ap.frequency);
      node.connect(ap);
      node = ap;
    }
    node.connect(this.wet);
    lfo.start();
  }
}

export class Deck {
  constructor(engine, name) {
    const ctx = (this.ctx = engine.ctx);
    this.engine = engine;
    this.name = name;
    this.srcGain = ctx.createGain(); // the main source (muted during slip loops/scratches)
    this.fxGain = ctx.createGain();  // loops, scratches, spins
    this.trim = ctx.createGain();
    this.low = Object.assign(ctx.createBiquadFilter(), { type: 'lowshelf' });
    this.low.frequency.value = 220;
    this.mid = Object.assign(ctx.createBiquadFilter(), { type: 'peaking' });
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.8;
    this.high = Object.assign(ctx.createBiquadFilter(), { type: 'highshelf' });
    this.high.frequency.value = 4000;
    this.hp = Object.assign(ctx.createBiquadFilter(), { type: 'highpass' });
    this.hp.frequency.value = 10;
    this.lp = Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' });
    this.lp.frequency.value = 22000;
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;

    this.srcGain.connect(this.trim);
    this.fxGain.connect(this.trim);
    this.trim.connect(this.low).connect(this.mid).connect(this.high).connect(this.hp).connect(this.lp).connect(this.fader);
    this.fader.connect(engine.bus);
    this.fader.connect(this.delaySend).connect(engine.echo.input);
    this.fader.connect(this.reverbSend).connect(engine.reverb.input);

    this.sources = new Set();
    this.tl = { t0: 0, p0: 0, r0: 1, r1: 1, dur: 0 };
    this.track = null;
    this.endsAt = Infinity;
  }

  load(track) {
    this.stopAll();
    this.track = track;
    this.prep = track.prep;
    this.buffer = track.prep.buffer;
    const t = this.ctx.currentTime;
    this.neutral(t);
    hold(this.fader.gain, t);
    at(this.fader.gain, 0, t);
    at(this.trim.gain, track.prep.gain, t);
  }

  // Reset EQ, filters and sends to flat.
  neutral(t) {
    const flat = [[this.low.gain, 0], [this.mid.gain, 0], [this.high.gain, 0], [this.hp.frequency, 10], [this.lp.frequency, 22000],
      [this.delaySend.gain, 0], [this.reverbSend.gain, 0], [this.srcGain.gain, 1], [this.fxGain.gain, 1]];
    for (const [p, v] of flat) {
      p.cancelScheduledValues(t);
      at(p, v, t);
    }
  }

  get spb() { return 60 / this.prep.bpm; } // seconds per beat in track time

  isPlaying(t = this.ctx.currentTime) { return !!this.main && t >= this.tl.t0 && t < this.endsAt; }

  _src(buffer, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    this.sources.add(s);
    s.onended = () => {
      this.sources.delete(s);
      try { s.disconnect(); } catch { /* already gone */ }
    };
    return s;
  }

  start(when, pos, rate = 1) {
    const s = (this.main = this._src(this.buffer, rate));
    s.connect(this.srcGain);
    s.start(when, Math.max(0, pos));
    this.tl = { t0: when, p0: pos, r0: rate, r1: rate, dur: 0 };
    this.endsAt = Infinity;
  }

  stop(when) {
    for (const s of this.sources) {
      try { s.stop(when); } catch { /* not started */ }
    }
    this.endsAt = Math.min(this.endsAt, when);
  }

  stopAll() {
    this.stop(this.ctx.currentTime);
    this.sources.clear();
    this.main = null;
  }

  // Track position at audio-clock time t, following any tempo ramp.
  posAt(t) {
    const { t0, p0, r0, r1, dur } = this.tl;
    const dt = t - t0;
    if (dt <= 0) return p0 + dt * r0;
    if (dur > 0 && dt < dur) return p0 + r0 * dt + ((r1 - r0) * dt * dt) / (2 * dur);
    if (dur > 0) return p0 + ((r0 + r1) / 2) * dur + r1 * (dt - dur);
    return p0 + r0 * dt;
  }

  // Audio-clock time at which the track reaches position pos.
  timeAt(pos) {
    const { t0, p0, r0, r1, dur } = this.tl;
    const d = pos - p0;
    if (dur > 0) {
      const rampDist = ((r0 + r1) / 2) * dur;
      if (d < rampDist && d > 0) {
        const a = (r1 - r0) / (2 * dur);
        if (Math.abs(a) < 1e-9) return t0 + d / r0;
        return t0 + (-r0 + Math.sqrt(r0 * r0 + 4 * a * d)) / (2 * a);
      }
      if (d >= rampDist) return t0 + dur + (d - rampDist) / r1;
    }
    return t0 + d / r0;
  }

  rateAt(t) {
    const { t0, r0, r1, dur } = this.tl;
    if (dur <= 0 || t <= t0) return t <= t0 ? r0 : r1;
    return t >= t0 + dur ? r1 : r0 + ((r1 - r0) * (t - t0)) / dur;
  }

  setRate(rate, when, dur) {
    if (!this.main) return;
    const p = this.posAt(when), r = this.rateAt(when);
    this.tl = { t0: when, p0: p, r0: r, r1: rate, dur };
    const pr = this.main.playbackRate;
    pr.cancelScheduledValues(when);
    at(pr, r, when);
    ramp(pr, rate, when + dur);
  }

  // Beat-grid helpers (track time).
  beatAfter(pos, div = 1) {
    const step = this.spb / div, fb = this.prep.firstBeat;
    return fb + Math.ceil((pos - fb) / step - 1e-3) * step;
  }
  barAfter(pos) { return this.beatAfter(pos, 0.25); }

  // Slip loop: from t0 to t1 the audio repeats `len` seconds starting at `from`, while the
  // track keeps running underneath, so it picks up where it would have been.
  loop(t0, t1, len, from = this.posAt(t0)) {
    const s = this._src(this.buffer, this.rateAt(t0));
    s.loop = true;
    s.loopStart = from;
    s.loopEnd = from + len;
    s.connect(this.fxGain);
    s.start(t0, from);
    s.stop(t1);
    at(this.srcGain.gain, 0, t0);
    at(this.srcGain.gain, 1, t1);
  }

  // Baby scratches on the record around the current spot: alternating forward/back strokes.
  scratch(t0, beats = 1) {
    const ctx = this.ctx, rate = this.rateAt(t0);
    const stroke = this.spb / rate / 4; // 16th-note strokes
    const from = Math.max(0, this.posAt(t0) - 0.05);
    const slice = 0.16;
    const rev = reverseSlice(ctx, this.buffer, from, from + slice);
    const strokes = Math.max(2, Math.round(beats * 4));
    for (let i = 0; i < strokes; i++) {
      const t = t0 + i * stroke;
      const back = i % 2 === 1;
      const s = this._src(back ? rev : this.buffer, slice / stroke);
      const g = ctx.createGain();
      s.connect(g).connect(this.fxGain);
      const peak = (slice / stroke) * 1.6;
      s.playbackRate.setValueCurveAtTime(new Float32Array([peak * 0.3, peak, peak * 0.35]), t, stroke * 0.95);
      at(g.gain, 0, t);
      ramp(g.gain, 1, t + 0.006);
      at(g.gain, 1, t + stroke - 0.012);
      ramp(g.gain, 0, t + stroke - 0.002);
      s.start(t, back ? 0 : from);
      s.stop(t + stroke);
    }
    at(this.srcGain.gain, 0, t0);
    at(this.srcGain.gain, 1, t0 + strokes * stroke);
  }

  // Spin the record backwards and let it wind down. Ends the deck.
  backspin(t0, dur = 1.4) {
    const p = this.posAt(t0);
    const rev = reverseSlice(this.ctx, this.buffer, Math.max(0, p - 4), p);
    const s = this._src(rev, 3.2);
    const g = this.ctx.createGain();
    s.connect(g).connect(this.fxGain);
    at(s.playbackRate, 3.2, t0);
    xramp(s.playbackRate, 0.05, t0 + dur);
    at(g.gain, 1, t0);
    ramp(g.gain, 0, t0 + dur);
    s.start(t0, 0);
    s.stop(t0 + dur);
    at(this.srcGain.gain, 0, t0);
    this.main?.stop(t0 + 0.02);
    this.endsAt = t0 + dur;
  }

  // Power-off turntable stop. Ends the deck.
  brake(t0, dur = 1) {
    if (!this.main) return;
    const pr = this.main.playbackRate;
    pr.cancelScheduledValues(t0);
    at(pr, this.rateAt(t0), t0);
    ramp(pr, 0.01, t0 + dur);
    hold(this.lp.frequency, t0);
    xramp(this.lp.frequency, 900, t0 + dur);
    this.main.stop(t0 + dur + 0.02);
    this.endsAt = t0 + dur;
  }
}

function silentWavUrl() {
  const sr = 8000, n = sr; // one second
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class Engine {
  // Must be called from a tap/click so mobile browsers allow sound.
  init() {
    if (this.ctx) {
      this.keepAlive?.play().catch(() => {});
      return this.ctx.resume();
    }
    // iOS: route Web Audio as media playback so the ringer switch doesn't mute it
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    this.keepAlive = new Audio(silentWavUrl());
    this.keepAlive.loop = true;
    this.keepAlive.play().catch(() => {});

    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'playback' }));
    this.bus = ctx.createGain();
    this.flanger = new Flanger(ctx);
    this.phaser = new Phaser(ctx);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.volume = ctx.createGain();
    this.volume.gain.value = 0.9;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.bus.connect(this.flanger.input);
    this.flanger.output.connect(this.phaser.input);
    this.phaser.output.connect(this.limiter);
    this.limiter.connect(this.volume).connect(this.analyser).connect(ctx.destination);

    this.echo = new Echo(ctx);
    this.echo.output.connect(this.bus);
    this.reverb = new Reverb(ctx);
    this.reverb.output.connect(this.bus);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.bus);
    const sfxVerb = ctx.createGain();
    sfxVerb.gain.value = 0.25;
    this.sfxBus.connect(sfxVerb).connect(this.reverb.input);

    this.decks = [new Deck(this, 'A'), new Deck(this, 'B')];
    return ctx.resume();
  }

  get now() { return this.ctx.currentTime; }
}
