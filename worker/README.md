# Apple Pay / Google Pay tips

**Status:** live, taking real tips. The worker runs at `https://tips.djpj.app` with the `sk_live_…` secret,
`js/config.js` holds the `pk_live_…` key, and `djpj.app` is registered under Settings → Payment method domains
in live mode with Apple Pay and Google Pay enabled.

Still to do in live mode:
1. Swap the `sk_live_…` secret for a restricted key (see [Restricted key](#restricted-key) below): set
   `STRIPE_SECRET_KEY` in Cloudflare (Workers & Pages → djpj-tips → Settings → Variables and Secrets) to the `rk_live_…` key.
2. Add the webhook (see [Webhook](#webhook) below) and set `STRIPE_WEBHOOK_SECRET` to its live `whsec_…` secret.

To test without real money again: register `djpj.app` in the sandbox (already done), rotate `STRIPE_SECRET_KEY`
in Cloudflare to an `rk_test_…` key, and put the matching `pk_test_…` key in `js/config.js`.
The two keys must always come from the same mode.

Klarna and other pay-later options are hidden in the tip button (`tip.js`). Stripe now manages payment types
from its dashboard, not from code. The worker pins Stripe API version `2026-09-30.endive` (`STRIPE_VERSION` in
`tip-worker.js`); bump it deliberately after reading Stripe's changelog.

## Restricted key
The worker only creates payments, so give it a restricted key that can do nothing else; a leaked one can't
issue refunds, read customers or move payouts. **Developers → API keys → Create restricted key**:
name it `djpj-tips worker`, set **PaymentIntents** to **Write**, leave everything else at **None**, and create it.
Paste the `rk_…` key only into Cloudflare (the `STRIPE_SECRET_KEY` secret), never into code or chat.
Make one in test mode too, for testing without real money.
Once the restricted key works, roll the old secret key under **Developers → API keys**.

## Webhook
Stripe tells the worker about every tip at `https://tips.djpj.app/webhook`; the worker checks Stripe's
signature on each event and logs it (Cloudflare → djpj-tips → Logs, or `npx wrangler tail` from this folder).
1. **Developers → Webhooks → Add destination**: endpoint URL `https://tips.djpj.app/webhook`,
   events `payment_intent.succeeded` and `payment_intent.payment_failed`.
2. Copy the endpoint's **Signing secret** (`whsec_…`), then from this folder:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
3. Use **Send test event** on the endpoint and look for a `[tip]` line in the worker's logs.

Test mode and live mode have separate webhook endpoints and signing secrets.

The original setup steps are below for reference.

# Turning on Apple Pay / Google Pay tips

The tip pop-up already works with Venmo. These steps add Apple Pay and Google Pay through Stripe.
Stripe has no monthly fee and takes about 2.9% + 30¢ per tip. Setup takes about 15 minutes.

## 1. Stripe account
1. Sign up at https://dashboard.stripe.com/register and finish account activation (business details, bank account for payouts).
2. **Settings → Payment methods**: make sure Apple Pay and Google Pay are on (they are by default).
3. **Settings → Payment method domains → Add domain**: add `djpj.app` (and `www.djpj.app`).
   If Stripe offers an Apple Pay verification file to download, send it over and it gets added at
   `/.well-known/apple-developer-merchantid-domain-association`.
4. **Developers → API keys**: note the **Publishable key** (`pk_live_…`) and create a restricted key (`rk_live_…`,
   see [Restricted key](#restricted-key)). Keep the restricted key private: only paste it into Cloudflare (step 2)
   and never into the website code.

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

The last command asks you to paste the `rk_live_…` key. `deploy` prints the worker's address,
e.g. `https://djpj-tips.<subdomain>.workers.dev`.

(Or do it in the dashboard: Workers & Pages → Create → Worker, paste `tip-worker.js`, then
Settings → Variables and Secrets → add a **Secret** named `STRIPE_SECRET_KEY`.)

## 3. Switch it on
In `js/config.js`, fill in `tips.stripe.publishableKey` (the `pk_live_…` key) and `tips.stripe.workerUrl`,
then push. The Apple Pay / Google Pay button appears in the pop-up on devices that support it.
Everyone else still sees Venmo.

To try it without real money first, use the `pk_test_…` / `rk_test_…` keys and Stripe's test cards.
