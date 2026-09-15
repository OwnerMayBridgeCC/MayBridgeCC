export const MEMBERSHIP_PRICES = Object.freeze({ monthly: 2000, annual: 20000 });
export function membershipPrice(interval) {
  if (!Object.hasOwn(MEMBERSHIP_PRICES, interval)) throw Object.assign(new Error("Choose monthly or annual membership."), { status: 400 });
  return MEMBERSHIP_PRICES[interval];
}

export function commissionRate(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) throw Object.assign(new Error("Commission is not configured."), { status: 503 });
  const rate = Number(value);
  if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw Object.assign(new Error("Commission is not configured."), { status: 503 });
  return rate;
}

// Only trusted server configuration supplies rates. Customers never set a charge amount.
export function serviceAmount(serviceType, minutes, catalogJSON) {
  let catalog;
  try { catalog = JSON.parse(catalogJSON || "{}"); } catch { throw Object.assign(new Error("Service pricing is unavailable."), { status: 503 }); }
  const hourly = catalog && Object.hasOwn(catalog, serviceType) ? catalog[serviceType] : null;
  if (!Number.isSafeInteger(hourly) || hourly < 1) throw Object.assign(new Error("Service pricing is unavailable."), { status: 503 });
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw Object.assign(new Error("Duration must be between 1 and 1440 minutes."), { status: 400 });
  const amount = Math.round(hourly * minutes / 60);
  if (!Number.isSafeInteger(amount) || amount < 50 || amount > 99999999) throw Object.assign(new Error("Service amount is outside supported limits."), { status: 400 });
  return amount;
}
export function applicationFee(amount, commissionBasisPoints) {
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Invalid service amount.");
  if (!Number.isInteger(commissionBasisPoints) || commissionBasisPoints < 0 || commissionBasisPoints > 10000) throw new Error("Commission is not configured.");
  return Math.round(amount * commissionBasisPoints / 10000);
}
