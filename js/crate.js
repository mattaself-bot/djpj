// The crate: gathers candidate tracks for a set and picks what plays next.
import * as itunes from './sources/itunes.js';
import * as archive from './sources/archive.js';
import { genreByKey } from './genres.js';
import { keysCompatible } from './keys.js';
import { recall } from './memory.js';

const { norm } = itunes;
const pickN = (list, n) => [...(list || [])].sort(() => Math.random() - 0.5).slice(0, n);
// "Drake & Future" and "Drake" are the same act when spacing out artists
const lead = name => norm((name || '').split(/,| & | x | feat/i)[0]);
const inYears = (t, [lo, hi]) => !t.year || (t.year >= lo && t.year <= hi);

// A genre's reviewed song list (built by tools/build-catalog.mjs), minus the songs taken out of it.
const catalogs = new Map();
function loadCatalog(key) {
  if (!catalogs.has(key)) {
    const get = path => fetch(new URL(`../data/catalog/${path}`, import.meta.url)).then(r => (r.ok ? r.json() : null));
    catalogs.set(key, Promise.all([get(`${key}.json`), get('exclude.json')]).then(([cat, exclude]) => {
      if (!cat) return null;
      const out = new Set(exclude?.[key] || []);
      return cat.songs.filter(s => !out.has(s.id));
    }).catch(() => null));
  }
  return catalogs.get(key);
}

// Distance between tempos, treating half/double time as equivalent (70 BPM mixes with 140).
export function tempoDistance(a, b) {
  return Math.min(...[1, 2, 0.5].map(m => Math.abs(a / (b * m) - 1)));
}

export class Crate {
  constructor({ genreKey, seedTrack = null, archive: useArchive = false }) {
    this.genre = genreByKey(genreKey);
    this.archiveOnly = !!this.genre.archiveOnly;
    this.useArchive = (useArchive || this.archiveOnly) && !!this.genre.archive;
    this.seed = seedTrack;
    this.forced = seedTrack ? [seedTrack] : [];
    this.pool = [];     // main candidates
    this.pdPool = [];   // public-domain records sprinkled in
    this.seen = new Set();
    this.artistsUsed = new Set();
    this.refills = 0;
    this.sincePD = 0;
    this.lastArtists = [];
    if (seedTrack) this.markSeen(seedTrack);
  }

  sig(t) { return norm(t.artist) + '|' + norm(t.title); }
  markSeen(t) { this.seen.add(t.id); this.seen.add(this.sig(t)); if (t.songKey) this.seen.add(t.songKey); }
  isSeen(t) { return this.seen.has(t.id) || this.seen.has(this.sig(t)); }
  add(list, into) {
    for (const t of list) {
      if (this.isSeen(t) || into.some(x => x.id === t.id || this.sig(x) === this.sig(t))) continue;
      // tempo and key DJPJ measured the last time this record played, so it can be picked to fit
      const known = recall(t.id);
      if (known) { t.bpm ??= known.bpm; t.key ??= known.key; }
      into.push(t);
    }
  }

  // The listener switched public-domain records on or off mid-set.
  setArchive(on) {
    this.useArchive = (on || this.archiveOnly) && !!this.genre.archive;
    if (this.archiveOnly) return;
    if (!this.useArchive) this.pdPool = [];
    else if (!this.pdPool.length) archive.discover(this.genre.archive).then(l => this.add(l, this.pdPool)).catch(() => {});
  }

  // A record that was auditioned but didn't suit what's playing goes back for later.
  putBack(t) {
    delete t.prep; // frees the decoded audio; its tempo and key stay on the track
    for (const k of [t.id, this.sig(t), t.songKey]) this.seen.delete(k);
    (t.source === 'archive' && !this.archiveOnly ? this.pdPool : this.pool).push(t);
  }

