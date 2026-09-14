# MayBridge implementation status

Updated: 2026-09-14

## Completed in this release

- Confirmed this checkout is the branded `OwnerMayBridgeCC/MayBridgeCC` history at `e0a4ce2` and contains the existing `stripe-connect-sample`. Remote `main` also resolved to `e0a4ce2` before work began.
- Added production-capable PostgreSQL schema/migrations for users, server sessions, password recovery, private care recipients, provider profiles, requests, bookings, memberships, reviews, notifications/email delivery attempts, and idempotent Stripe events.
- Added customer/provider signup and login, role authorization, ownership enforcement, recovery/reset, profile/request APIs, qualification-aware matching, collision protection, provider/customer completion confirmation, eligible reviews, and dashboard history.
- Added signed Stripe webhook processing, server-derived membership pricing ($20 monthly / $200 annual), configurable commission calculation, Connect destination checkout, and duplicate-payment defenses.
- Replaced the unauthenticated Stripe prototype screen with a responsive branded account portal with honest empty/error states.

## Verification performed

- `npm test`
- `npm run check`
- `npm audit`
- Static review of the migration, endpoint authorization, webhook ordering, and pricing invariant.

## Deployment and blockers

Not deployed. This environment has no GitHub CLI authentication, Vercel CLI/token, `DATABASE_URL`, Stripe test secrets, webhook secret, or Stripe Price IDs. The production commission rate is undocumented, so service charges deliberately return unavailable until `SERVICE_COMMISSION_BPS` is supplied. Add-on prices are also undocumented and no add-on charge route was activated.

Required owner actions: provision PostgreSQL and run `npm run migrate`; set the environment variables in the existing Vercel project; provide approved commission/add-on pricing; configure Stripe test products/webhook endpoint; select a credential/identity verification vendor and credentials; configure an email delivery provider. Then run full integration tests with synthetic users before enabling live mode.
