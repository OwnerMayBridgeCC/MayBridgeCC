const $ = selector => document.querySelector(selector);
const msg = text => { $("#message").textContent = text; $("#message").classList.remove("hidden"); };
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  let data;
  try { data = response.status === 204 ? {} : await response.json(); }
  catch { throw Error("The account service is unavailable. Please try again later."); }
  if (!response.ok) throw Object.assign(Error(data.error || "Request failed"), { status: response.status });
  return data;
}
const post = (url, body = {}) => api(url, { method: "POST", body: JSON.stringify(body) });
async function action(button, fn) {
  button.disabled = true;
  try { await fn(); } catch (error) { msg(error.message); }
  finally { button.disabled = false; }
}
function bookingCard(booking, role) {
  const card = document.createElement("div");
  card.className = "booking";
  card.textContent = booking.status.replaceAll("_", " ") + " · " + new Date(booking.starts_at).toLocaleString();
  const operation = role === "provider" ?
    ({ booked: "start", in_progress: "complete" })[booking.status] :
    booking.status === "provider_completed" ? "confirm" : null;
  if (operation) {
    const button = document.createElement("button");
    button.textContent = {start:"Start service",complete:"Mark service complete",confirm:"Confirm completion"}[operation];
    button.onclick = () => action(button, async () => { await post("/api/bookings/" + booking.id + "/" + operation); await load(); });
    card.append(document.createElement("br"), button);
  }
  return card;
}
async function load() {
  try {
    const data = await api("/api/dashboard");
    $("#auth").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    $("#identity").textContent = data.user.display_name + " · " + data.user.role;
    $("#membership").classList.toggle("hidden", data.user.role !== "customer");
    $("#bookings").replaceChildren(...data.bookings.map(booking => bookingCard(booking, data.user.role)));
    if (!data.bookings.length) $("#bookings").textContent = "No services yet. Your confirmed bookings will appear here.";
    // Render notification text as text, never executable HTML.
    $("#notifications").replaceChildren(...data.notifications.map(notification => {
      const div = document.createElement("div");
      div.className = "booking";
      div.textContent = notification.subject + " — " + notification.body;
      return div;
    }));
    if (!data.notifications.length) $("#notifications").textContent = "You have no notifications.";
  } catch (error) { if (error.status !== 401) msg(error.message); }
}
for (const id of ["login", "signup", "recovery"]) {
  $("#" + id).onsubmit = event => {
    event.preventDefault();
    action(event.submitter, async () => {
      const result = await post("/api/auth/" + id, Object.fromEntries(new FormData(event.target)));
      if (id === "recovery") msg(result.message);
      else location.reload();
    });
  };
}
const resetToken = new URLSearchParams(location.hash.slice(1)).get("reset_token");
if (resetToken) {
  history.replaceState(null, "", location.pathname);
  $("#reset").classList.remove("hidden");
  $("#reset").onsubmit = event => {
    event.preventDefault();
    action(event.submitter, async () => {
      await post("/api/auth/reset", { token: resetToken, password: new FormData(event.target).get("password") });
      $("#reset").classList.add("hidden");
      msg("Your password has been reset. Sign in with your new password.");
    });
  };
}
$("#logout").onclick = event => action(event.currentTarget, async () => { await post("/api/auth/logout"); location.reload(); });
for (const button of document.querySelectorAll("[data-plan]")) {
  button.onclick = () => action(button, async () => {
    const data = await post("/api/memberships/checkout", { interval: button.dataset.plan });
    location.assign(data.checkout_url);
  });
}
$("#manage-membership").onclick = event => action(event.currentTarget, async () => {
  const data = await post("/api/memberships/portal");
  location.assign(data.url);
});
load();
