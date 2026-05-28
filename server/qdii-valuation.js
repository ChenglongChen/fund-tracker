/**
 * QDII 穿透估值：fundgz 融合、置信度标签。
 */
import {
  computeHoldingsImpactBreakdown,
  summarizeFxExposure,
} from './holdings-pipeline.js';

export { computeHoldingsImpactBreakdown, summarizeFxExposure };

/** @param {string|null|undefined} reportDate @param {Date} [now] */
export function reportAgeDays(reportDate, now = new Date()) {
  if (!reportDate) return 999;
  const d = new Date(String(reportDate));
  if (!Number.isFinite(d.getTime())) return 999;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

/** @param {string|null|undefined} value */
export function parseGzTimestamp(value) {
  if (!value) return 0;
  const t = new Date(String(value).replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** @param {{ gztime?: string|null }} [gz] @param {Date} [now] @param {number} [maxAgeMs] */
export function isFundgzFresh(gz, now = new Date(), maxAgeMs = 3 * 60 * 60 * 1000) {
  const t = parseGzTimestamp(gz?.gztime);
  if (!t) return false;
  return now.getTime() - t <= maxAgeMs;
}

/** @param {{ quoteCoverage?: number, reportAgeDays?: number, fundgzFresh?: boolean }} opts */
export function ensembleAlpha({ quoteCoverage = 0, reportAgeDays = 999, fundgzFresh = false }) {
  if (!fundgzFresh) return 1;
  let alpha = 0.3 + (Math.min(Math.max(quoteCoverage, 0), 100) / 100) * 0.55;
  if (reportAgeDays > 90) alpha -= 0.1;
  if (reportAgeDays > 150) alpha -= 0.15;
  return Math.min(0.92, Math.max(0.28, alpha));
}

/** holdings 权重 alpha ∈ [0,1]；1=纯穿透，0=纯 fundgz */
export function blendEnsembleImpact(holdingsPct, fundgzPct, alpha) {
  if (holdingsPct == null || !Number.isFinite(holdingsPct)) return fundgzPct ?? null;
  if (fundgzPct == null || !Number.isFinite(fundgzPct)) return holdingsPct;
  if (alpha >= 1) return holdingsPct;
  if (alpha <= 0) return fundgzPct;
  return holdingsPct * alpha + fundgzPct * (1 - alpha);
}

/** @param {{ quoteCoverage?: number, reportAgeDays?: number, impactSource?: string|null }} opts */
export function valuationConfidenceLabel({ quoteCoverage = 0, reportAgeDays = 999, impactSource = null }) {
  if (impactSource === 'fundgz') return '中·fundgz';
  if (impactSource === 'ensemble') {
    if (quoteCoverage >= 50 && reportAgeDays <= 120) return '中高·融合';
    return '中·融合';
  }
  if (impactSource === 'index' || (impactSource && impactSource.startsWith('proxy'))) return '低·指数';
  if (quoteCoverage >= 70 && reportAgeDays <= 90) return '高·穿透';
  if (quoteCoverage >= 45 && reportAgeDays <= 150) return '中·穿透';
  return '低·穿透';
}

/**
 * 持仓穿透 + fundgz 融合（holdings 策略 / 高覆盖穿透）。
 * @param {object} r computeFundImpactFromPack 结果
 * @param {{ gszzl?: number, gztime?: string|null }|null} gz
 * @param {object|null} pack
 * @param {Date} [now]
 */
export function applyHoldingsEnsemble(r, gz, pack, now = new Date()) {
  const breakdown = r.impactBreakdown ?? null;
  const holdingsPct = breakdown?.totalPct ?? r.impactPct;
  if (holdingsPct == null || !Number.isFinite(holdingsPct)) {
    if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
      return {
        ...r,
        impactPct: gz.gszzl,
        impactPctRegular: r.impactSession === 'regular' ? gz.gszzl : r.impactPctRegular,
        impactSource: 'fundgz',
        gzTime: gz.gztime ?? null,
        fundgzImpactPct: gz.gszzl,
      };
    }
    return r;
  }

  if (gz?.gszzl == null || !Number.isFinite(gz.gszzl)) {
    return {
      ...r,
      impactSource: r.impactSource ?? 'holdings',
      holdingsImpactPct: holdingsPct,
      impactBreakdown: breakdown,
      valuationConfidence: valuationConfidenceLabel({
        quoteCoverage: r.quoteCoverage ?? 0,
        reportAgeDays: reportAgeDays(pack?.recentReportDate ?? pack?.reportDate, now),
        impactSource: 'holdings',
      }),
    };
  }

  const age = reportAgeDays(pack?.recentReportDate ?? pack?.reportDate, now);
  const alpha = ensembleAlpha({
    quoteCoverage: r.quoteCoverage ?? 0,
    reportAgeDays: age,
    fundgzFresh: isFundgzFresh(gz, now),
  });
  const blended = blendEnsembleImpact(holdingsPct, gz.gszzl, alpha);
  let impactSource = 'ensemble';
  if (alpha >= 0.98) impactSource = 'holdings';
  else if (alpha <= 0.05) impactSource = 'fundgz';

  return {
    ...r,
    impactPct: blended,
    impactPctRegular:
      r.impactPctRegular != null && r.impactSession === 'regular' ? blended : r.impactPctRegular,
    impactSource,
    ensembleAlpha: alpha,
    holdingsImpactPct: holdingsPct,
    fundgzImpactPct: gz.gszzl,
    gzTime: gz.gztime ?? null,
    impactBreakdown: breakdown,
    valuationConfidence: valuationConfidenceLabel({
      quoteCoverage: r.quoteCoverage ?? 0,
      reportAgeDays: age,
      impactSource,
    }),
  };
}
