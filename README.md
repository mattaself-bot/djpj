# DJPJ

A free auto-DJ website. Pick a genre or search for a song, and DJPJ builds a never-ending, beat-matched
DJ set that plays through your computer or phone speakers. Everything runs in the browser: no server,
no accounts, no monthly bills.

## Run it locally

Any static file server works. With Python (already installed):

```bash
python -m http.server 5173
```

Then open http://localhost:5173. Opening `index.html` directly from disk won't work, because browsers
block ES modules on `file://`.

## Music sources (all free, no API keys)

| Source | What you get | Used for |
|---|---|---|
| [Audius](https://audius.co) | Full-length tracks from independent artists, with BPM and key data | "Full-length tracks" mode |
| [iTunes Search API](https://performance-partners.apple.com/search-api) | The real commercial catalog, but only 30-second previews | "Real hits" mode and song search |
| [Internet Archive · Great 78 Project](https://archive.org/details/georgeblood) | Full-length 78rpm records old enough to be US public domain | "Roaring '20s" genre and the "public-domain classics" option |

Notes:
- **iTunes previews** are meant to promote the song. DJPJ links every one back to its Apple Music page.
  If the site makes money, keep those links prominent, and read Apple's terms before running ads next to previews.
- **Public domain cutoff:** US recordings become public domain 100 years after the end of their release year,
  so the cutoff moves forward every January (`PD_LAST_YEAR` in `js/genres.js`). The Archive's year field
  is usually right but not guaranteed.
- **Audius** artists upload to stream. Credit is shown on every track, with a link back to the artist.

## How the mixing works

The timing comes from real sets. Timestamped tracklists from 238 live DJ sets on YouTube (7,475 track changes)
set how long each genre's records play: about 78 seconds for rap and R&B, 96 for pop/open format, 113 for country,
145 for EDM and 210 for house (`MIX` in `js/genres.js`). The **Vibe** setting stretches that by about 25%
either way, and every record varies around it the way it does in a real set.

- `js/audio/prep.js`: downloads and decodes each track. `analyze.js` detects tempo, beat grid, loudness, the
  downbeat, 8-bar phrase lines and the hook (the loudest 4 bars). Full tracks mix in and out on phrase lines.
  30-second previews get a **DJ edit**: whole bars re-arranged (hook repeat, double hook, intro vamp, reprise,
  outro loop) so a clip plays about as long as that genre's records do live, with a different shape each time.
- `js/crate.js`: gathers candidates per genre and picks the next record. It favors matching tempos,
  harmonically compatible keys (`keys.js`, Camelot wheel) and a different artist from the last one.
- `js/dj.js`: runs two decks, preloads the next record, and schedules each transition on the audio clock.
  Between transitions he works the phrase lines: a flourish into the next section, and on some records a
  trick, rotated so no two sets come out the same:
  - **rewind**: spin back and run the record again from the top
  - **callback**: an earlier record's hook looped over the current beat
  - **tease**: a bar or two of the next record's hook before it comes in
- `js/audio/transitions.js`: bass-swap blend (16–32 bars for house and techno, shorter for quick-mix genres),
  filter sweep, loop & filter out, cut on the one, drop into the hook, loop roll, echo out, scratch cut,
  backspin, turntable brake, and riser + reverb wash. How a genre is mixed live (`family` in `MIX`) and the
  Vibe decide which ones he picks, and he doesn't repeat one of the last two.
- Air horns, sirens and impacts are saved for rare big moments (none on Smooth). Comments on those 238 sets
  praise transitions and mashups but complain about air horns and scratching for its own sake.
- `js/audio/fx.js`: the FX pad. Air horn, scratch, echo, reverb, filter sweep, beat roll, gate chop,
  drop boom, flanger, phaser, bass kill, riser, laser, siren, plus "backspin → next" and "brake → next".
  All sound effects are synthesized, so there are no samples to license.

Keyboard: Space pauses or resumes, N skips to the next track.

## Deploy to GitHub Pages (free)

1. Push this folder to a GitHub repo.
2. Repo → Settings → Pages → "Deploy from a branch" → `main` / root.
3. The site goes live at `https://<user>.github.io/<repo>/`. The empty `.nojekyll` file makes Pages serve the files as-is.

Live at **https://djpj.app**. The `CNAME` file tells Pages the domain, and Cloudflare DNS has four A records for
`djpj.app` (185.199.108–111.153) plus a `www` CNAME to `mattaself-bot.github.io`, all set to "DNS only".
Keep them DNS only: GitHub issues the HTTPS certificate itself, and `.app` domains require HTTPS.

## Monetization (off until you turn it on)

Everything lives in `js/config.js`:

- **Ads:** apply for [Google AdSense](https://adsense.google.com) once the site has its own domain and some traffic.
  Then set `ads.enabled`, `adsenseClient` and the two slot IDs. Ad spots already sit in the crate and DJ effects sheets.
- **Tips:** the tip bucket (always in the top-right corner) opens a pop-up over the page, so the set keeps playing. It offers quick amounts, a Venmo
  button (opens the app on phones), and a Venmo QR code for people on computers. Change the handle in
  `tips.venmo`. Apple Pay / Google Pay through Stripe is built in. Follow [worker/README.md](worker/README.md)
  to switch it on: a Stripe account, a free Cloudflare Worker, then two values in `tips.stripe`.
- **Analytics:** set `analytics.goatcounter` to a free [GoatCounter](https://www.goatcounter.com) site code.
  It counts visits plus which genres people start sets with. No cookies, so no consent banner is needed.

## Mobile notes

- Sound starts on the first tap (a browser rule). On iPhones, DJPJ plays a silent media track alongside
  the mix so the ringer switch doesn't mute it.
- While a set plays, DJPJ asks the phone to keep the screen awake. Locking the phone may pause the mix,
  depending on the browser.
