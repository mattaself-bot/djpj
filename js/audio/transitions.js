// Transitions between the outgoing and incoming deck. Each one schedules everything on the
// audio clock up front, so timing is sample-accurate even if the page is busy.
//
// run(c) gets { engine, sfx, out, inc, t0, beats, spb, rate, style }
//   t0    audio time the transition starts (a beat on the outgoing track)
//   spb   real seconds per beat of the outgoing track
//   rate  playback rate for the incoming track (tempo-matched for overlapping blends)
// and returns { tIn, tLive, tEnd }: when the incoming starts, when it becomes "now playing",
// and when the outgoing is finished.
import { at, ramp, xramp } from './engine.js';

export const TRANSITIONS = {
  blend: {
    label: 'Bass-swap blend',
    sync: true,
    beats: c => (c.preview ? 8 : c.style === 'smooth' ? 32 : 16),
    run({ out, inc, t0, beats, spb, rate }) {
      const end = t0 + beats * spb, mid = t0 + (beats / 2) * spb;
      inc.start(t0, inc.prep.inPoint, rate);
      at(inc.fader.gain, 0, t0);
      ramp(inc.fader.gain, 1, mid);
      at(inc.low.gain, -26, t0);
      at(inc.low.gain, -26, mid - 0.03);
      ramp(inc.low.gain, 0, mid + 0.03);
      at(inc.high.gain, -8, t0);
      ramp(inc.high.gain, 0, mid);
      at(out.low.gain, 0, mid - 0.03);
      ramp(out.low.gain, -26, mid + 0.03);
      at(out.fader.gain, 1, mid);
      ramp(out.fader.gain, 0, end);
      out.stop(end + 0.05);
      return { tIn: t0, tLive: mid, tEnd: end };
    },
  },

  filter: {
    label: 'Filter sweep',
    sync: true,
    beats: c => (c.preview ? 8 : 16),
    run({ out, inc, t0, beats, spb, rate }) {
      const end = t0 + beats * spb;
      inc.start(t0, inc.prep.inPoint, rate);
      at(inc.lp.frequency, 250, t0);
      xramp(inc.lp.frequency, 20000, end);
      at(inc.fader.gain, 0, t0);
      ramp(inc.fader.gain, 1, t0 + beats * spb * 0.3);
      at(out.hp.frequency, 20, t0);
      xramp(out.hp.frequency, 2200, end - spb);
      at(out.reverbSend.gain, 0, t0);
      ramp(out.reverbSend.gain, 0.45, end);
      at(out.fader.gain, 1, end - 2 * spb);
      ramp(out.fader.gain, 0, end);
      out.stop(end + 0.05);
      return { tIn: t0, tLive: t0 + beats * spb * 0.6, tEnd: end };
    },
  },

  roll: {
    label: 'Loop roll',
    sync: false,
    beats: () => 8,
    run({ engine, sfx, out, inc, t0, spb, style }) {
      const from = out.posAt(t0), beat = out.spb;
      // 1 beat, 1/2, 1/4, then 1/8 loops, the classic build-up stutter
      for (const [a, b, len] of [[0, 4, 1], [4, 6, 0.5], [6, 7, 0.25], [7, 8, 0.125]]) {
        out.loop(t0 + a * spb, t0 + b * spb, len * beat, from);
      }
      const end = t0 + 8 * spb;
      at(out.hp.frequency, 20, t0 + 4 * spb);
      xramp(out.hp.frequency, 1500, end);
      engine.echo.setTime(spb / 2, t0);
      at(out.delaySend.gain, 0, end - spb);
      ramp(out.delaySend.gain, 0.7, end);
      at(out.fader.gain, 1, end);
      ramp(out.fader.gain, 0, end + 0.03);
      out.stop(end + 0.05);
      inc.start(end, inc.prep.inPoint, 1);
      at(inc.fader.gain, 1, end);
      if (style !== 'smooth') sfx.impact(end);
      return { tIn: end, tLive: end, tEnd: end };
    },
  },

  echo: {
    label: 'Echo out',
    sync: false,
    beats: () => 4,
    run({ engine, out, inc, t0, beats, spb }) {
      engine.echo.setTime(spb * 0.75, t0);
      at(engine.echo.feedback.gain, 0.55, t0);
      at(out.delaySend.gain, 0, t0);
      ramp(out.delaySend.gain, 0.9, t0 + spb * 0.5);
      const cut = t0 + spb;
      at(out.fader.gain, 1, cut);
      ramp(out.fader.gain, 0, cut + 0.04);
      out.stop(cut + 0.1);
      const tIn = t0 + beats * spb;
      inc.start(tIn, inc.prep.inPoint, 1);
      at(inc.fader.gain, 1, tIn);
      return { tIn, tLive: tIn, tEnd: cut };
    },
  },

  cut: {
    label: 'Scratch cut',
    sync: false,
    beats: () => 2,
    run({ sfx, out, inc, t0, spb, style }) {
      out.scratch(t0, 2);
      const tIn = t0 + 2 * spb;
      out.stop(tIn);
      at(out.fader.gain, 1, tIn - 0.01);
      ramp(out.fader.gain, 0, tIn);
      inc.start(tIn, inc.prep.inPoint, 1);
      at(inc.fader.gain, 1, tIn);
      if (style === 'hype' || Math.random() < 0.35) sfx.airhorn(tIn);
      return { tIn, tLive: tIn, tEnd: tIn };
    },
  },

  spin: {
    label: 'Backspin',
    sync: false,
    beats: () => 2,
    run({ sfx, out, inc, t0, style }) {
      out.backspin(t0, 1.4);
      const tIn = t0 + 1.25;
      inc.start(tIn, inc.prep.inPoint, 1);
      at(inc.fader.gain, 1, tIn);
      if (style === 'hype') sfx.impact(tIn);
      return { tIn, tLive: tIn, tEnd: t0 + 1.4 };
    },
  },

  brake: {
    label: 'Turntable brake',
    sync: false,
    beats: () => 2,
    run({ sfx, out, inc, t0, spb }) {
      const dur = Math.min(1.6, Math.max(0.8, spb * 2));
      out.brake(t0, dur);
      const tIn = t0 + dur + 0.12;
      inc.start(tIn, inc.prep.inPoint, 1);
      at(inc.fader.gain, 1, tIn);
      sfx.impact(tIn);
      return { tIn, tLive: tIn, tEnd: t0 + dur };
    },
  },

  wash: {
    label: 'Riser + reverb wash',
    sync: false,
    beats: c => (c.preview ? 8 : 16),
    run({ sfx, out, inc, t0, beats, spb, style }) {
      const end = t0 + beats * spb;
      sfx.riser(t0, beats * spb);
      at(out.hp.frequency, 20, t0);
      xramp(out.hp.frequency, 1600, end);
      at(out.reverbSend.gain, 0, t0);
      ramp(out.reverbSend.gain, 0.8, end);
      at(out.fader.gain, 1, end);
      ramp(out.fader.gain, 0, end + 0.03);
      out.stop(end + 0.05);
      inc.start(end, inc.prep.inPoint, 1);
      at(inc.fader.gain, 1, end);
      sfx.impact(end);
      if (style === 'hype') sfx.airhorn(end);
      return { tIn: end, tLive: end, tEnd: end };
    },
  },
};

