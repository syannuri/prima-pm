# Billing Go-Live Runbook (Lemon Squeezy)

Self-serve PRO / ENTERPRISE billing. The **code is already merged and deployed** on the VPS
(`prismatix.tech`) but **dormant**: with no Lemon Squeezy env configured, `billingEnabled()`
returns false, the webhook answers `503`, and the in-app Billing page shows a graceful
"billing not configured" banner. Going live is purely configuration + LS-dashboard setup — no
code change.

## How it works (already built)

- **Checkout** — a tenant ADMIN clicks *Upgrade* → `POST /api/v1/billing/checkout` mints a hosted
  LS checkout URL, tagged with `custom_data.tenant_id` so the webhook can map the sub back to the tenant.
- **Webhook** — `POST /webhooks/lemonsqueezy` (mounted BEFORE `express.json`, raw body) verifies the
  `X-Signature` HMAC-SHA256 (keyed by the webhook secret), then flips `Tenant.plan` + subscription
  fields and records a `BillingEvent` + audit entry. Idempotent — safe on duplicate/retried deliveries.
- **Portal** — `GET /api/v1/billing/portal` returns the LS customer-portal URL (update card / cancel).
- **Plan effect** — quotas come from `PLAN_LIMITS` (server `plans.ts`): PRO = 50 projects / 50 members
  / 20 GB; ENTERPRISE = unlimited. FREE is the default.

## Required environment (server `.env` on the VPS)

`billingEnabled()` needs at minimum `LEMONSQUEEZY_API_KEY` **and** `LEMONSQUEEZY_WEBHOOK_SECRET`.
For checkout to work you also need the store id + both variant ids:

```
LEMONSQUEEZY_API_KEY=eyJ0eXAiOiJKV1Qi...        # store-scoped API key (Bearer)
LEMONSQUEEZY_WEBHOOK_SECRET=...                  # the webhook signing secret you set in LS
LEMONSQUEEZY_STORE_ID=12345                      # numeric store id
LEMONSQUEEZY_VARIANT_ID_PRO=67890                # variant id sold as the PRO plan
LEMONSQUEEZY_VARIANT_ID_ENTERPRISE=67891         # variant id sold as the ENTERPRISE plan
```

## One-time setup in the Lemon Squeezy dashboard

> Do this in **Test mode** first (toggle top-right). Test-mode keys/variants are separate from live.

1. **Store** — create/confirm the store. Note the numeric **Store ID** (Settings → Stores).
2. **Products & variants** — create two products (or one product with two variants):
   - *PRO* → note its **Variant ID** → `LEMONSQUEEZY_VARIANT_ID_PRO`
   - *ENTERPRISE* → note its **Variant ID** → `LEMONSQUEEZY_VARIANT_ID_ENTERPRISE`
   (Variant id is in the URL / API when you open the variant; the perks in the app expect a
   recurring subscription product.)
3. **API key** — Settings → API → create a key → `LEMONSQUEEZY_API_KEY`.
4. **Webhook** — Settings → Webhooks → add:
   - **URL:** `https://prismatix.tech/webhooks/lemonsqueezy`
   - **Signing secret:** any strong string → put the SAME value in `LEMONSQUEEZY_WEBHOOK_SECRET`.
   - **Events:** subscribe to the subscription lifecycle set the server acts on:
     `subscription_created`, `subscription_updated`, `subscription_resumed`, `subscription_unpaused`,
     `subscription_paused`, `subscription_cancelled`, `subscription_expired`.
     (Other events are acknowledged with 200 and ignored.)

## Apply on the VPS

```bash
# on the VPS as root
cd /opt/prismatix
sudo -e server/.env          # add the 5 LEMONSQUEEZY_* vars
sudo systemctl restart prima-pm
# verify the webhook is now "configured" (should be 401 invalid-signature, NOT 503):
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://prismatix.tech/webhooks/lemonsqueezy -d '{}'
```

- `503` → env still not loaded (billing disabled). `401` → billing enabled, signature rejected (expected). Good.
- No redeploy/rebuild needed — env is read live (`lsConfig()`/`billingEnabled()` read `process.env`
  on each call), but a restart is required to load the new `.env` into the process.

## End-to-end verification (test mode)

1. Log in as a tenant ADMIN → **Billing** page shows the plans (banner gone).
2. Click **Upgrade to PRO** → redirected to the LS test checkout → pay with a
   [test card](https://docs.lemonsqueezy.com/help/getting-started/test-mode) (`4242 4242 4242 4242`).
3. Back in the app the tenant should now show **PRO** (webhook flipped it). Confirm a `BillingEvent`
   row + audit entry exist and quotas reflect PRO.
4. **Manage subscription** → opens the LS portal. Cancel → tenant keeps access until `endsAt`, then an
   `expired` event downgrades it to FREE.

## Flip to live

Repeat the dashboard setup in **Live mode** (new store/variant/API-key/webhook values), swap the
`.env` values for the live ones, restart. Nothing else changes.
