export function requireRecoveryEmail(env = process.env) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.BASE_URL?.startsWith("https://")) {
    throw Object.assign(new Error("Password recovery email is not configured."), { status: 503 });
  }
}

export async function sendRecoveryEmail(email, token, env = process.env, send = fetch) {
  requireRecoveryEmail(env);
  const url = new URL("/stripe-connect-sample/public/index.html", env.BASE_URL);
  url.hash = new URLSearchParams({ reset_token: token }).toString();
  const response = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: "Reset your MayBridge password",
      text: `Reset your password using this link within one hour:\n${url}\nIf you did not request this, ignore this email.` }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Object.assign(new Error("Recovery email could not be sent."), { status: 503 });
  return (await response.json()).id;
}
