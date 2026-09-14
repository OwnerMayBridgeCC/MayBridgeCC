import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 4242);
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");

/**
 * Fail early with an actionable message. This avoids accidentally starting a
 * server that can render pages but can never make a Stripe request.
 */
function requiredEnv(name, hint) {
  const value = process.env[name];
  if (!value || value.includes("REPLACE_ME")) {
    throw new Error(`Missing ${name}. ${hint}`);
  }
  return value;
}

let stripeClient;
try {
  // One Stripe Client is shared by every route. The SDK selects the API version.
  stripeClient = new Stripe(requiredEnv(
    "STRIPE_SECRET_KEY",
    "Copy STRIPE_SECRET_KEY from Stripe Dashboard (use a test key while developing)."
  ));
} catch (error) {
  console.error(`Stripe startup error: ${error.message}`);
  process.exit(1);
}

function accountIdFromRequest(req) {
  const accountId = req.params.accountId;
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    const error = new Error("Use a valid connected account ID (acct_...).");
    error.status = 400;
    throw error;
  }
  return accountId;
}

function sendError(res, error) {
  const status = error.status || (error.type === "StripeAuthenticationError" ? 500 : 400);
  console.error(error);
  res.status(status).json({ error: error.message || "Stripe request failed." });
}

/**
 * V2 account creation. Do not add type: express/standard/custom here: V2
 * accounts use configuration and responsibilities instead.
 */
app.post("/api/accounts", express.json(), async (req, res) => {
  try {
    const displayName = String(req.body?.display_name || "").trim();
    const contactEmail = String(req.body?.contact_email || "").trim();
    if (!displayName || !contactEmail) {
      return res.status(400).json({ error: "display_name and contact_email are required." });
    }
    const account = await stripeClient.v2.core.accounts.create({
      display_name: displayName,
      contact_email: contactEmail,
      identity: { country: "us" },
      dashboard: "full",
      defaults: {
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe"
        }
      },
      configuration: {
        customer: {},
        merchant: {
          capabilities: { card_payments: { requested: true } }
        }
      }
    });
    // TODO: In a real app, persist user.id -> account.id in your database.
    res.json({ account_id: account.id });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Read status directly from V2 on every request. We intentionally do not cache
 * onboarding state in a database for this demo.
 */
app.get("/api/accounts/:accountId/status", async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const account = await stripeClient.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.merchant", "requirements"]
    });
    const readyToProcessPayments =
      account?.configuration?.merchant?.capabilities?.card_payments?.status === "active";
    const requirementsStatus =
      account?.requirements?.summary?.minimum_deadline?.status;
    const onboardingComplete =
      requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";
    res.json({
      account_id: accountId,
      ready_to_process_payments: readyToProcessPayments,
      onboarding_complete: onboardingComplete,
      requirements_status: requirementsStatus || "unknown",
      capability_status: account?.configuration?.merchant?.capabilities?.card_payments?.status || "unknown"
    });
  } catch (error) {
    sendError(res, error);
  }
});

/** Create a V2 Account Link for Stripe-hosted onboarding. */
app.post("/api/accounts/:accountId/onboarding-link", async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const link = await stripeClient.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant", "customer"],
          refresh_url: `${baseUrl}/?accountId=${encodeURIComponent(accountId)}&refresh=1`,
          return_url: `${baseUrl}/?accountId=${encodeURIComponent(accountId)}&onboarding=returned`
        }
      }
    });
    res.json({ url: link.url });
  } catch (error) {
    sendError(res, error);
  }
});

/** Create a product on the connected account using the Stripe-Account header. */
app.post("/api/accounts/:accountId/products", express.json(), async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const priceInCents = Number(req.body?.price_in_cents);
    const currency = String(req.body?.currency || "usd").toLowerCase();
    if (!name || !Number.isInteger(priceInCents) || priceInCents < 1) {
      return res.status(400).json({ error: "name and a positive integer price_in_cents are required." });
    }
    const product = await stripeClient.v1.products.create({
      name,
      description,
      default_price_data: { unit_amount: priceInCents, currency }
    }, { stripeAccount: accountId });
    res.json({ product });
  } catch (error) {
    sendError(res, error);
  }
});

/** List products for one account. In production, use a user slug or database ID in URLs. */
app.get("/api/accounts/:accountId/products", async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const products = await stripeClient.v1.products.list({
      limit: 20,
      active: true,
      expand: ["data.default_price"]
    }, { stripeAccount: accountId });
    res.json({ products: products.data });
  } catch (error) {
    sendError(res, error);
  }
});

