# MayBridge release status — September 15, 2026

## Delivered code

- Public membership pricing ($20/month, $200/year), dedicated Mission and Values
  pages, transparent crest, and responsive navigation.
- Corrected `/portal` script routing and accessible signup fields.
- Member signup continues directly to the selected membership checkout when configured.
- Private care-recipient preferences with customer-owned read/update endpoints.
- Member-only ZIP/radius provider directory, request-specific availability matching,
  professional résumés, ratings, and completed service counts.
- Provider application, availability, owner review queue, screening vendor link,
  review expiry dates, and immutable review audit entries.
- Discovery and booking exclude unapproved providers and expired screening results.
- Availability-only edits preserve approval; material profile edits require review.
- Stripe Accounts v2 recipient onboarding, capability refresh before booking,
  and Stripe-hosted payout dashboard links. External Connect calls still need
  actual credentials and test-mode end-to-end verification.
- Durable authentication throttling and explicit live-payment enablement.
- Readiness messaging prevents signup controls from pretending enrollment is working.

## Verification

Nine automated tests passed, including an expanded PostgreSQL-engine integration
scenario covering private care data, paid-member discovery, geographic filtering,
expired screening, owner approval audit, booking lifecycle, and membership events.
Stripe responses in these automated tests are simulated. Browser/payment completion
is not implied by those tests. Vercel built preview
`dpl_6P8biGmYYsMhdFpG3ozYm3vHLiD2` successfully; its preview protection blocked
browser inspection. Production visual checks are recorded separately after release.

## Confirmed live configuration blocker

An actual production diagnostic on September 15 returned false for ALL of:
DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_MONTHLY_PRICE_ID,
STRIPE_ANNUAL_PRICE_ID, RESEND_API_KEY, EMAIL_FROM, VERIFICATION_START_URL.
No production database is connected or initialized. The diagnostic did not expose
secret values or modify customer data. Connecting ChatGPT to Stripe or Vercel does
not populate these application settings.

## Stripe sandbox catalog prepared

Account: MayBridge Care Collective Llc sandbox (acct_1UFMrtQc2CdmGx6q).
Product: prod_VGXSKZz8f4vYgg.
Monthly $20: price_1UG0NGQc2CdmGx6qgy6h7lnz.
Annual $200: price_1UG0NvQc2CdmGx6qe8GtJDrW.
These are TEST prices only. No live payment, customer charge, or subscription was created.

## Required activation steps

1. Connect production PostgreSQL and run migrations 001–004 using `npm run migrate`.
2. Supply Stripe sandbox credentials, the above test Price IDs, and a webhook signing
   secret. Subscribe the snapshot endpoint `/webhooks/stripe` to subscription lifecycle
   and checkout completion/async success events. Test full customer/provider journeys.
3. Configure transactional email with a verified sender and test password recovery.
4. Connect the contracted screening vendor's HTTPS enrollment URL. Actual screenings
   and owner decisions are external operations, not simulated approval badges.
5. Create the owner login and run `npm run owner -- EXACT_OWNER_EMAIL` using the
   production database connection. This promotes only an existing selected account.
6. Confirm the service rate card, commission, add-on catalog and policies. These
   values remain unconfigured; the app does not invent or charge service prices.
7. Review terms, privacy, cancellations/refunds, clinical routing and tax treatment
   before live payments. Then configure separate live Stripe prices/credentials,
   enable Connect when its platform setup is complete, and set LIVE_PAYMENTS_ENABLED=true.

## Remaining product work

- Real email verification, add-on checkout, automated refunds/cancellations and
  jurisdiction-specific clinical-provider routing are not completed.
- Nursing requests stay in manual review. No autonomous clinical booking is enabled.
- This release is not a completed operational business launch. No revenue or traffic
  automation has been claimed or enabled.
