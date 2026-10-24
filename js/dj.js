// DJPJ himself: keeps two decks going, preloads the next record, picks a transition,
// and fires it on the beat. Events: status, track, queue, stopped, error.
import { at, hold } from './audio/engine.js';
import { prepareTrack } from './audio/prep.js';
import { TRANSITIONS, QUICK, pickTransition, matchRate } from './audio/transitions.js';
import { SFX } from './audio/sfx.js';
import { runFX, randomFlair, FLAIR_GAP } from './audio/fx.js';
import { Crate } from './crate.js';

const LEAD = 2.5; // seconds before a transition that it gets locked in on the audio clock
const pick = list => list[Math.floor(Math.random() * list.length)];

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
    this.lastFlair = 0;
    this.lastType = null;
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
        return await prepareTrack(cand, this.engine.ctx, { signal, style: this.style });
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
    this.current = { deck, track };
    this.history.unshift(track);
    this.bassKill = false;
    this.lastFlair = this.engine.now;
    this.emit('track', track);
    this.status(`Now spinning “${track.title}”. Loading the next record…`);
    this.prefetch();
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
      return;
    }
    this.maybeFlair(now, pos, deck, prep);
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
      type = pickTransition(this.style, canSync, this.lastType);
      mixStart = cp.outPoint - TRANSITIONS[type].beats({ style: this.style, preview }) * deck.spb;
      const earliest = pos + LEAD * 1.3 * rateNow;
      if (mixStart < earliest) mixStart = deck.barAfter(earliest);
    }
    let beats = TRANSITIONS[type].beats({ style: this.style, preview });
    // not enough record left for a long transition: echo out instead
    if (mixStart + beats * deck.spb > cp.maxPoint) {
      type = 'echo';
      beats = TRANSITIONS.echo.beats();
      mixStart = Math.max(deck.beatAfter(pos + 0.3 * rateNow), Math.min(mixStart, cp.maxPoint - beats * deck.spb));
    }
    this.pending = { type, beats, mixStart, track: nxt };
    this.emit('queue', { next: nxt, transition: TRANSITIONS[type].label });
  }

  execute(p, t0) {
    this.pending = null;
    const out = this.current.deck, inc = this.other(out), nxt = p.track;
    const oldTrack = this.current.track;
    const spb = out.spb / out.rateAt(t0);
    const rate = TRANSITIONS[p.type].sync ? matchRate(oldTrack.prep.bpm * out.rateAt(t0), nxt.prep.bpm) ?? 1 : 1;

    inc.load(nxt);
    const res = TRANSITIONS[p.type].run({
      engine: this.engine, sfx: this.sfx, out, inc, t0, beats: p.beats, spb, rate, style: this.style,
    });
    this.transition = { ...res, type: p.type };
    this.lastType = p.type;
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

  maybeFlair(now, pos, deck, prep) {
    if (now - this.lastFlair < FLAIR_GAP[this.style]) return;
    if (pos < prep.inPoint + 16 * deck.spb || pos > prep.outPoint - 24 * deck.spb) return;
    if (Math.random() > 0.02) return;
    this.lastFlair = now;
    runFX(randomFlair(this.style), this);
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
