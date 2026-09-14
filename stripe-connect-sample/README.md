# MayBridge embedded onboarding — test-only preview

The root page now mounts Stripe's account-onboarding component inside a MayBridge green/cream/gold page. It no longer navigates to a hosted Account Link. Required Stripe authentication popups and legal disclosures remain.

## Start a safe preview

1. Use a separate Render preview/test service pointing at this branch, root directory `stripe-connect-sample`.
2. Set `STRIPE_SECRET_KEY=sk_test_...` and `STRIPE_PUBLISHABLE_KEY=pk_test_...` from the SAME Stripe sandbox. Never paste keys into source code, chat, or a PR.
3. Set `BASE_URL` to the exact HTTPS origin of that Render test service. Do not leave it as example.com.
4. Build: `npm install`. Start: `npm start`. Node 20+.
5. Open the preview in a normal Safari/Chrome/Edge browser (not an in-app webview).
6. Create a test provider with test details. Open embedded onboarding, allow Stripe authentication popups if requested, and use Stripe's test verification values only.
7. Verify the form stays on the MayBridge page. Exit onboarding and refresh status: exiting alone never marks an account verified.

The server refuses all /api requests with live secret keys. Do not point this preview at the earlier live practice account. That live account is unchanged.

## Security and behavior

- Embedded endpoints also require a test publishable key; prefixes cannot prove that two keys belong to the same sandbox, so check this in Stripe.
- No client-supplied account ID is accepted for AccountSession access.
- Each newly created test account is bound to a random HttpOnly, SameSite=Strict cookie and server-side session. HTTPS adds Secure.
- Mutations require the configured origin and a custom request header.
- Sessions expire in one hour or at process restart. They are intentionally in-memory, capped at 100, and NOT production authentication. Do not load-balance this preview.
- Repeated creation within a session reuses the account and a Stripe idempotency key.
- AccountSession responses are not cached; client secrets are not persisted or logged. Only onboarding is enabled; no refund, dispute, or payout management is granted.
- Account creation retains the sample's full Stripe dashboard / Stripe loss-collector configuration, omitting the unnecessary preview-only customer configuration for this onboarding test.
- Legacy sample product/payment/webhook routes remain in source and are not production-ready. All /api routes are now test-key gated. The new root page does not expose the old storefront workflow.

## Validation

Run `npm test` for mocked route tests covering live/missing keys, cross-origin requests, session ownership, foreign account injection, repeat creation, cookie flags, expiry, and unknown requirements.
The mocked tests were also executed in a JavaScript isolate (with a URL-origin stub because that environment has no URL global). JavaScript syntax checks passed. Node/Express execution, real Stripe sandbox calls, and browser rendering have not been verified here.

## Before any production release

Implement authenticated provider logins, persistent user-to-account ownership, CSRF protection, rate limits, durable session storage, webhook state updates, and access control on ALL legacy routes. Review the actual charge type and connected-account configuration: the existing direct-charge sample does not implement the marketplace funds-flow settings chosen in the Dashboard. Selecting dashboard options does not rewrite the app.
Refund approval, dispute handling, reserves, payout rules, and embedded account management are NOT implemented by this change.
Stripe payment verification is not care-provider license verification or a background check.

References:
- https://docs.stripe.com/connect/get-started-connect-embedded-components?platform=web
- https://docs.stripe.com/connect/supported-embedded-components/account-onboarding?platform=web
