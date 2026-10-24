// Cloudflare Worker: creates a Stripe PaymentIntent for a DJPJ tip.
// The Stripe secret key lives only here, as the STRIPE_SECRET_KEY secret; the website never sees it.

const ALLOWED_ORIGINS = ['https://djpj.app', 'https://www.djpj.app', 'http://localhost:5173'];
const MIN_CENTS = 100;    // $1
const MAX_CENTS = 50000;  // $500

export default {
  async fetch(request, env) {
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

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        amount: String(amount),
        currency: 'usd',
        'automatic_payment_methods[enabled]': 'true',
        description: 'DJPJ tip',
        'metadata[source]': 'djpj.app',
      }),
    });
    const intent = await res.json();
    if (!res.ok) return json({ error: intent.error?.message || 'Stripe error' }, 502);
    return json({ clientSecret: intent.client_secret });
  },
};
