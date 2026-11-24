// Builds a genre's song catalog: the top songs of its top artists, from the iTunes Search API.
//   node tools/build-catalog.mjs country             build (or rebuild) one genre
//   node tools/build-catalog.mjs all                 build every genre that has catalog settings
//   node tools/build-catalog.mjs country --refresh   keep the song list, just renew its preview links
//   node tools/build-catalog.mjs country --add       keep the song list, fetch only roster artists it lacks
// Artists are the hand-picked roster in js/genres.js, then any regulars on Apple's current chart
// for the genre (when it names one), up to ARTISTS. Writes data/catalog/<genre>.json. Each song
// carries its preview link, so the site can play a genre without calling Apple's search at all
// (visitors get throttled after a few dozen searches). Exclusions live in data/catalog/exclude.json,
// so rebuilding never brings back a song that was taken out.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { GENRES } from '../js/genres.js';
import { norm } from '../js/sources/itunes.js';

const ARTISTS = 80;      // artists per genre
const SONGS = 10;        // top songs per artist
const PAUSE = 3200;      // iTunes allows about 20 searches a minute
const SKIP = /\b(live|karaoke|instrumental|remix|acoustic|demo|interview|commentary|edit|version|mix|skit|interlude|intro|outro)\b/i;
const SKIP_GENRE = /soundtrack|score|comedy|spoken|karaoke|holiday|children/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const [which, ...flags] = process.argv.slice(2);
const refreshOnly = flags.includes('--refresh'), addOnly = flags.includes('--add');
const genres = which === 'all' ? GENRES.filter(g => g.catalog) : GENRES.filter(g => g.key === which);
if (!genres.length || genres.some(g => !g.catalog)) throw new Error(`No catalog settings for "${which}" in js/genres.js`);
const fileFor = key => new URL(`../data/catalog/${key}.json`, import.meta.url);

async function get(url) {
  for (let tries = 0; ; tries++) {
    // a refusal (throttled) or a dropped connection: back off and retry
    const res = await fetch(url).catch(e => ({ ok: false, status: e.cause?.code || e.message }));
    if (res.ok) return res.json();
    if (tries === 5) throw new Error(`${res.status} for ${url}`);
    await sleep(PAUSE * 5 * (tries + 1));
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
  for (const [k, v] of Object.entries({ term: artist, attribute: 'artistTerm', media: 'music', entity: 'song', country: 'US', limit: 100, explicit: 'No' })) {
    url.searchParams.set(k, v);
  }
  // the artist alone or as the lead name ("Drake & Future"), not a longer name ("Drake Bell")
  const want = norm(artist);
  const mine = name => norm(name) === want || norm(name.split(/,| & | x | and /i)[0]) === want;
  const rows = (await get(url)).results.filter(r =>
    r.kind === 'song' && r.previewUrl && r.trackExplicitness !== 'explicit' && mine(r.artistName) && !SKIP.test(r.trackName) && !SKIP_GENRE.test(r.primaryGenreName || ''));
  // iTunes returns an artist's best-known songs first; keep one entry per song (clean cuts only)
  const songs = new Map();
  for (const r of rows) {
    const year = r.releaseDate ? new Date(r.releaseDate).getFullYear() : null;
    if (year && (year < lo || year > hi)) continue;
    const k = norm(r.trackName);
    const s = songs.get(k) || { title: r.trackName.replace(/\s*\((feat|with)\.? .*?\)/i, ''), artist: r.artistName, year, rank: songs.size + 1 };
    if (!s.cleanId) { s.cleanId = r.trackId; s.cleanUrl = r.previewUrl; }
    if (!s.art) s.art = r.artworkUrl100;
    if (r.releaseDate && year < (s.year || 9999)) s.year = year;
    songs.set(k, s);
  }
  return [...songs.values()].slice(0, SONGS);
}

async function build(genre) {
  const charted = genre.catalog.chart && !addOnly ? await chartArtists(genre.catalog.chart) : []; // --add: roster only
  const names = [];
  for (const a of [...genre.itunes.artists, ...(genre.catalog.more || []), ...charted]) {
    if (names.length < ARTISTS && !names.some(n => norm(n) === norm(a))) names.push(a);
  }
  // --add keeps the songs already saved and only fetches roster artists that have none
  const old = addOnly ? JSON.parse(await readFile(fileFor(genre.key), 'utf8')) : null;
  const has = a => old?.songs.some(s => [s.artist, s.artist.split(/,| & | x | and /i)[0]].some(n => norm(n) === norm(a)));
  const songs = old ? [...old.songs] : [], empty = [];
  for (const [i, artist] of names.entries()) {
    if (has(artist)) continue;
    try {
      const list = await topSongs(artist, genre.itunes.years);
      songs.push(...list.map(s => ({ id: norm(s.artist) + '|' + norm(s.title), ...s, charted: charted.includes(artist) || undefined })));
      console.log(`${genre.key} ${i + 1}/${names.length} ${artist}: ${list.length}`);
      if (!list.length) empty.push(artist);
    } catch (e) {
      console.warn(`${artist}: ${e.message}`);
      empty.push(artist);
    }
    await sleep(PAUSE);
  }
  // a full rebuild keeps the tempo and key already measured for songs that are still here
  if (!old) {
    const prev = await readFile(fileFor(genre.key), 'utf8').then(JSON.parse, () => null);
    const kept = new Map((prev?.songs || []).filter(s => s.measured).map(s => [s.cleanId, s]));
    for (const s of songs) {
      const m = kept.get(s.cleanId);
      if (m) Object.assign(s, { bpm: m.bpm, key: m.key, measured: m.measured });
    }
  }
  if (empty.length) console.warn(`${genre.key}: NO SONGS for ${empty.join(', ')} (rerun with --add to try them again)`);
  return { genre: genre.key, built: new Date().toISOString().slice(0, 10), artists: names, songs: [...new Map(songs.map(s => [s.id, s])).values()] };
}

// Renew the preview links of an existing catalog by track id; songs Apple no longer has drop out.
async function refresh(genre) {
  const cat = JSON.parse(await readFile(fileFor(genre.key), 'utf8'));
  const ids = cat.songs.map(s => s.cleanId).filter(Boolean);
  const urls = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const res = await get(`https://itunes.apple.com/lookup?country=US&id=${ids.slice(i, i + 150).join(',')}`);
    for (const r of res.results || []) if (r.previewUrl) urls.set(r.trackId, r.previewUrl);
    console.log(`${genre.key} links ${Math.min(i + 150, ids.length)}/${ids.length}`);
    await sleep(PAUSE);
  }
  for (const s of cat.songs) s.cleanUrl = urls.get(s.cleanId);
  cat.songs = cat.songs.filter(s => s.cleanUrl);
  cat.refreshed = new Date().toISOString().slice(0, 10);
  return cat;
}

await mkdir(new URL('../data/catalog/', import.meta.url), { recursive: true });
for (const genre of genres) {
  const cat = await (refreshOnly ? refresh(genre) : build(genre));
  if (cat.songs.length < 40) { console.warn(`${genre.key}: only ${cat.songs.length} songs, not written`); continue; }
  await writeFile(fileFor(genre.key), JSON.stringify(cat, null, 1) + '\n');
  console.log(`${genre.key}: wrote ${cat.songs.length} songs from ${cat.artists.length} artists`);
}
