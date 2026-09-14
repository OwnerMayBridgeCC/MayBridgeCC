// Test-only onboarding. Browser sessions are NOT production provider authentication.
export function installEmbeddedOnboarding(app, { stripe, env, randomBytes, json, now = Date.now }) {
  const sessions = new Map();
  const ttl = 60 * 60 * 1000;
  const fail = (res, status, error) => res.status(status).json({ error });
  const configured = () =>
    /^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || "") &&
    /^pk_test_[A-Za-z0-9]+$/.test(env.STRIPE_PUBLISHABLE_KEY || "") &&
    ![env.STRIPE_SECRET_KEY, env.STRIPE_PUBLISHABLE_KEY].some(k => k.includes("REPLACE"));
  const tokenFrom = req => (req.headers.cookie || "").split(";")
    .map(s => s.trim()).find(s => s.startsWith("mb_test_session="))?.slice(16);
  const lookup = req => {
    const s = sessions.get(tokenFrom(req));
    return s && s.expires > now() ? s : null;
  };
  const route = handler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!configured()) return fail(res, 503, "Testing is locked. Configure matching STRIPE_SECRET_KEY (sk_test_) and STRIPE_PUBLISHABLE_KEY (pk_test_) from the same Stripe sandbox, then redeploy.");
    if (req.method !== "GET") {
      let origin;
      try { origin = new URL(env.BASE_URL).origin; } catch {}
      if (!origin || req.headers.origin !== origin ||
          req.headers["x-maybridge-test"] !== "1") {
        return fail(res, 403, "Request blocked. BASE_URL must match this website's origin.");
      }
    }
    try { await handler(req, res); }
    catch (error) {
      // Never log or serialize a Stripe error object: it can contain sensitive data.
      console.error("Embedded onboarding request failed", error.type || "Error", error.code || "");
      fail(res, 400, "Stripe could not complete this test request. Check matching sandbox keys and Connect setup. No live account was used.");
    }
  };
  app.get("/api/embedded/config", route((req, res) => {
    res.json({ publishable_key: env.STRIPE_PUBLISHABLE_KEY, mode: "test", account_id: lookup(req)?.accountId || null });
  }));
  app.post("/api/embedded/accounts", json(), route(async (req, res) => {
    const name = String(req.body?.display_name || "").trim();
    const email = String(req.body?.contact_email || "").trim();
    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return fail(res, 400, "Enter a provider name and valid test email.");
    }
    for (const [key, s] of sessions) if (s.expires <= now()) sessions.delete(key);
    let s = lookup(req);
    if (!s) {
      if (sessions.size >= 100) return fail(res, 429, "Test session limit reached. Try again later.");
      const token = randomBytes(32).toString("hex");
      s = { expires: now() + ttl, accountId: null, pending: null, token };
      sessions.set(token, s);
      const secure = String(env.BASE_URL).startsWith("https://") ? "; Secure" : "";
      res.set("Set-Cookie", "mb_test_session=" + token + "; Path=/api/embedded; HttpOnly; SameSite=Strict; Max-Age=3600" + secure);
    }
    if (!s.accountId) {
      // Repeated clicks within this browser session share the same creation request.
      if (!s.pending) {
        s.pending = stripe.v2.core.accounts.create({
          display_name: name,
          contact_email: email,
          identity: { country: "us" },
          dashboard: "full",
          defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
          configuration: { merchant: { capabilities: { card_payments: { requested: true } } } }
        }, { idempotencyKey: "mb-embedded-test-" + s.token });
      }
      try { s.accountId = (await s.pending).id; } catch (error) { s.pending = null; throw error; }
    }
    res.json({ account_id: s.accountId, mode: "test" });
  }));
  app.post("/api/embedded/session", route(async (req, res) => {
    const s = lookup(req);
    if (!s?.accountId) return fail(res, 401, "Create a test provider in this browser first. Sessions expire after one hour or a server restart.");
    // Account IDs from URLs or request bodies are deliberately ignored.
    const session = await stripe.v1.accountSessions.create({
      account: s.accountId,
      components: { account_onboarding: { enabled: true } }
    });
    res.json({ client_secret: session.client_secret });
  }));
  app.get("/api/embedded/status", route(async (req, res) => {
    const s = lookup(req);
    if (!s?.accountId) return fail(res, 401, "Your test session expired. Create a new test provider.");
    const account = await stripe.v2.core.accounts.retrieve(s.accountId, {
      include: ["configuration.merchant", "requirements"]
    });
    res.json({
      mode: "test",
      account_id: s.accountId,
      card_payments: account.configuration?.merchant?.capabilities?.card_payments?.status || "unknown",
      requirements: account.requirements?.summary?.minimum_deadline?.status || "unknown"
    });
  }));
}