/** Direct charge: Checkout runs on the connected account and pays an application fee. */
app.post("/api/accounts/:accountId/checkout", express.json(), async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const productName = String(req.body?.name || "MayBridge service");
    const unitAmount = Number(req.body?.unit_amount);
    const currency = String(req.body?.currency || "usd").toLowerCase();
    const applicationFee = Number(req.body?.application_fee_amount || 0);
    if (!Number.isInteger(unitAmount) || unitAmount < 1) {
      return res.status(400).json({ error: "unit_amount must be a positive integer in cents." });
    }
    const session = await stripeClient.v1.checkout.sessions.create({
      line_items: [{ price_data: { currency, product_data: { name: productName }, unit_amount: unitAmount }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: applicationFee },
      mode: "payment",
      integration_identifier: "maybridge_demo_A7kP2mQx", // API >= 2026-03-25 requires an 8-character suffix.
      success_url: `${baseUrl}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?canceled=1`
    }, { stripeAccount: accountId });
    res.json({ url: session.url });
  } catch (error) {
    sendError(res, error);
  }
});

/** Subscription Checkout is created on the platform using the connected account as customer_account. */
app.post("/api/accounts/:accountId/subscribe", async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const priceId = requiredEnv(
      "PLATFORM_SUBSCRIPTION_PRICE_ID",
      "Create a recurring platform Price and set PLATFORM_SUBSCRIPTION_PRICE_ID in .env."
    );
    const session = await stripeClient.v1.checkout.sessions.create({
      customer_account: accountId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?subscription=canceled`
    });
    res.json({ url: session.url });
  } catch (error) {
    sendError(res, error);
  }
});

/** Let the connected account manage its subscription in Stripe Billing Portal. */
app.post("/api/accounts/:accountId/billing-portal", async (req, res) => {
  try {
    const accountId = accountIdFromRequest(req);
    const session = await stripeClient.v1.billingPortal.sessions.create({
      customer_account: accountId,
      return_url: `${baseUrl}/?accountId=${encodeURIComponent(accountId)}`
    });
    res.json({ url: session.url });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * V2 thin-event webhook. Register this route before express.json so the raw
 * request body is available for signature verification.
 */
app.post("/webhooks/stripe/thin", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const secret = requiredEnv("STRIPE_WEBHOOK_SECRET", "Set the signing secret from stripe listen.");
    const signature = req.headers["stripe-signature"];
    const thinEvent = stripeClient.parseThinEvent(req.body, signature, secret);
    // Thin events contain an ID/type envelope; retrieve the full event to inspect it.
    const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);
    switch (event.type) {
      case "v2.core.account[requirements].updated":
        console.log("Account requirements changed:", event.data?.account);
        // TODO: fetch/store the new requirements for the mapped user.
        break;
      case "v2.core.account[configuration.merchant].capability_status_updated":
      case "v2.core.account[configuration.customer].capability_status_updated":
      case "v2.core.account[.recipient].capability_status_updated":
        console.log("Account capability changed:", event.type, event.data?.account);
        // TODO: refresh the account status shown to the user.
        break;
      default:
        console.log("Unhandled thin event:", event.type);
    }
    res.json({ received: true });
  } catch (error) {
    sendError(res, error);
  }
});

/** Standard (non-thin) Billing webhook for subscription and customer changes. */
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const secret = requiredEnv("STRIPE_WEBHOOK_SECRET", "Set the signing secret from Stripe Dashboard.");
    const event = stripeClient.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
    switch (event.type) {
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerAccount = subscription.customer_account;
        // TODO: write subscription.items.data[0].price and quantity to your DB.
        console.log("Subscription updated for", customerAccount, subscription.id);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        // TODO: revoke access in your DB for subscription.customer_account.
        console.log("Subscription canceled for", subscription.customer_account);
        break;
      }
      case "payment_method.attached":
      case "payment_method.detached":
      case "customer.updated":
      case "customer.tax_id.created":
      case "customer.tax_id.deleted":
      case "customer.tax_id.updated":
      case "billing_portal.configuration.created":
      case "billing_portal.configuration.updated":
      case "billing_portal.session.created":
        // TODO: record billing state changes, never use billing email as a login credential.
        console.log("Billing event:", event.type);
        break;
      default:
        console.log("Unhandled standard event:", event.type);
    }
    res.json({ received: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
  if (error) return sendError(res, error);
  next();
});

app.listen(port, () => {
  console.log(`MayBridge Stripe sample running at ${baseUrl}`);
  console.log("Thin listener example:");
  console.log("stripe listen --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated' --forward-thin-to http://localhost:" + port + "/webhooks/stripe/thin");
});
