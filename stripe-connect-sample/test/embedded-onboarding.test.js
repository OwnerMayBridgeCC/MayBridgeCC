import assert from "node:assert/strict";
import { installEmbeddedOnboarding } from "../embedded-onboarding.js";
function fixture(overrides = {}) {
  const routes = {};
  const calls = { create: 0, sessions: [], retrieved: [] };
  let clock = 1000, count = 0;
  const env = { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_PUBLISHABLE_KEY: "pk_test_fake", BASE_URL: "https://preview.example", ...overrides };
  const app = {};
  for (const method of ["get", "post"]) app[method] = (path, ...handlers) => { routes[method + " " + path] = handlers.at(-1); };
  const stripe = {
    v2: { core: { accounts: {
      create: async () => { calls.create++; return { id: "acct_testOwned" }; },
      retrieve: async id => { calls.retrieved.push(id); return {}; }
    } } },
    v1: { accountSessions: { create: async data => {
      calls.sessions.push(data); return { client_secret: "session_test_secret" };
    } } }
  };
  installEmbeddedOnboarding(app, {
    stripe, env, randomBytes: () => ({ toString: () => (++count).toString(16).padStart(64, "0") }),
    json: () => () => {}, now: () => clock
  });
  async function request(method, path, { cookie = "", origin = env.BASE_URL, body = {}, header = "1" } = {}) {
    const res = { statusCode: 200, headers: {},
      set(k, v) { this.headers[k] = v; return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; } };
    await routes[method.toLowerCase() + " /api/embedded/" + path]({
      method, headers: { cookie, origin, "x-maybridge-test": header }, body
    }, res);
    return res;
  }
  return { request, calls, expire: () => { clock += 3600001; } };
}
export async function runTests() {
  const body = { display_name: "Test provider", contact_email: "provider@example.com" };
  for (const overrides of [
    { STRIPE_SECRET_KEY: "sk_live_fake" }, { STRIPE_PUBLISHABLE_KEY: "pk_live_fake" },
    { STRIPE_PUBLISHABLE_KEY: "" }, { STRIPE_SECRET_KEY: "sk_test_REPLACE_ME" }
  ]) {
    const f = fixture(overrides);
    assert.equal((await f.request("POST", "accounts", { body })).statusCode, 503);
    assert.equal((await f.request("GET", "config")).statusCode, 503);
    assert.equal(f.calls.create, 0);
  }
  const f = fixture();
  const config = await f.request("GET", "config");
  assert.equal(config.body.mode, "test");
  assert.equal(config.body.STRIPE_SECRET_KEY, undefined);
  assert.equal(config.headers["Cache-Control"], "no-store");
  assert.equal((await f.request("POST", "session")).statusCode, 401);
  assert.equal((await f.request("POST", "accounts", { body, origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await f.request("POST", "accounts", { body, header: "" })).statusCode, 403);
  assert.equal((await f.request("POST", "accounts", { body: { display_name: "Test", contact_email: "bad" } })).statusCode, 400);
  assert.equal(f.calls.create, 0);
  const created = await f.request("POST", "accounts", { body });
  assert.equal(created.statusCode, 200);
  assert.equal(f.calls.create, 1);
  const cookie = created.headers["Set-Cookie"].split(";")[0];
  assert.ok(created.headers["Set-Cookie"].includes("HttpOnly; SameSite=Strict"));
  assert.ok(created.headers["Set-Cookie"].includes("; Secure"));
  await f.request("POST", "accounts", { cookie, body });
  assert.equal(f.calls.create, 1, "repeat create must not duplicate accounts");
  const session = await f.request("POST", "session", { cookie, body: { account_id: "acct_someoneElse" } });
  assert.equal(session.body.client_secret, "session_test_secret");
  assert.equal(session.headers["Cache-Control"], "no-store");
  assert.deepEqual(f.calls.sessions[0], {
    account: "acct_testOwned", components: { account_onboarding: { enabled: true } }
  });
  assert.equal((await f.request("POST", "session", { cookie: "mb_test_session=forged" })).statusCode, 401);
  const status = await f.request("GET", "status", { cookie });
  assert.equal(status.body.card_payments, "unknown");
  assert.equal(status.body.requirements, "unknown");
  assert.equal(f.calls.retrieved[0], "acct_testOwned");
  assert.equal((await f.request("GET", "config", { cookie })).body.account_id, "acct_testOwned");
  f.expire();
  assert.equal((await f.request("POST", "session", { cookie })).statusCode, 401);
  assert.equal((await f.request("GET", "status", { cookie })).statusCode, 401);
  assert.equal((await f.request("GET", "config", { cookie })).body.account_id, null);
  console.log("Embedded onboarding guard, session ownership, duplicate, expiry, and status tests passed.");
}
await runTests();
