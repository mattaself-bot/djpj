// DJPJ himself: keeps two decks going, preloads the next record, picks a transition,
// and fires it on the beat. Between transitions he works the phrase lines of the live record:
// a flourish into the next section, a tease of what's coming, a callback to an earlier hook,
// or a rewind when a record deserves it. Events: status, track, queue, stopped, error.
import { at, hold } from './audio/engine.js';
import { prepareTrack } from './audio/prep.js';
import { TRANSITIONS, QUICK, pickTransition, matchRate } from './audio/transitions.js';
import { SFX } from './audio/sfx.js';
import { randomFlair, runFlair, FLAIR_ODDS } from './audio/fx.js';
import { Crate } from './crate.js';

const LEAD = 2.5; // seconds before a transition that it gets locked in on the audio clock
const pick = list => list[Math.floor(Math.random() * list.length)];
// chance a transition is one of the set's big moments (sound effects allowed), and the
// minimum number of transitions between two of them
const BIG = { smooth: 0, club: 0.15, hype: 0.35 };
const BIG_GAP = 2;
// chance each record gets a trick (rewind, callback or tease) on top of its transition
const TRICK_ODDS = { smooth: 0.3, club: 0.5, hype: 0.7 };
const TRICK_FAMILY = {
  rewind: { urban: 1, band: 0.25, club: 0.1 },
  callback: { urban: 1, band: 0.6, club: 1 },
  tease: { urban: 1, band: 0.8, club: 1 },
};

