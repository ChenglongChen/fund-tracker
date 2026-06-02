
/** @param {number} amount @param {number | undefined} profit */
export function dayProfitPct(amount, profit) {
  if (profit == null || !Number.isFinite(profit) || amount <= profit) return null;
  const base = amount - profit;
  if (base <= 0) return null;
  return (profit / base) * 100;
}
