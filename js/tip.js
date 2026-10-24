// "Tip the DJ" pop-up: Apple Pay / Google Pay through Stripe (when configured) and Venmo.
// Everything happens in a dialog over the page, so the set keeps playing.
import { CONFIG } from './config.js';

const { tips } = CONFIG;
const $ = s => document.querySelector(s);
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
const NOTE = 'Tip for DJPJ 🎧';

let amount = tips.amounts[1] ?? tips.amounts[0] ?? 5;
let wallet = null; // { stripe, elements } once Stripe has loaded
const stripeReady = () => !!(tips.stripe?.publishableKey && tips.stripe?.workerUrl);

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

const say = msg => { $('#tip-msg').textContent = msg; };

export function initTips() {
  if (!tips.venmo && !stripeReady()) return;
  document.querySelectorAll('[data-tip]').forEach(b => {
    b.hidden = false;
    b.addEventListener('click', openTip);
  });
  if (!tips.venmo) $('.tip-venmo').hidden = true;

  const box = $('#tip-amounts');
  box.innerHTML = tips.amounts.map(a => `<button type="button" role="radio" data-amount="${a}">$${a}</button>`).join('');
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-amount]');
    if (!b) return;
    $('#tip-custom').value = '';
    setAmount(+b.dataset.amount);
  });
  $('#tip-custom').addEventListener('input', e => {
    const v = Math.round(+e.target.value);
    if (v >= 1 && v <= 500) setAmount(v);
  });

  // back from a wallet that needed a redirect
  if (new URLSearchParams(location.search).get('tip') === 'thanks') {
    history.replaceState(null, '', location.pathname);
    openTip();
    thanks();
  }
}

function openTip() {
  say('');
  $('#tip-dialog').showModal();
  update();
  if (stripeReady()) mountWallet().catch(e => console.warn('[tips] wallet unavailable', e));
}

function setAmount(a) {
  amount = a;
  update();
}

function update() {
  document.querySelectorAll('#tip-amounts [data-amount]').forEach(b => {
    b.setAttribute('aria-checked', String(+b.dataset.amount === amount && !$('#tip-custom').value));
  });
  if (tips.venmo) {
    const url = `https://venmo.com/${encodeURIComponent(tips.venmo)}?txn=pay&amount=${amount}&note=${encodeURIComponent(NOTE)}`;
    const link = $('#venmo-link');
    link.href = url;
    link.textContent = `Tip $${amount} with Venmo`;
    drawQR(url);
  }
  wallet?.elements.update({ amount: amount * 100 });
}

async function drawQR(url) {
  try {
    await loadScript(QR_LIB);
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('#venmo-qr').innerHTML = qr.createSvgTag(4, 0);
  } catch {
    $('.venmo-qr').hidden = true;
  }
}

async function mountWallet() {
  if (wallet) return;
  await loadScript('https://js.stripe.com/v3/');
  const stripe = window.Stripe(tips.stripe.publishableKey);
  const elements = stripe.elements({ mode: 'payment', amount: amount * 100, currency: 'usd', appearance: { theme: 'night' } });
  // wallets only: no pay-later or other express options for a tip
  const button = elements.create('expressCheckout', {
    paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
    buttonType: { applePay: 'donate', googlePay: 'donate' },
    buttonHeight: 48,
  });
  // only show the wallet area when this device actually has Apple Pay or Google Pay
  button.on('ready', ({ availablePaymentMethods }) => { $('#tip-wallet').hidden = !availablePaymentMethods; });
  button.on('confirm', () => confirmTip(stripe, elements));
  button.mount('#express-checkout');
  wallet = { stripe, elements };
}

async function confirmTip(stripe, elements) {
  say('Processing…');
  const { error: invalid } = await elements.submit();
  if (invalid) return say(invalid.message);
  try {
    // the worker creates the payment with the secret key, which never touches the browser
    const res = await fetch(tips.stripe.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount * 100 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment setup failed');
    const { error } = await stripe.confirmPayment({
      elements,
      clientSecret: data.clientSecret,
      confirmParams: { return_url: `${location.origin}${location.pathname}?tip=thanks` },
      redirect: 'if_required',
    });
    if (error) say(error.message);
    else thanks();
  } catch (e) {
    say(e.message);
  }
}

function thanks() {
  say('🙏 Thank you! DJPJ owes you a shout-out.');
  window.dispatchEvent(new CustomEvent('djpj:tipped'));
}