export class AutoDJ extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.style = 'club';
    this.paused = false;
    this.session = null;
    this.reset();
  }

  reset() {
    this.current = null;     // { deck, track } now playing
    this.next = null;        // prepared track waiting to come in
    this.pending = null;     // planned transition
    this.transition = null;  // transition in progress
    this.history = [];
    this.events = [];
    this.skipWith = null;
    this.waiting = false;
    this.bassKill = false;
    this.lastFlair = null;
    this.recent = [];        // last few transitions, so the set doesn't repeat itself
    this.sinceBig = BIG_GAP;
    this.hooks = [];         // hooks of records already played, for callbacks
    this.trick = null;       // { kind, done } planned for the live record
    this.trickAge = { rewind: 3, callback: 3, tease: 3 };
    this.lineDone = 0;       // last phrase line already decided
    this.busyUntil = 0;      // a rewind or callback owns the decks until then
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  status(msg) { this.emit('status', msg); }
  liveDeck() { return this.current?.deck || null; }
  other(deck) { return this.engine.decks[0] === deck ? this.engine.decks[1] : this.engine.decks[0]; }
  upcoming() { return this.crate ? this.crate.preview(3) : []; }

  // Start a set, or, if one is already playing, mix over into the new pick.
  async play(opts) {
    if (!this.sfx) this.sfx = new SFX(this.engine);
    if (this.session && this.current) return this.switchTo(opts);
    this.stop();
    const session = (this.session = { abort: new AbortController() });
    this.crate = new Crate(opts);
    this.status('Digging through the crates…');
    this.timer = setInterval(() => this.tick(), 100);
    try {
      const first = await this.loadNext(session.abort.signal, session);
      if (this.session !== session) return;
      this.startFresh(first);
    } catch (e) {
      if (this.session === session && e.name !== 'AbortError') {
        this.status(e.message);
        this.emit('error', e);
      }
    }
  }

  switchTo(opts) {
    this.crate = new Crate(opts);
    this.pending = null;
    this.next = null;
    this.skipWith = 'quick';
    this.status('Switching it up. Pulling new records…');
    this.prefetch();
  }

  async loadNext(signal, session) {
    for (let tries = 0; tries < 8; tries++) {
      const crate = this.crate;
      const cand = await crate.next(this.current?.track);
      if (this.session !== session || crate !== this.crate) throw new DOMException('Superseded', 'AbortError');
      if (!cand) break;
      this.emit('queue', { loading: cand });
      try {
        return await prepareTrack(cand, this.engine.ctx, { signal, style: this.style, genre: crate.genre.key });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn('[djpj] skipping', cand.title, e);
      }
    }
    throw new Error("Couldn't find playable tracks for that pick. Try another genre or song.");
  }

  async prefetch() {
    const session = this.session;
    this.loadCtl?.abort();
    const ctl = (this.loadCtl = new AbortController());
    this.next = null;
    try {
      const t = await this.loadNext(ctl.signal, session);
      if (this.session !== session || this.loadCtl !== ctl) return;
      this.next = t;
      this.emit('queue', { next: t });
      if (this.waiting) this.startFresh(t);
      else if (this.current) this.status(`Now spinning “${this.current.track.title}”. Up next: “${t.title}”`);
    } catch (e) {
      if (e.name === 'AbortError' || this.session !== session || this.loadCtl !== ctl) return;
      this.status('Having trouble loading the next record. Retrying…');
      setTimeout(() => { if (this.session === session && !this.next) this.prefetch(); }, 4000);
    }
  }

  startFresh(track) {
    const deck = this.current ? this.other(this.current.deck) : this.engine.decks[0];
    deck.load(track);
    const t = this.engine.now + 0.12;
    at(deck.fader.gain, 1, t);
    deck.start(t, track.prep.inPoint, 1);
    if (this.waiting) this.sfx.impact(t);
    this.waiting = false;
    this.next = null;
    this.setCurrent(deck, track);
  }

  setCurrent(deck, track) {
    const prev = this.current?.track;
    this.current = { deck, track };
    this.history.unshift(track);
    this.bassKill = false;
    if (prev?.prep?.hook) {
      this.hooks.unshift({ title: prev.title, ...prev.prep.hook });
      this.hooks.length = Math.min(this.hooks.length, 12);
    }
    this.trick = this.chooseTrick(track);
    this.emit('track', track);
    const edit = track.prep.edit ? ` (DJPJ edit: ${track.prep.edit})` : '';
    this.status(`Now spinning “${track.title}”${edit}. Loading the next record…`);
    this.prefetch();
  }

  // Rotate the tricks so every set comes out different: each record may get one, and the
  // longer a trick has been resting the likelier it is to come up next.
  chooseTrick(track) {
    const p = track.prep;
    for (const k in this.trickAge) this.trickAge[k]++;
    let odds = TRICK_ODDS[this.style] ?? 0.5;
    if (track.isPreview) odds *= 1.3;
    if (!p.beatSync || Math.random() > odds) return null;
    const weights = Object.entries(TRICK_FAMILY).map(([k, fam]) => {
      let w = (fam[p.family] ?? 0.5) * Math.min(4, this.trickAge[k]);
      if (k === 'rewind' && this.style === 'smooth') w *= 0.3;
      if (k === 'callback' && this.hooks.length < 2) w = 0;
      return [k, w];
    }).filter(([, w]) => w > 0);
    let r = Math.random() * weights.reduce((sum, [, w]) => sum + w, 0);
    for (const [k, w] of weights) {
      if ((r -= w) <= 0) {
        this.trickAge[k] = 0;
        return { kind: k, done: false };
      }
    }
    return null;
  }

  at(t, fn) { this.events.push({ t, fn }); }

  tick() {
    if (!this.session || this.paused) return;
    const now = this.engine.now;
    const due = this.events.filter(ev => ev.t <= now);
    this.events = this.events.filter(ev => ev.t > now);
    due.forEach(ev => ev.fn());

    const cur = this.current;
    if (!cur || this.waiting) return;
    const tr = this.transition;
    if (tr && now < Math.max(tr.tEnd, tr.tLive) + 0.1) return;

    const deck = cur.deck, prep = cur.track.prep;
    this.workLine(now, deck, prep);
    if (this.pending) {
      const t0 = deck.timeAt(this.pending.mixStart);
      if (t0 - now < LEAD) this.execute(this.pending, Math.max(t0, now + 0.05));
      return;
    }
    if (this.next) return this.plan();

    // next record isn't ready yet: let this one run longer, or fade it out if it's ending
    const pos = deck.posAt(now);
    if (pos > prep.outPoint - 3) {
      const ext = 16 * deck.spb;
      if (prep.outPoint + ext < prep.maxPoint) {
        prep.outPoint += ext;
      } else {
        const end = deck.timeAt(prep.maxPoint);
        hold(deck.fader.gain, now);
        deck.fader.gain.linearRampToValueAtTime(0, Math.max(now + 1, end));
        deck.stop(Math.max(now + 1, end) + 0.05);
        this.waiting = true;
        this.status('Waiting on the next record…');
      }
    }
  }

  plan() {
    const cur = this.current, nxt = this.next, deck = cur.deck, now = this.engine.now;
    const cp = cur.track.prep, np = nxt.prep;
    const preview = !!(cur.track.isPreview || nxt.isPreview);
    const rateNow = deck.rateAt(now);
    const pos = deck.posAt(now);
    const canSync = cp.beatSync && np.beatSync && matchRate(cp.bpm * rateNow, np.bpm) != null;
    let type, mixStart;

    if (this.skipWith) {
      type = this.skipWith === 'quick' ? pick(QUICK[this.style] || QUICK.club) : this.skipWith;
      mixStart = deck.beatAfter(pos + 0.3 * rateNow);
      this.skipWith = null;
    } else {
      // a drop needs the next record's hook to land on, with a couple of lines to play after it
      const allow = k => k !== 'drop' || (np.hookAt != null && np.hookAt + 32 * (60 / np.bpm) < np.outPoint);
      type = pickTransition(this.style, cp.family, canSync, this.recent, allow);
      mixStart = cp.outPoint - TRANSITIONS[type].beats({ style: this.style, preview, family: cp.family }) * deck.spb;
      const earliest = pos + LEAD * 1.3 * rateNow;
      if (mixStart < earliest) mixStart = deck.barAfter(earliest);
    }
    let beats = TRANSITIONS[type].beats({ style: this.style, preview, family: cp.family });
    // not enough record left for a long transition: echo out instead
    if (mixStart + beats * deck.spb > cp.maxPoint) {
      type = 'echo';
      beats = TRANSITIONS.echo.beats();
      mixStart = Math.max(deck.beatAfter(pos + 0.3 * rateNow), Math.min(mixStart, cp.maxPoint - beats * deck.spb));
    }
    const big = this.sinceBig >= BIG_GAP && Math.random() < (BIG[this.style] ?? 0);
    this.pending = { type, beats, mixStart, track: nxt, big };
    this.emit('queue', { next: nxt, transition: TRANSITIONS[type].label });
  }

  execute(p, t0) {
    this.pending = null;
    const out = this.current.deck, inc = this.other(out), nxt = p.track;
    const oldTrack = this.current.track;
    const spb = out.spb / out.rateAt(t0);
    const rate = TRANSITIONS[p.type].sync ? matchRate(oldTrack.prep.bpm * out.rateAt(t0), nxt.prep.bpm) ?? 1 : 1;

    inc.load(nxt);
    const inPos = p.type === 'drop' && nxt.prep.hookAt != null ? nxt.prep.hookAt : nxt.prep.inPoint;
    const res = TRANSITIONS[p.type].run({
      engine: this.engine, sfx: this.sfx, out, inc, t0, beats: p.beats, spb, rate, style: this.style, inPos, big: p.big,
    });
    this.transition = { ...res, type: p.type };
    this.recent = [p.type, ...this.recent].slice(0, 2);
    this.sinceBig = p.big ? 0 : this.sinceBig + 1;
    this.next = null;
    this.status(`🎚️ ${TRANSITIONS[p.type].label} into “${nxt.title}”`);

    // a tempo-matched record eases back to its own speed once the blend is done
    if (rate !== 1) {
      const back = res.tIn + p.beats * spb + 0.05;
      const dur = Math.min(24 * spb, (nxt.prep.outPoint - nxt.prep.inPoint) * 0.3);
      inc.setRate(1, back, dur);
    }
    this.at(res.tLive, () => this.setCurrent(inc, nxt));
    this.at(res.tEnd + 8, () => {
      if (out !== this.current?.deck && out.track === oldTrack) {
        out.stopAll();
        out.neutral(this.engine.now);
      }
    });
  }

  // Phrase lines of the live record: 8 bars on full tracks, 4 on previews (they're only ~12 bars long).
  lineBars(deck) { return deck.track?.isPreview ? 4 : 8; }
  lineAfter(deck, pos) {
    return deck.gridAfter(pos, this.lineBars(deck) * 4 * deck.spb, deck.prep.phraseStart ?? deck.prep.firstBeat);
  }

  // Decide what happens on the next phrase line, once it's close enough to lock in.
  workLine(now, deck, prep) {
    if (now < this.busyUntil || (this.transition && now < this.transition.tEnd + 0.1)) return;
    const linePos = this.lineAfter(deck, deck.posAt(now + 0.15));
    const T = deck.timeAt(linePos);
    if (T - now > LEAD || T <= this.lineDone + 0.05) return;
    this.lineDone = T;
    const real = (deck.spb / deck.rateAt(T)) * 4; // seconds per bar
    const lineLen = this.lineBars(deck) * real;
    const mixT = this.pending ? deck.timeAt(this.pending.mixStart) : deck.timeAt(prep.outPoint);
    if (T > mixT - real || linePos <= prep.inPoint + 0.01) return; // let a record land before working it
    // the line right before the mix belongs to the transition, except for a rewind (it pushes the
    // mix back) or a quick tease of what's coming
    const owned = T > mixT - lineLen * 1.05;
    const tr = this.trick;
    if (tr && !tr.done && (!owned || tr.kind !== 'callback') && this.runTrick(tr, deck, prep, T, linePos, real, mixT)) return;
    if (owned) return;
    if (Math.random() < (FLAIR_ODDS[this.style] ?? 0.25)) {
      this.lastFlair = randomFlair(this.style, this.lastFlair);
      runFlair(this.lastFlair, this, T);
    }
  }

  // A tease or callback that can't sync to this record becomes a rewind (no sync needed) instead.
  // Returns true if it did, so the caller can try the rewind on the same line.
  fallback(tr) {
    if (this.style === 'smooth' || this.current.track.prep.family === 'club') tr.done = true;
    else tr.kind = 'rewind';
    return tr.kind === 'rewind';
  }

  // Returns true if the trick took this line.
  runTrick(tr, deck, prep, T, linePos, real, mixT) {
    const live = deck.rateAt(T) * prep.bpm;
    const sampler = this.engine.sampler;
    const title = this.current.track.title;
    if (tr.kind === 'rewind') {
      // after the hook has hit once, and while there's still most of the record ahead to replay
      const hookEnd = (prep.hookAt ?? prep.inPoint) + (prep.hook?.bars || 4) * 4 * deck.spb;
      const rampDone = !deck.tl.dur || T > deck.tl.t0 + deck.tl.dur;
      if (linePos < hookEnd - 0.01 || !rampDone) return false;
      const t1 = T + (real / 2 >= 1 ? real / 2 : real);
      deck.rewind(T, t1, prep.inPoint);
      tr.done = true;
      this.busyUntil = t1 + 0.1;
      this.lineDone = t1;
      if (this.style === 'hype' && this.sinceBig >= BIG_GAP && Math.random() < 0.5) {
        this.sfx.airhorn(t1);
        this.sinceBig = 0;
      }
      this.at(T, () => this.status(`🔁 Run it back! “${title}” from the top`));
      return true;
    }
    if (tr.kind === 'callback') {
      const hooks = this.hooks.slice(1).filter(h => matchRate(live, h.bpm) != null);
      if (!hooks.length) return this.fallback(tr) && this.runTrick(tr, deck, prep, T, linePos, real, mixT);
      const h = pick(hooks);
      const rate = matchRate(live, h.bpm);
      const dur = Math.max(1, Math.floor(8 / h.bars)) * h.bars * real; // two passes of a 4-bar hook
      if (T + dur > mixT - real) return false;
      sampler.play(h.buffer, T, { rate, dur, loop: true, gain: 0.6, hp: 280, echo: 0.2, fade: 0.01 });
      at(deck.mid.gain, -5, T);
      at(deck.mid.gain, 0, T + dur);
      tr.done = true;
      this.busyUntil = T + dur - 0.2;
      this.at(T, () => this.status(`🎙️ Callback: “${h.title}” over “${title}”`));
      return true;
    }
    if (tr.kind === 'tease') {
      const nxt = this.pending?.track || this.next;
      const hook = nxt?.prep?.hook;
      if (!hook) return false;
      // one or two lines before the mix, so the crowd hears it coming
      if (T < mixT - 2.5 * this.lineBars(deck) * real) return false;
      const rate = matchRate(live, hook.bpm);
      if (rate == null) return this.fallback(tr) && this.runTrick(tr, deck, prep, T, linePos, real, mixT);
      const bars = T + 2 * real <= mixT && Math.random() < 0.5 ? 2 : 1;
      sampler.play(hook.buffer, T, { rate, dur: bars * real, gain: 0.5, hp: 450, echo: 0.55, fade: 0.01 });
      tr.done = true;
      this.at(T, () => this.status(`👀 Teasing “${nxt.title}”…`));
      return true;
    }
    return false;
  }

  skip(kind = 'quick') {
    if (!this.current || this.waiting) return;
    const tr = this.transition, now = this.engine.now;
    this.skipWith = kind;
    this.pending = null;
    // mid-transition, the skip waits until the mix lands (tick() plans it then)
    if (tr && now < Math.max(tr.tEnd, tr.tLive) + 0.1) this.status('Got it. Moving on right after this mix…');
    else if (this.next) this.plan();
    else this.status('Cueing up the next record…');
  }

  async togglePause() {
    if (!this.session) return this.paused;
    this.paused = !this.paused;
    if (this.paused) await this.engine.ctx.suspend();
    else await this.engine.ctx.resume();
    return this.paused;
  }

  stop() {
    this.session?.abort.abort();
    this.loadCtl?.abort();
    this.session = null;
    clearInterval(this.timer);
    if (this.engine.decks) {
      const now = this.engine.now;
      for (const d of this.engine.decks) {
        d.stopAll();
        d.neutral(now);
        hold(d.fader.gain, now);
        at(d.fader.gain, 0, now);
      }
    }
    if (this.paused) {
      this.engine.ctx.resume();
      this.paused = false;
    }
    this.reset();
    this.emit('stopped');
  }
}
