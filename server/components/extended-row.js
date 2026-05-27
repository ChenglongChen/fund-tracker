/** row2 extended 金额：穿透 pct × amount，与 row1 ep 计算分离。 */
export function extendedProfitFromPct(amount, impactPctExtended) {
  if (impactPctExtended == null || !Number.isFinite(impactPctExtended)) return null;
  return Math.round(((amount * impactPctExtended) / 100) * 100) / 100;
}
