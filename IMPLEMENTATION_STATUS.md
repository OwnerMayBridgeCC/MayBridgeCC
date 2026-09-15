# MayBridge implementation status

Updated: 2026-09-15

## Release state

PR #2 is an unfinished marketplace foundation, not a launch-ready service.
The GitHub integration can publish updates. Vercel reported a ready preview
for the original PR, but this does not verify that the Express API is deployed.
The connected Vercel tool returned 403 for the existing project and no accessible
teams. This execution environment has no DATABASE_URL, VERCEL_TOKEN,
STRIPE_SECRET_KEY, or RESEND_API_KEY. No production migration or payment was run.

## Fixes added after review

- Removed customer-supplied service amounts. Rates must come from the trusted
  SERVICE_HOURLY_RATES_JSON configuration; blank commission does not become 0%.
- Validated Stripe membership Price currency, amount, recurrence, and active
  status against $20/month or $200/year.
- Added durable membership checkout attempts, metadata association, membership
  upsert from signed events, and latest-subscription reconciliation.
- Required paid status, currency, amount, and matching Checkout Session before
  booking fulfillment. Duplicate events cannot rewind completed bookings.
- Added a provider-only start action so paid bookings can progress to completion.
- Added a PostgreSQL exclusion constraint to reject partial time overlaps.
- Added an optional Resend recovery adapter. No token is returned in response
  headers; missing email setup returns unavailable instead of claiming a queue.
- Added portal reset, membership checkout/manage, and service-state controls.
- Added customer care-recipient, request, match/selection, provider detail/review,
  and service-review forms, plus provider profile and availability editing.
- Matching and booking require an active membership with a future paid period.
- Matching respects provider availability windows and excludes disabled accounts.
- Clinical requests are retained for review but cannot automatically match/book
  until jurisdiction-specific credential routing is implemented.
- Rendered notification text without HTML injection and surfaced API failures.
- Provider qualification/service changes require renewed verification.

## Verification

- Nine automated tests pass, including an integration test using PGlite's local
  PostgreSQL engine with pgcrypto and btree_gist.
- Tests exercise both migrations, HTTP authentication/ownership, attempted
  customer price tampering, paid booking start/completion/review, overlapping
  bookings, and membership webhook creation/cancellation.
- Stripe and email responses are mocked; no real payment or email was sent.
- JavaScript syntax checks pass. npm audit found zero known vulnerabilities.
- Production PostgreSQL, real Stripe events, email deliverability, browser
  rendering, Vercel routing and the live domain remain unverified. Chrome
  installation failed with a certificate error; the alternate browser download
  timed out. DOM tests are not a substitute for a real browser pass.

## Remaining implementation and launch work

- Run real-browser and test-mode payment verification for the newly connected
  customer and provider screens. Local DOM tests cover rendering and payloads.
- Implement Connect account onboarding and payout-status synchronization.
- Implement approved vendor-hosted verification links, credential expiry and
  jurisdiction-specific licensed-provider routing. Existing qualification
  fields are not a complete credential verification system.
- Complete add-on catalog/checkout and
  cancellation/refund/reconciliation operations. Expired service checkout
  currently requires support reconciliation.
- Add persistent authentication abuse controls and email verification.
- Configure the Express API on the actual hosting project; the repository root
  public website being served successfully does not prove API routing works.
- Supply approved commission and service/add-on pricing, database, Stripe test
  keys/Prices/webhook, and email credentials. Validate tax configuration before
  enabling live charges; automatic tax has not been enabled.
- Run complete test-mode customer/provider journeys before enabling real users.

Do not merge or describe this as a completed business launch solely because
the preview build or local tests passed.
