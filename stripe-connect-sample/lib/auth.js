import crypto from "node:crypto";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
export const SESSION_COOKIE = "maybridge_session";

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 12 || password.length > 200) {
    throw Object.assign(new Error("Password must be between 12 and 200 characters."), { status: 400 });
  }
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 200) return false;
  const [algorithm, salt, expected] = String(stored).split(":");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64, SCRYPT_OPTIONS);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const tokenHash = token => crypto.createHash("sha256").update(token).digest("hex");
export function parseCookies(header = "") {
  const result = {};
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    try { result[part.slice(0,at).trim()] = decodeURIComponent(part.slice(at+1)); } catch { /* Ignore malformed cookie. */ }
  }
  return result;
}
export function sessionCookie(token, maxAge = 60 * 60 * 24 * 14) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
