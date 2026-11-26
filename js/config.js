// Site-wide settings. Monetization is wired in but switched off until the site has traffic.
export const CONFIG = {
  ads: {
    enabled: false,          // set to true once Google AdSense approves the site
    adsenseClient: '',       // e.g. 'ca-pub-1234567890123456'
    slots: { home: '', player: '' }, // AdSense ad-unit slot IDs for the two ad spots
  },

  // "Tip the DJ" pop-up.
  tips: {
    amounts: [2, 5, 10, 20],   // quick-pick buttons, in dollars
    venmo: 'djpjapp',          // Venmo Business username, without the @
    stripe: {                  // Apple Pay / Google Pay; stays hidden until both are filled in
      // live key (the sandbox key was pk_test_51UU7ii...5501O)
      publishableKey: 'pk_live_51UU7iiCpfW6rT9nFnFiCk99oFdXKV0MaOZB0NSoSmBWhvt1MU0nAgqV65YG0OYYT2tqpbcURjwcYcrjnRtsEzrVC00QOcQDWqc',
      workerUrl: 'https://tips.djpj.app', // the Cloudflare Worker in worker/
    },
  },

  // Apple Music links. Once Apple's Performance Partners program approves the site, put the tracking
  // part of its links here, e.g. 'at=1000lXXXX&ct=djpj'. It is added to every Apple Music link, and a
  // commission notice appears in the footer (Apple requires one).
  apple: {
    linkParams: '',
  },

  analytics: {
    goatcounter: '',         // e.g. 'djpj' for https://djpj.goatcounter.com (free, no cookies)
  },
};