  async refill() {
    const g = this.genre, jobs = [];
    const first = this.refills++ === 0;

    const songs = this.genre.catalog && !this.archiveOnly ? await loadCatalog(g.key) : null;
    if (songs) {
      // a dozen unplayed songs, no more than two by one artist
      const fresh = pickN(songs.filter(s => s.cleanId && !this.seen.has(s.id) && !this.pool.some(t => t.songKey === s.id)), songs.length);
      const perArtist = {}, batch = [];
      for (const s of fresh) {
        if (batch.length === 12) break;
        if ((perArtist[s.artist] = (perArtist[s.artist] || 0) + 1) <= 2) batch.push(s);
      }
      if (!batch.length) this.seen.clear(); // the whole catalog has played: start it over
      else this.add(batch.map(s => itunes.fromCatalog(s)), this.pool);
      // a set started from a searched song opens with a few more by that artist (one search, optional)
      if (first && this.seed?.source === 'itunes' && !itunes.throttled()) {
        jobs.push(itunes.byArtist(this.seed.artist).then(l => {
          this.add(pickN(l.filter(t => inYears(t, g.itunes.years)).slice(0, 20), 3), this.pool);
        }));
      }
    } else if (!this.archiveOnly) {
      let fresh = g.itunes.artists.filter(a => !this.artistsUsed.has(a));
      if (fresh.length < 3) { this.artistsUsed.clear(); fresh = g.itunes.artists; }
      const artists = pickN(fresh, 3);
      if (first && this.seed?.source === 'itunes') artists.unshift(this.seed.artist);
      for (const a of artists) {
        this.artistsUsed.add(a);
        jobs.push(itunes.byArtist(a).then(l => {
          // the artist's best-known songs come first; take a few of their top 20
          this.add(pickN(l.filter(t => inYears(t, g.itunes.years)).slice(0, 20), 5), this.pool);
        }));
      }
    }

    if (this.useArchive) {
      jobs.push(archive.discover(g.archive).then(l => this.add(l, this.archiveOnly ? this.pool : this.pdPool)));
    }

    const results = await Promise.allSettled(jobs);
    results.filter(r => r.status === 'rejected').forEach(r => console.warn('[crate]', r.reason));
  }

  // Next track, chosen to suit what's playing now (`prev` carries its analyzed BPM and key).
  async next(prev) {
    if (this.forced.length) return this.forced.shift();
    if (this.pdPool.length && this.sincePD >= 3 && Math.random() < 0.6) {
      this.sincePD = 0;
      return this.take(this.pdPool, prev);
    }
    for (let i = 0; i < 3 && this.pool.length < 4; i++) await this.refill();
    if (!this.pool.length) return this.pdPool.length ? this.take(this.pdPool, prev) : null;
    this.sincePD++;
    return this.take(this.pool, prev);
  }

  // Peek at a few likely upcoming tracks for the "Up next" list.
  preview(n = 3) { return this.pool.slice(0, n); }

  take(list, prev) {
    const scored = list.map(t => ({ t, s: this.score(t, prev) })).sort((a, b) => b.s - a.s);
    const { t } = scored[0];
    list.splice(list.indexOf(t), 1);
    this.markSeen(t);
    return t;
  }

  // Called when a record actually goes on: remembers the last few artists.
  played(t) {
    this.lastArtists = [lead(t.artist), ...this.lastArtists].slice(0, 4);
  }

  score(t, prev) {
    let s = Math.random() * 2;
    const prevBpm = prev?.prep?.bpm || prev?.bpm;
    if (prevBpm && t.bpm) {
      // close enough to beat-match is what matters; a known clash waits for a better moment
      const d = tempoDistance(prevBpm, t.bpm);
      s += d < 0.03 ? 2.5 : d < 0.06 ? 1.8 : d < 0.085 ? -0.5 : -3;
    }
    if (prev?.key && t.key && keysCompatible(prev.key, t.key)) s += 1;
    // no artist twice in a row, and not again within a few records
    const who = lead(t.artist);
    this.lastArtists.forEach((a, i) => { if (a === who) s -= i === 0 ? 8 : 2; });
    return s;
  }
}
