import { membershipPrice } from "./pricing.js";

const id = value => typeof value === "string" ? value : value?.id;
export function validateMembershipPrice(price, interval) {
  if (!price?.active || price.currency !== "usd" || price.unit_amount !== membershipPrice(interval) ||
      price.recurring?.interval !== (interval === "monthly" ? "month" : "year") ||
      price.recurring?.interval_count !== 1) {
    throw Object.assign(new Error("Membership price configuration does not match the advertised plan."), { status: 503 });
  }
}

export function paidBookingSession(session, booking) {
  return session.mode === "payment" && session.payment_status === "paid" &&
    session.currency === "usd" && session.amount_total === booking.amount_cents &&
    session.metadata?.booking_id === booking.id &&
    session.id === booking.stripe_checkout_session_id;
}

// Caller must use a database transaction. Stripe state is fetched under a customer
// lock, so delayed/out-of-order events cannot overwrite a newer membership status.
export async function processPaymentEvent(c, stripe, event, env = process.env) {
  const inserted = await c.query(
    "INSERT INTO webhook_events(stripe_event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING stripe_event_id",
    [event.id, event.type]);
  if (!inserted.rowCount) return;
  const object = event.data.object;
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && object.metadata?.booking_id) {
    const result = await c.query("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [object.metadata.booking_id]);
    const booking = result.rows[0];
    if (!booking) throw new Error("Booking is not available for reconciliation.");
    // Checkout may complete before the create-session response has been persisted.
    // Roll back event receipt so Stripe retries after the session ID is saved.
    if (!booking.stripe_checkout_session_id) throw new Error("Checkout session is still being saved.");
    const session = await stripe.checkout.sessions.retrieve(object.id);
    if (paidBookingSession(session, booking) && booking.status === "pending_payment") {
      await c.query("UPDATE bookings SET status='booked',stripe_payment_intent_id=$1 WHERE id=$2 AND status='pending_payment'", [id(session.payment_intent), booking.id]);
      await c.query("UPDATE service_requests SET status='booked' WHERE id=$1", [booking.request_id]);
    }
  }
  if (event.type.startsWith("customer.subscription.")) {
    const customerId = id(object.customer);
    const user = (await c.query("SELECT id FROM users WHERE stripe_customer_id=$1 FOR UPDATE", [customerId])).rows[0];
    if (!user) return; // An unrelated Stripe customer must never provision an account.
    const sub = await stripe.subscriptions.retrieve(object.id);
    if (id(sub.customer) !== customerId || sub.metadata?.user_id !== user.id) return;
    const interval = sub.metadata?.interval;
    if (!["monthly", "annual"].includes(interval)) return;
    const items = sub.items?.data || [];
    const priceId = interval === "monthly" ? env.STRIPE_MONTHLY_PRICE_ID : env.STRIPE_ANNUAL_PRICE_ID;
    if (items.length !== 1 || id(items[0].price) !== priceId || items[0].quantity !== 1) return;
    const periodEnd = items[0].current_period_end || sub.current_period_end;
    if (!Number.isFinite(periodEnd)) throw new Error("Subscription period is missing.");
    const existing = (await c.query("SELECT stripe_subscription_id,status,checkout_attempt_id FROM memberships WHERE customer_id=$1", [user.id])).rows[0];
    if (existing?.checkout_attempt_id && sub.metadata.checkout_attempt_id !== existing.checkout_attempt_id) return;
    // Never let an old canceled subscription overwrite a replacement subscription.
    if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id) return;
    await c.query(
      "INSERT INTO memberships(customer_id,interval,stripe_subscription_id,status,current_period_end) VALUES($1,$2,$3,$4,to_timestamp($5)) ON CONFLICT(customer_id) DO UPDATE SET interval=EXCLUDED.interval,stripe_subscription_id=EXCLUDED.stripe_subscription_id,status=EXCLUDED.status,current_period_end=EXCLUDED.current_period_end,updated_at=now()",
      [user.id, interval, sub.id, sub.status, periodEnd]);
  }
}
