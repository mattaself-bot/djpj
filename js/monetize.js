// Ads, tips and privacy-friendly analytics, all driven by config.js. Everything is off by default.
import { CONFIG } from './config.js';

function loadScript(src, attrs = {}) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

export function initMonetization() {
  const { ads, tipUrl, analytics } = CONFIG;

  if (tipUrl) {
    const tip = document.getElementById('tip');
    tip.href = tipUrl;
    tip.hidden = false;
  }

  if (ads.enabled && ads.adsenseClient) {
    loadScript(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ads.adsenseClient}`, { crossorigin: 'anonymous' });
    document.querySelectorAll('.ad-slot').forEach(el => {
      const slot = ads.slots[el.dataset.slot];
      if (!slot) return;
      el.hidden = false;
      el.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="${ads.adsenseClient}"
        data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  if (analytics.goatcounter) {
    loadScript('https://gc.zgo.at/count.js', { 'data-goatcounter': `https://${analytics.goatcounter}.goatcounter.com/count` });
  }
}

// Count a usage event (e.g. which genres people start sets with).
export function trackEvent(name) {
  try {
    window.goatcounter?.count?.({ path: name, title: name, event: true });
  } catch { /* analytics is optional */ }
}
