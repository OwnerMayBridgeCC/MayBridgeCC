export const MEMBERSHIP_PRICES = Object.freeze({ monthly: 2000, annual: 20000 });
export function membershipPrice(interval) {
  if (!(interval in MEMBERSHIP_PRICES)) throw Object.assign(new Error("Choose monthly or annual membership."), { status: 400 });
  return MEMBERSHIP_PRICES[interval];
}
export function applicationFee(amount, commissionBasisPoints) {
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Invalid service amount.");
  if (!Number.isInteger(commissionBasisPoints) || commissionBasisPoints < 0 || commissionBasisPoints > 10000) throw new Error("Commission is not configured.");
  return Math.round(amount * commissionBasisPoints / 10000);
}
