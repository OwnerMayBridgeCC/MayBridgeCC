const $ = s => document.querySelector(s);
let config, connect, component, sdkPromise;
const message = text => { $("#message").textContent = text; };
async function api(path, body) {
  const response = await fetch("/api/embedded/" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-MayBridge-Test": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function loadStripe() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.StripeConnect?.init) return resolve(window.StripeConnect);
    window.StripeConnect = window.StripeConnect || {};
    const script = document.createElement("script");
    const timer = setTimeout(() => reject(new Error("Stripe took too long to load. Refresh the page and retry.")), 20000);
    window.StripeConnect.onLoad = () => { clearTimeout(timer); resolve(window.StripeConnect); };
    script.src = "https://connect-js.stripe.com/v1.0/connect.js";
    script.async = true;
    script.onerror = () => { clearTimeout(timer); reject(new Error("Stripe could not load. Check your connection or browser blocker, then refresh.")); };
    document.head.append(script);
  });
  return sdkPromise;
}
function ready() {
  $("#create").disabled = true;
  $("#onboard").disabled = false;
  $("#status").disabled = false;
}
async function refreshStatus() {
  const data = await api("status");
  message("Test provider: " + data.account_id + "\nCard payments: " + data.card_payments +
    "\nRequirements: " + data.requirements + "\nExiting onboarding does not mean verification is complete. No live payments are enabled by this test.");
}
$("#provider-form").onsubmit = async event => {
  event.preventDefault();
  $("#create").disabled = true;
  message("Creating your test provider…");
  try {
    const data = await api("accounts", Object.fromEntries(new FormData(event.target)));
    ready();
    message("Test provider created: " + data.account_id + ". Open embedded onboarding below.");
  } catch (error) { message(error.message); $("#create").disabled = false; }
};
$("#onboard").onclick = async () => {
  $("#onboard").disabled = true;
  message("Loading secure onboarding inside MayBridge…");
  try {
    const sdk = await loadStripe();
    if (!connect) connect = sdk.init({
      publishableKey: config.publishable_key,
      fetchClientSecret: async () => {
        try { return (await api("session", {})).client_secret; }
        catch (error) { message(error.message); throw error; }
      },
      appearance: { overlays: "dialog", variables: {
        colorPrimary: "#173b35", colorBackground: "#ffffff", colorText: "#173b35",
        colorBorder: "#d9d1c2", borderRadius: "8px", fontFamily: "system-ui, sans-serif"
      } }
    });
    if (!component) {
      component = connect.create("account-onboarding");
      component.setOnExit(() => { refreshStatus().catch(error => message(error.message)); });
      component.setOnLoaderStart(() => message("Continue with Stripe's test onboarding below. Allow its authentication popup if prompted."));
      component.setOnLoadError(() => {
        message("Stripe could not load onboarding. Refresh this page to retry; check sandbox configuration and allow required Stripe popups.");
      });
      $("#onboarding").append(component);
    }
    $("#onboarding").hidden = false;
    $("#onboarding").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { message(error.message); }
  finally { $("#onboard").disabled = false; }
};
$("#status").onclick = () => refreshStatus().catch(error => message(error.message));
api("config").then(data => {
  config = data;
  if (data.account_id) { ready(); message("Your test provider is ready. Resume embedded onboarding below."); }
  else { $("#create").disabled = false; message("Sandbox ready. Create a test provider to begin."); }
}).catch(error => message(error.message));
