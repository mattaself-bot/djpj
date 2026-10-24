// Cloudflare Worker: creates a Stripe PaymentIntent for a DJPJ tip, and receives Stripe's webhook at /webhook.
// The Stripe key lives only here, as the STRIPE_SECRET_KEY secret (a restricted rk_ key); the website never sees it.

const ALLOWED_ORIGINS = ['https://djpj.app', 'https://www.djpj.app', 'http://localhost:5173'];
const MIN_CENTS = 100;    // $1
const MAX_CENTS = 50000;  // $500
const STRIPE_VERSION = '2026-09-30.endive'; // pinned so Stripe upgrades never change this worker's behavior
const WEBHOOK_TOLERANCE_S = 300;            // reject signed events older than 5 minutes (replays)

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/webhook') return webhook(request, env);

    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!allowed) return json({ error: 'Origin not allowed' }, 403);
    if (!env.STRIPE_SECRET_KEY) return json({ error: 'Tips are not set up yet' }, 503);

    let amount;
    try {
      ({ amount } = await request.json());
    } catch {
      return json({ error: 'Bad request' }, 400);
    }
    if (!Number.isInteger(amount) || amount < MIN_CENTS || amount > MAX_CENTS) {
      return json({ error: 'Tips must be between $1 and $500' }, 400);
    }

    // payment methods come from the Stripe dashboard (dynamic payment methods), so none are listed here
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_VERSION,
      },
      body: new URLSearchParams({
        amount: String(amount),
        currency: 'usd',
        description: 'DJPJ tip',
        'metadata[source]': 'djpj.app',
      }),
    });
    const intent = await res.json();
    if (!res.ok) return json({ error: intent.error?.message || 'Stripe error' }, 502);
    return json({ clientSecret: intent.client_secret });
  },
};

// Stripe -> worker. Every event's signature is checked before anything in it is trusted.
// Tips are recorded in the worker's logs (Cloudflare -> djpj-tips -> Logs, or `npx wrangler tail`).
async function webhook(request, env) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook not set up', { status: 503 });

  const payload = await request.text(); // the raw body: parsing it first would break the signature
  if (!(await verifySignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Bad signature', { status: 400 });
  }

  const event = JSON.parse(payload);
  const pi = event.data?.object;
  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log(`[tip] received $${(pi.amount_received / 100).toFixed(2)} ${pi.currency} (${pi.id}, ${event.livemode ? 'live' : 'test'})`);
      break;
    case 'payment_intent.payment_failed':
      console.log(`[tip] failed ${pi.id}: ${pi.last_payment_error?.message || 'unknown reason'}`);
      break;
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
}

// Stripe-Signature is "t=<unix time>,v1=<hex HMAC-SHA256 of `${t}.${payload}`>[,v1=...]".
// See https://docs.stripe.com/webhooks#verify-manually
export async function verifySignature(payload, header, secret, now = Date.now() / 1000) {
  if (!header) return false;
  const parts = header.split(',').map(p => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !signatures.length || Math.abs(now - Number(t)) > WEBHOOK_TOLERANCE_S) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  const expected = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  return signatures.some(sig => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