// How often each transition gets picked per mix style.
export const STYLE_WEIGHTS = {
  smooth: { blend: 6, filter: 3, echo: 2, wash: 1 },
  club: { blend: 4, filter: 3, roll: 2, echo: 2, wash: 2, cut: 1, spin: 1 },
  hype: { blend: 1, filter: 1, roll: 3, echo: 2, wash: 2, cut: 3, spin: 3, brake: 2 },
};

// Fast transitions for "Next track" taps.
export const QUICK = { smooth: ['echo'], club: ['echo', 'cut', 'spin'], hype: ['spin', 'cut', 'brake'] };

export function pickTransition(style, canSync, exclude) {
  const weights = Object.entries(STYLE_WEIGHTS[style] || STYLE_WEIGHTS.club)
    .filter(([k]) => (canSync || !TRANSITIONS[k].sync) && k !== exclude);
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of weights) if ((r -= w) <= 0) return k;
  return 'echo';
}

// Rate that makes the incoming tempo match the outgoing one, allowing half/double time. Null if too far apart.
export function matchRate(outBpm, inBpm, maxShift = 0.08) {
  for (const m of [1, 2, 0.5]) {
    const r = outBpm / (inBpm * m);
    if (Math.abs(r - 1) <= maxShift) return r;
  }
  return null;
}
