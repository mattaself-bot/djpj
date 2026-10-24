# Turning on Apple Pay / Google Pay tips

The tip pop-up already works with Venmo. These steps add Apple Pay and Google Pay through Stripe.
Stripe has no monthly fee and takes about 2.9% + 30¢ per tip. Setup takes about 15 minutes.

## 1. Stripe account
1. Sign up at https://dashboard.stripe.com/register and finish account activation (business details, bank account for payouts).
2. **Settings → Payment methods**: make sure Apple Pay and Google Pay are on (they are by default).
3. **Settings → Payment method domains → Add domain**: add `djpj.app` (and `www.djpj.app`).
   If Stripe offers an Apple Pay verification file to download, send it over and it gets added at
   `/.well-known/apple-developer-merchantid-domain-association`.
4. **Developers → API keys**: note the **Publishable key** (`pk_live_…`) and the **Secret key** (`sk_live_…`).
   Keep the secret key private: only paste it into Cloudflare (step 2) and never into the website code.

## 2. Deploy the worker (free on Cloudflare)
From this `worker` folder:

```bash
npx wrangler login
```
```bash
npx wrangler deploy
```
```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

The last command asks you to paste the `sk_live_…` key. `deploy` prints the worker's address,
e.g. `https://djpj-tips.<subdomain>.workers.dev`.

(Or do it in the dashboard: Workers & Pages → Create → Worker, paste `tip-worker.js`, then
Settings → Variables and Secrets → add a **Secret** named `STRIPE_SECRET_KEY`.)

## 3. Switch it on
In `js/config.js`, fill in `tips.stripe.publishableKey` (the `pk_live_…` key) and `tips.stripe.workerUrl`,
then push. The Apple Pay / Google Pay button appears in the pop-up on devices that support it.
Everyone else still sees Venmo.

To try it without real money first, use the `pk_test_…` / `sk_test_…` keys and Stripe's test cards.
