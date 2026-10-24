// Site-wide settings. Monetization is wired in but switched off until the site has traffic.
export const CONFIG = {
  appName: 'DJPJ', // sent to Audius as app_name (their API asks every app to identify itself)

  ads: {
    enabled: false,          // set to true once Google AdSense approves the site
    adsenseClient: '',       // e.g. 'ca-pub-1234567890123456'
    slots: { home: '', player: '' }, // AdSense ad-unit slot IDs for the two ad spots
  },

  tipUrl: '',                // e.g. 'https://ko-fi.com/djpj' (shows a "Tip the DJ" button when set)

  analytics: {
    goatcounter: '',         // e.g. 'djpj' for https://djpj.goatcounter.com (free, no cookies)
  },
};
