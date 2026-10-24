// Transitions between the outgoing and incoming deck. Each one schedules everything on the
// audio clock up front, so timing is sample-accurate even if the page is busy.
//
// run(c) gets { engine, sfx, out, inc, t0, beats, spb, rate, style, inPos, big }
//   t0    audio time the transition starts (a beat on the outgoing track)
//   spb   real seconds per beat of the outgoing track
//   rate  playback rate for the incoming track (tempo-matched for overlapping blends)
//   inPos where the incoming record starts (its in point, or its hook for a drop)
//   big   this is one of the set's rare big moments: sound effects allowed
// and returns { tIn, tLive, tEnd }: when the incoming starts, when it becomes "now playing",
// and when the outgoing is finished.
//
// beats(c) gets { style, family, preview }. Every transition ends on the outgoing record's
// out point, which sits on a phrase line, so the incoming lands on the one.
import { at, ramp, xramp } from './engine.js';

export const TRANSITIONS = {
  blend: {
    label: 'Bass-swap blend',
    sync: true,
    // house and techno DJs blend for 16-32 bars; quick-mix genres for 4-8
    beats: c => (c.preview ? (c.family === 'club' ? 16 : 8)
      : c.family === 'club' ? (c.style === 'smooth' ? 128 : 64)
      : c.style === 'smooth' ? 32 : 16),
    run({ out, inc, t0, beats, spb, rate, inPos }) {
      const end = t0 + beats * spb, mid = t0 + (beats / 2) * spb;
      inc.start(t0, inPos, rate);
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
    beats: c => (c.preview ? 8 : c.family === 'club' ? 32 : 16),
    run({ out, inc, t0, beats, spb, rate, inPos }) {
      const end = t0 + beats * spb;
      inc.start(t0, inPos, rate);
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

  // Loop the outgoing record's last bar and filter it away while the next one plays underneath.
  loopout: {
    label: 'Loop & filter out',
    sync: true,
    beats: c => (c.preview ? 8 : 16),
    run({ engine, out, inc, t0, beats, spb, rate, inPos }) {
      const end = t0 + beats * spb, mid = t0 + (beats / 2) * spb;
      const from = out.posAt(t0) - 4 * out.spb;
      out.loop(t0, end, (beats > 8 ? 4 : 2) * out.spb, Math.max(0, from));
      at(out.hp.frequency, 20, t0);
      xramp(out.hp.frequency, 1800, end);
      engine.echo.setTime(spb / 2, t0);
      at(out.delaySend.gain, 0, end - 2 * spb);
      ramp(out.delaySend.gain, 0.6, end);
      at(out.fader.gain, 1, mid);
      ramp(out.fader.gain, 0, end);
      out.stop(end + 0.05);
      inc.start(t0, inPos, rate);
      at(inc.fader.gain, 0.7, t0);
      ramp(inc.fader.gain, 1, mid);
      at(inc.low.gain, -26, t0);
      at(inc.low.gain, -26, mid - 0.03);
      ramp(inc.low.gain, 0, mid + 0.03);
      return { tIn: t0, tLive: mid, tEnd: end };
    },
  },

  // The hip-hop staple: throw an echo on the last beat and cut straight into the next record on the one.
  slam: {
    label: 'Cut on the one',
    sync: false,
    beats: () => 1,
    run({ engine, sfx, out, inc, t0, spb, inPos, big }) {
      const line = t0 + spb;
      engine.echo.setTime(spb / 2, t0);
      at(engine.echo.feedback.gain, 0.45, t0);
      at(out.delaySend.gain, 0, t0);
      ramp(out.delaySend.gain, 0.8, t0 + spb * 0.25);
      at(out.fader.gain, 1, line - 0.015);
      ramp(out.fader.gain, 0, line);
      out.stop(line + 0.05);
      inc.start(line, inPos, 1);
      at(inc.fader.gain, 1, line);
      if (big) sfx.impact(line);
      return { tIn: line, tLive: line, tEnd: line };
    },
  },

  // Strip the outgoing record down, then slam the next one in at its hook.
  drop: {
    label: 'Drop into the hook',
    sync: false,
    beats: c => (c.preview ? 4 : 8),
    run({ sfx, out, inc, t0, beats, spb, inPos, big }) {
      const end = t0 + beats * spb;
      at(out.low.gain, 0, t0);
      ramp(out.low.gain, -30, t0 + spb);
      at(out.lp.frequency, 22000, t0);
      xramp(out.lp.frequency, 700, end);
      at(out.reverbSend.gain, 0, t0);
      ramp(out.reverbSend.gain, 0.6, end);
      at(out.fader.gain, 1, end - 0.02);
      ramp(out.fader.gain, 0, end);
      out.stop(end + 0.05);
      inc.start(end, inPos, 1);
      at(inc.fader.gain, 1, end);
      if (big) { sfx.riser(t0, beats * spb); sfx.impact(end); }
      return { tIn: end, tLive: end, tEnd: end };
    },
  },

  roll: {
    label: 'Loop roll',
    sync: false,
    beats: () => 8,
    run({ engine, sfx, out, inc, t0, spb, inPos, big }) {
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
      inc.start(end, inPos, 1);
      at(inc.fader.gain, 1, end);
      if (big) sfx.impact(end);
      return { tIn: end, tLive: end, tEnd: end };
    },
  },

  echo: {
    label: 'Echo out',
    sync: false,
    beats: () => 4,
    run({ engine, out, inc, t0, beats, spb, inPos }) {
      engine.echo.setTime(spb * 0.75, t0);
      at(engine.echo.feedback.gain, 0.55, t0);
      at(out.delaySend.gain, 0, t0);
      ramp(out.delaySend.gain, 0.9, t0 + spb * 0.5);
      const cut = t0 + spb;
      at(out.fader.gain, 1, cut);
      ramp(out.fader.gain, 0, cut + 0.04);
      out.stop(cut + 0.1);
      const tIn = t0 + beats * spb;
      inc.start(tIn, inPos, 1);
      at(inc.fader.gain, 1, tIn);
      return { tIn, tLive: tIn, tEnd: cut };
    },
  },

  cut: {
    label: 'Scratch cut',
    sync: false,
    beats: () => 2,
    run({ sfx, out, inc, t0, spb, inPos, big }) {
      out.scratch(t0, 2);
      const tIn = t0 + 2 * spb;
      out.stop(tIn);
      at(out.fader.gain, 1, tIn - 0.01);
      ramp(out.fader.gain, 0, tIn);
      inc.start(tIn, inPos, 1);
      at(inc.fader.gain, 1, tIn);
      if (big) sfx.airhorn(tIn);
      return { tIn, tLive: tIn, tEnd: tIn };
    },
  },

  spin: {
    label: 'Backspin',
    sync: false,
    beats: () => 2,
    run({ sfx, out, inc, t0, inPos, big }) {
      out.backspin(t0, 1.4);
      const tIn = t0 + 1.25;
      inc.start(tIn, inPos, 1);
      at(inc.fader.gain, 1, tIn);
      if (big) sfx.impact(tIn);
      return { tIn, tLive: tIn, tEnd: t0 + 1.4 };
    },
  },

  brake: {
    label: 'Turntable brake',
    sync: false,
    beats: () => 2,
    run({ sfx, out, inc, t0, spb, inPos, big }) {
      const dur = Math.min(1.6, Math.max(0.8, spb * 2));
      out.brake(t0, dur);
      const tIn = t0 + dur + 0.12;
      inc.start(tIn, inPos, 1);
      at(inc.fader.gain, 1, tIn);
      if (big) sfx.impact(tIn);
      return { tIn, tLive: tIn, tEnd: t0 + dur };
    },
  },

  wash: {
    label: 'Riser + reverb wash',
    sync: false,
    beats: c => (c.preview ? 8 : 16),
    run({ sfx, out, inc, t0, beats, spb, style, inPos, big }) {
      const end = t0 + beats * spb;
      sfx.riser(t0, beats * spb);
      at(out.hp.frequency, 20, t0);
      xramp(out.hp.frequency, 1600, end);
      at(out.reverbSend.gain, 0, t0);
      ramp(out.reverbSend.gain, 0.8, end);
      at(out.fader.gain, 1, end);
      ramp(out.fader.gain, 0, end + 0.03);
      out.stop(end + 0.05);
      inc.start(end, inPos, 1);
      at(inc.fader.gain, 1, end);
      if (big) {
        sfx.impact(end);
        if (style === 'hype') sfx.airhorn(end);
      }
      return { tIn: end, tLive: end, tEnd: end };
    },
  },
};

// How often each transition gets picked per mix style...
export const STYLE_WEIGHTS = {
  smooth: { blend: 6, filter: 3, loopout: 2, echo: 2, slam: 1, wash: 1 },
  club: { blend: 4, filter: 3, slam: 3, loopout: 3, echo: 2, drop: 2, roll: 2, wash: 1, cut: 1, spin: 1 },
  hype: { slam: 3, drop: 3, roll: 3, cut: 2, spin: 2, echo: 2, loopout: 2, wash: 1, brake: 1, blend: 1, filter: 1 },
};
// ...scaled by how that genre gets mixed live (unlisted transitions keep their weight).
const FAMILY_BIAS = {
  club: { blend: 2.5, filter: 1.5, loopout: 1.2, drop: 1.2, slam: 0.4, cut: 0.2, spin: 0.2, brake: 0.3 },
  urban: { blend: 0.5, filter: 0.7, slam: 2, cut: 1.5, spin: 1.3, echo: 1.3 },
  band: { blend: 1.2, echo: 2, wash: 1.2, slam: 0.8, drop: 0.5, roll: 0.4, cut: 0.2, spin: 0.3, brake: 0.3 },
};

// Fast transitions for "Next track" taps.
export const QUICK = { smooth: ['echo', 'slam'], club: ['echo', 'slam', 'cut', 'spin'], hype: ['spin', 'cut', 'brake', 'slam'] };

// `recent` lists the last few transitions so the set doesn't repeat itself.
export function pickTransition(style, family, canSync, recent = [], allow = () => true) {
  const bias = FAMILY_BIAS[family] || {};
  const weights = Object.entries(STYLE_WEIGHTS[style] || STYLE_WEIGHTS.club)
    .filter(([k]) => (canSync || !TRANSITIONS[k].sync) && !recent.includes(k) && allow(k))
    .map(([k, w]) => [k, w * (bias[k] ?? 1)]);
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
