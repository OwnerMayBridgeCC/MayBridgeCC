# MayBridge Stripe Connect sample

This sample is a small Express server for MayBridge Care Collective. It demonstrates Accounts V2 onboarding, direct charges with an application fee, connected-account products, a hosted storefront, subscriptions, a billing portal, V2 thin requirement events, and standard Billing webhooks.

## Run it

1. Install Node 20 or newer.
2. Copy `.env.example` to `.env`.
3. Fill in `STRIPE_SECRET_KEY`. Start with a test-mode key; this app never commits secrets.
4. Run `npm install`, then `npm start`.
5. Open http://localhost:4242.
6. For local V2 events, run the printed `stripe listen --thin-events ...` command and copy its `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.
7. Create a recurring Price on the platform account and set `PLATFORM_SUBSCRIPTION_PRICE_ID` before using the subscription route.

The server uses one `Stripe` Client instance for every request. The SDK chooses the API version automatically, so no version is hardcoded. Products and direct Checkout Sessions pass `stripeAccount`, which sets the `Stripe-Account` header.

## Production checklist

Set `BASE_URL` to an HTTPS origin, persist your own user-to-account mapping where the TODO appears, authenticate every dashboard route, and verify webhook signatures. Finish all platform account requirements in Stripe Dashboard before accepting live payments. Use a provider slug or internal ID in storefront URLs instead of exposing `acct_` IDs.
