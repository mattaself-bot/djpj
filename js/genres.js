// How each genre maps onto the three music sources.
//   audius.genres    Audius genre names, pulled from their trending charts
//   audius.searches  extra keyword searches (results limited to audius.genreFilter when given)
//   itunes.artists   seed artists for "Real hits" mode; itunes.years limits release years
//   archive          Internet Archive subject clause for public-domain 78s (null = nothing fits)

// US sound recordings become public domain 100 years after the end of their release year
// (Music Modernization Act), so in 2026 everything released through 1925 is free to use.
export const PD_LAST_YEAR = new Date().getFullYear() - 101;

export const GENRES = [
  {
    key: 'modern-rap', label: 'Modern Rap', sub: '2000s+', icon: '🎤', hue: 275,
    audius: { genres: ['Hip-Hop/Rap', 'Trap'], searches: [] },
    itunes: {
      years: [2000, 9999],
      artists: ['Kendrick Lamar', 'Drake', 'J. Cole', 'Travis Scott', 'Eminem', 'Kanye West', 'Lil Wayne', 'Post Malone',
        '50 Cent', 'Future', 'Megan Thee Stallion', 'Doja Cat', 'JAY-Z', 'Nicki Minaj', 'Outkast', 'Ludacris', 'T.I.',
        'Lil Baby', '21 Savage', 'Missy Elliott'],
    },
    archive: null,
  },
  {
    key: 'old-school-rap', label: 'Old School Rap', sub: 'pre-1999', icon: '📼', hue: 28,
    audius: {
      genres: [], genreFilter: ['Hip-Hop/Rap'],
      searches: ['boom bap', 'old school hip hop', '90s hip hop', 'golden era hip hop', 'east coast rap', 'old school'],
    },
    itunes: {
      years: [1979, 1998],
      artists: ['Run-DMC', 'LL Cool J', 'Public Enemy', 'A Tribe Called Quest', 'N.W.A', 'Dr. Dre', 'Snoop Dogg',
        'The Notorious B.I.G.', '2Pac', 'Salt-N-Pepa', 'Beastie Boys', 'De La Soul', 'Wu-Tang Clan', 'The Sugarhill Gang',
        'Naughty By Nature', 'Eric B. & Rakim', 'Ice Cube', 'Nas', 'Coolio', 'House of Pain'],
    },
    archive: null,
  },
  {
    key: 'country', label: 'Country', sub: 'Boots & twang', icon: '🤠', hue: 38,
    audius: { genres: ['Country'], searches: ['americana', 'country'], genreFilter: ['Country', 'Folk', 'Acoustic'] },
    itunes: {
      years: [0, 9999],
      artists: ['Luke Combs', 'Morgan Wallen', 'Chris Stapleton', 'Garth Brooks', 'George Strait', 'Carrie Underwood',
        'Kenny Chesney', 'Zach Bryan', 'Dolly Parton', 'Johnny Cash', 'Shania Twain', 'Alan Jackson', 'Brooks & Dunn',
        'Tim McGraw', 'Toby Keith', 'Luke Bryan', 'Blake Shelton', 'Miranda Lambert', 'Keith Urban', 'Jason Aldean'],
    },
    archive: 'subject:country OR subject:hillbilly OR subject:fiddle OR subject:"old time"',
  },
  {
    key: 'electronic', label: 'Electronic', sub: 'EDM · techno · bass', icon: '🎛️', hue: 190,
    audius: { genres: ['Electronic', 'Techno', 'Dubstep', 'Drum & Bass', 'Trance', 'Future Bass', 'Electro', 'Hardstyle'] },
    itunes: {
      years: [0, 9999],
      artists: ['Daft Punk', 'Avicii', 'Calvin Harris', 'deadmau5', 'Skrillex', 'Kygo', 'Zedd', 'Swedish House Mafia',
        'Martin Garrix', 'Marshmello', 'The Chemical Brothers', 'Fatboy Slim', 'The Prodigy', 'Tiësto', 'ILLENIUM', 'ODESZA',
        'Flume', 'Fred again..', 'Kaskade', 'Porter Robinson'],
    },
    archive: null,
  },
  {
    key: 'house', label: 'House / Dance', sub: 'Four on the floor', icon: '🪩', hue: 318,
    audius: { genres: ['House', 'Deep House', 'Tech House', 'Progressive House', 'Future House', 'Disco', 'Tropical House'] },
    itunes: {
      years: [0, 9999],
      artists: ['FISHER', 'Disclosure', 'Duke Dumont', 'Purple Disco Machine', 'John Summit', 'Dom Dolla', 'Frankie Knuckles',
        'David Guetta', 'Robin S', 'Chris Lake', 'MK', 'Peggy Gou', 'Meduza', 'Joel Corry', 'Armand Van Helden', 'Stardust',
        'Robin Schulz', 'Black Coffee', 'Diplo', 'Martin Solveig'],
    },
    archive: null,
  },
  {
    key: 'classic-rock', label: 'Classic Rock', sub: "'60s – '80s", icon: '🎸', hue: 2,
    audius: {
      genres: ['Rock'], genreFilter: ['Rock', 'Alternative', 'Blues', 'Metal', 'Punk'],
      searches: ['classic rock', '70s rock', '80s rock', 'blues rock', 'southern rock', 'arena rock'],
    },
    itunes: {
      years: [1963, 1992],
      artists: ['Rick Springfield', 'Journey', 'Boston', 'Foreigner', 'Led Zeppelin', 'The Rolling Stones', 'AC/DC', 'Queen',
        'Lynyrd Skynyrd', 'Tom Petty and the Heartbreakers', 'Eagles', 'Bon Jovi', 'Van Halen', 'Def Leppard', 'Fleetwood Mac',
        'REO Speedwagon', 'The Who', 'Aerosmith', 'Bruce Springsteen', 'Creedence Clearwater Revival', 'Pat Benatar', 'Heart',
        'ZZ Top', 'KISS'],
    },
    archive: null,
  },
  {
    key: 'pop', label: 'Pop', sub: 'Chart toppers', icon: '⭐', hue: 210,
    audius: { genres: ['Pop'] },
    itunes: {
      years: [0, 9999],
      artists: ['Taylor Swift', 'Dua Lipa', 'The Weeknd', 'Ariana Grande', 'Harry Styles', 'Bruno Mars', 'Lady Gaga', 'Katy Perry',
        'Justin Timberlake', 'Sabrina Carpenter', 'Olivia Rodrigo', 'Michael Jackson', 'Madonna', 'Britney Spears', 'Ed Sheeran',
        'Rihanna', 'Billie Eilish', 'Miley Cyrus', 'Whitney Houston', 'Mariah Carey'],
    },
    archive: 'subject:"fox trot" OR subject:popular',
  },
  {
    key: 'rnb', label: 'R&B / Soul', sub: 'Grooves & funk', icon: '🎷', hue: 345,
    audius: { genres: ['R&B/Soul', 'Funk'] },
    itunes: {
      years: [0, 9999],
      artists: ['Usher', 'Beyoncé', 'Alicia Keys', 'SZA', 'Marvin Gaye', 'Stevie Wonder', 'Aretha Franklin', 'Boyz II Men',
        'Frank Ocean', 'Anderson .Paak', 'Earth, Wind & Fire', 'Prince', 'Janet Jackson', 'Mary J. Blige', 'Luther Vandross',
        'TLC', "Destiny's Child", 'Al Green', 'Chris Brown', 'H.E.R.'],
    },
    archive: 'subject:blues OR subject:jazz',
  },
  {
    key: 'latin', label: 'Latin / Reggae', sub: 'Reggaeton to roots', icon: '🌴', hue: 140,
    audius: { genres: ['Latin', 'Reggae', 'Dancehall', 'Moombahton'] },
    itunes: {
      years: [0, 9999],
      artists: ['Bad Bunny', 'J Balvin', 'Daddy Yankee', 'Shakira', 'KAROL G', 'Bob Marley & The Wailers', 'Sean Paul', 'Shaggy',
        'Marc Anthony', 'Ozuna', 'Pitbull', 'Ricky Martin', 'Enrique Iglesias', 'Luis Fonsi', 'Peso Pluma', 'Rauw Alejandro',
        'UB40', 'Toots & The Maytals', 'Damian Marley', 'Becky G'],
    },
    archive: 'subject:tango OR subject:rumba OR subject:mexican OR subject:habanera OR subject:latin',
  },
  {
    key: 'christian', label: 'Contemporary Christian', sub: 'Worship & CCM', icon: '🕊️', hue: 52,
    audius: { genres: ['Devotional'], searches: ['worship', 'christian', 'gospel'], genreFilter: ['Devotional'] },
    itunes: {
      years: [0, 9999],
      artists: ['Lauren Daigle', 'for KING & COUNTRY', 'Casting Crowns', 'MercyMe', 'Hillsong UNITED', 'Chris Tomlin', 'TobyMac',
        'Zach Williams', 'Elevation Worship', 'Phil Wickham', 'Crowder', 'Matthew West', 'Brandon Lake', 'Maverick City Music',
        'Jeremy Camp', 'Third Day', 'Newsboys', 'Kari Jobe', 'Danny Gokey', 'Cody Carnes'],
    },
    archive: 'subject:sacred OR subject:hymn OR subject:spiritual OR subject:gospel',
  },
  {
    key: 'roaring20s', label: "Roaring '20s", sub: 'Public-domain 78s', icon: '🎺', hue: 44,
    audius: null,
    archiveOnly: true, // in full-length mode this genre plays only from the Internet Archive
    itunes: {
      years: [1900, 1940],
      artists: ['Louis Armstrong', 'Bessie Smith', 'Duke Ellington', 'Jelly Roll Morton', 'Paul Whiteman', 'Al Jolson',
        'King Oliver', 'Fletcher Henderson', 'Ethel Waters', 'Sidney Bechet', 'Bix Beiderbecke', 'Ma Rainey'],
    },
    archive: 'subject:"fox trot" OR subject:jazz OR subject:blues OR subject:"one step" OR subject:dance',
  },
];

export const genreByKey = key => GENRES.find(g => g.key === key) || GENRES[0];

// Best-guess genre for a song found by search, so DJPJ knows what to play after it.
export function genreFor(genreName, year) {
  const g = (genreName || '').toLowerCase();
  if (/hip-hop|hip hop|rap|trap/.test(g)) return year && year < 1999 ? 'old-school-rap' : 'modern-rap';
  if (/christian|gospel|worship|devotional|inspirational/.test(g)) return 'christian';
  if (/country|americana|bluegrass|honky/.test(g)) return 'country';
  if (/house|disco|dance/.test(g)) return 'house';
  if (/electr|techno|trance|dubstep|drum|bass|edm|hardstyle|future/.test(g)) return 'electronic';
  if (/latin|reggae|reggaeton|salsa|urbano|dancehall|moombah/.test(g)) return 'latin';
  if (/r&b|soul|funk/.test(g)) return 'rnb';
  if (year && year <= 1935) return 'roaring20s';
  if (/blues/.test(g)) return 'rnb';
  if (/rock|metal|alternative|punk|grunge/.test(g)) return 'classic-rock';
  return 'pop';
}
