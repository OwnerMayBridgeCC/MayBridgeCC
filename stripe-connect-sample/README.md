# MayBridge marketplace

The Express application now backs persistent customer and provider accounts, private care-recipient profiles, qualification-aware matching, bookings, completion, reviews, notifications, memberships, and Stripe payments. The original public branded site remains at the repository root.

## Local setup

1. Use Node 20+ and PostgreSQL 15+.
2. Copy `.env.example` to `.env`; use Stripe **test mode** credentials.
3. Run `npm install && npm run migrate && npm start`.
4. Open `http://localhost:4242`.

Admin users must be provisioned directly by an authorized database operator; public signup never accepts the admin role. Provider credential verification remains an admin/vendor operation separate from Stripe payout onboarding.

## Security and payment boundaries

All portal routes use server-side, database-backed sessions and ownership checks. Stripe status changes are accepted only through signed, idempotently stored webhook events. Service amounts and commissions are calculated on the server; checkout stays unavailable until `SERVICE_COMMISSION_BPS` is explicitly configured. Stripe onboarding never changes `verification_status`.
