// The crate: gathers candidate tracks for a set and picks what plays next.
import * as itunes from './sources/itunes.js';
import * as archive from './sources/archive.js';
import { genreByKey } from './genres.js';
import { keysCompatible } from './keys.js';

const { norm } = itunes;
const pickN = (list, n) => [...(list || [])].sort(() => Math.random() - 0.5).slice(0, n);
const inYears = (t, [lo, hi]) => !t.year || (t.year >= lo && t.year <= hi);

// Distance between tempos, treating half/double time as equivalent (70 BPM mixes with 140).
export function tempoDistance(a, b) {
  return Math.min(...[1, 2, 0.5].map(m => Math.abs(a / (b * m) - 1)));
}

export class Crate {
  constructor({ genreKey, seedTrack = null, archive: useArchive = false, clean = true }) {
    this.genre = genreByKey(genreKey);
    this.clean = clean;
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
    if (seedTrack) this.markSeen(seedTrack);
  }

  sig(t) { return norm(t.artist) + '|' + norm(t.title); }
  markSeen(t) { this.seen.add(t.id); this.seen.add(this.sig(t)); }
  isSeen(t) { return this.seen.has(t.id) || this.seen.has(this.sig(t)); }
  add(list, into) {
    for (const t of list) if (!this.isSeen(t) && !into.some(x => x.id === t.id || this.sig(x) === this.sig(t))) into.push(t);
  }

  async refill() {
    const g = this.genre, jobs = [];
    const first = this.refills++ === 0;

    if (!this.archiveOnly) {
      let fresh = g.itunes.artists.filter(a => !this.artistsUsed.has(a));
      if (fresh.length < 3) { this.artistsUsed.clear(); fresh = g.itunes.artists; }
      const artists = pickN(fresh, 3);
      if (first && this.seed?.source === 'itunes') artists.unshift(this.seed.artist);
      for (const a of artists) {
        this.artistsUsed.add(a);
        jobs.push(itunes.byArtist(a, { clean: this.clean }).then(l => {
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

  score(t, prev) {
    let s = Math.random() * 2;
    const prevBpm = prev?.prep?.bpm;
    if (prevBpm && t.bpm) {
      const d = tempoDistance(prevBpm, t.bpm);
      s += d < 0.03 ? 3 : d < 0.06 ? 2 : d < 0.1 ? 0.5 : -1;
    }
    if (prev?.key && t.key && keysCompatible(prev.key, t.key)) s += 1.5;
    if (prev && norm(prev.artist) === norm(t.artist)) s -= 2.5;
    if (t.popularity) s += Math.min(1, Math.log10(t.popularity + 1) / 6);
    return s;
  }
}
