// Internet Archive: the Great 78 Project (George Blood collection), restricted to recordings old enough
// to be public domain in the US. Full-length, free, no key.
// https://archive.org/developers/
import { PD_LAST_YEAR } from '../genres.js';

const SEARCH = 'https://archive.org/advancedsearch.php';
const totals = new Map();

const pdQuery = clause => `collection:georgeblood AND mediatype:audio AND year:[1890 TO ${PD_LAST_YEAR}] AND (${clause})`;

async function query(q, rows, page) {
  const url = new URL(SEARCH);
  url.searchParams.set('q', q);
  for (const f of ['identifier', 'title', 'creator', 'year']) url.searchParams.append('fl[]', f);
  url.searchParams.set('rows', rows);
  url.searchParams.set('page', page);
  url.searchParams.set('output', 'json');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Archive ${res.status}`);
  return (await res.json()).response;
}

// 78 labels are often typed in ALL CAPS; tidy them up for display.
function tidy(s) {
  s = (Array.isArray(s) ? s[0] : s) || '';
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s('"-])\w/g, c => c.toUpperCase()) : s;
}

function toTrack(d) {
  const id = d.identifier;
  return {
    id: 'ia:' + id,
    source: 'archive',
    title: tidy(d.title) || 'Untitled',
    artist: tidy(d.creator) || 'Unknown artist',
    art: `https://archive.org/services/img/${id}`,
    url: null, // looked up from the item's file list right before loading
    duration: null,
    bpm: null,
    key: null,
    genre: '78rpm',
    year: parseInt(d.year, 10) || null,
    link: `https://archive.org/details/${id}`,
    isPreview: false,
    beatSync: false, // hand-played 1920s tempos drift, so don't beat-match these
    async resolve(signal) {
      if (this.url) return;
      const res = await fetch(`https://archive.org/metadata/${id}`, { signal });
      const meta = await res.json();
      const mp3s = (meta.files || []).filter(f => /\.mp3$/i.test(f.name) && (!f.length || (+f.length > 60 && +f.length < 600)));
      if (!mp3s.length) throw new Error('No MP3 in archive item');
      const file = mp3s.find(f => !/restored|_78_/i.test(f.name)) || mp3s[0];
      this.url = `https://archive.org/download/${id}/${encodeURIComponent(file.name)}`;
      this.duration = +file.length || null;
    },
  };
}

const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// A random page of public-domain records matching a genre clause.
export async function discover(clause, rows = 40) {
  const q = pdQuery(clause);
  let total = totals.get(q);
  if (total == null) {
    const first = await query(q, rows, 1);
    total = first.numFound;
    totals.set(q, total);
    if (total <= rows) return shuffle(first.docs.map(toTrack));
  }
  const page = 1 + Math.floor(Math.random() * Math.ceil(total / rows));
  return shuffle((await query(q, rows, page)).docs.map(toTrack));
}

export async function search(text, rows = 5) {
  const safe = text.replace(/[^\p{L}\p{N}\s']/gu, ' ').trim();
  if (!safe) return [];
  return (await query(pdQuery(`title:(${safe}) OR creator:(${safe})`), rows, 1)).docs.map(toTrack);
}
