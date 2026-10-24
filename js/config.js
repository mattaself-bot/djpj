// Site-wide settings. Monetization is wired in but switched off until the site has traffic.
export const CONFIG = {
  appName: 'DJPJ', // sent to Audius as app_name (their API asks every app to identify itself)

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
      // test-mode key for now; swap in pk_live_... once the Stripe account is verified
      publishableKey: 'pk_test_51UU7iiCpfW6rT9nFaZJXbJVjDFeGauxdoyhQ2Gq01NDuyUnx9seBbYqbIjTXcimVb8bNUns0wezvfwIUjRiNwiBQ00ogF5501O',
      workerUrl: 'https://tips.djpj.app', // the Cloudflare Worker in worker/
    },
  },

  analytics: {
    goatcounter: '',         // e.g. 'djpj' for https://djpj.goatcounter.com (free, no cookies)
  },
};
