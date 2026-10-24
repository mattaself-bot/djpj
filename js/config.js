// Site-wide settings. Monetization is wired in but switched off until the site has traffic.
export const CONFIG = {
  appName: 'DJPJ', // sent to Audius as app_name (their API asks every app to identify itself)

  ads: {
    enabled: false,          // set to true once Google AdSense approves the site
    adsenseClient: '',       // e.g. 'ca-pub-1234567890123456'
    slots: { home: '', player: '' }, // AdSense ad-unit slot IDs for the two ad spots
  },

  // "Tip the DJ" button. On phones this opens the Venmo app on a payment to @mattaself.
  tipUrl: 'https://venmo.com/mattaself?txn=pay&note=Tip%20for%20DJPJ%20%F0%9F%8E%A7',

  analytics: {
    goatcounter: '',         // e.g. 'djpj' for https://djpj.goatcounter.com (free, no cookies)
  },
};
