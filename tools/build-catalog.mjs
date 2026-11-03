// Builds a genre's song catalog: the top songs of its top artists, from the iTunes Search API.
//   node tools/build-catalog.mjs country
// Artists are the hand-picked roster in js/genres.js, then any regulars on Apple's current chart
// for the genre, up to ARTISTS. Writes data/catalog/<genre>.json. Exclusions live in
// data/catalog/exclude.json, so rebuilding never brings back a song that was taken out.
import { writeFile, mkdir } from 'node:fs/promises';
import { GENRES } from '../js/genres.js';
import { norm } from '../js/sources/itunes.js';

const ARTISTS = 60;      // artists per genre
const SONGS = 10;        // top songs per artist
const PAUSE = 3200;      // iTunes allows about 20 searches a minute
const SKIP = /\b(live|karaoke|instrumental|remix|acoustic|demo|interview|commentary|edit|version|mix)\b/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = process.argv[2];
const genre = GENRES.find(g => g.key === key);
if (!genre?.catalog) throw new Error(`No catalog settings for "${key}" in js/genres.js`);

async function get(url) {
  for (let tries = 0; ; tries++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (tries === 3) throw new Error(`${res.status} for ${url}`);
    await sleep(PAUSE * 5); // throttled: back off and retry
  }
}

// Artists with 2+ songs on Apple's current top-100 chart for this genre. One-off chart entries are
// skipped: the chart carries a lot of anonymous stock and AI uploads.
async function chartArtists(id) {
  const feed = await get(`https://itunes.apple.com/us/rss/topsongs/limit=100/genre=${id}/json`);
  const names = (feed.feed?.entry || []).map(e => e['im:artist'].label.split(/,| & | feat\.? | x /i)[0].trim());
  return [...new Set(names)].filter(n => names.filter(x => x === n).length >= 2);
}

async function topSongs(artist, [lo, hi]) {
  const url = new URL('https://itunes.apple.com/search');
  for (const [k, v] of Object.entries({ term: artist, attribute: 'artistTerm', media: 'music', entity: 'song', country: 'US', limit: 100 })) {
    url.searchParams.set(k, v);
  }
  const want = norm(artist);
  const rows = (await get(url)).results.filter(r =>
    r.kind === 'song' && r.previewUrl && norm(r.artistName).startsWith(want) && !SKIP.test(r.trackName));
  // iTunes returns an artist's best-known songs first; keep one entry per song, with its clean and explicit cuts
  const songs = new Map();
  for (const r of rows) {
    const year = r.releaseDate ? new Date(r.releaseDate).getFullYear() : null;
    if (year && (year < lo || year > hi)) continue;
    const k = norm(r.trackName);
    const s = songs.get(k) || { title: r.trackName.replace(/\s*\((feat|with)\.? .*?\)/i, ''), artist: r.artistName, year, rank: songs.size + 1 };
    const cut = r.trackExplicitness === 'explicit' ? 'explicitId' : 'cleanId';
    if (!s[cut]) s[cut] = r.trackId;
    if (!s.art) s.art = r.artworkUrl100;
    if (r.releaseDate && year < (s.year || 9999)) s.year = year;
    songs.set(k, s);
  }
  return [...songs.values()].slice(0, SONGS);
}

const charted = genre.catalog.chart ? await chartArtists(genre.catalog.chart) : [];
const names = [];
for (const a of [...genre.itunes.artists, ...(genre.catalog.more || []), ...charted]) {
  if (names.length < ARTISTS && !names.some(n => norm(n) === norm(a))) names.push(a);
}

const songs = [];
for (const [i, artist] of names.entries()) {
  try {
    const list = await topSongs(artist, genre.itunes.years);
    songs.push(...list.map(s => ({ id: norm(s.artist) + '|' + norm(s.title), ...s, rank: s.rank, charted: charted.includes(artist) || undefined })));
    console.log(`${i + 1}/${names.length} ${artist}: ${list.length}`);
  } catch (e) {
    console.warn(`${artist}: ${e.message}`);
  }
  await sleep(PAUSE);
}

const unique = [...new Map(songs.map(s => [s.id, s])).values()];
await mkdir(new URL('../data/catalog/', import.meta.url), { recursive: true });
await writeFile(new URL(`../data/catalog/${key}.json`, import.meta.url),
  JSON.stringify({ genre: key, built: new Date().toISOString().slice(0, 10), artists: names, songs: unique }, null, 1) + '\n');
console.log(`Wrote ${unique.length} songs from ${names.length} artists`);
