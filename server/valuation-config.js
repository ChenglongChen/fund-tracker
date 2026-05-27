/**
 * @deprecated 请使用 valuation-profile.js；此文件保留兼容 re-export。
 */
export {
  pickValuationStrategy,
  proxyCodeFor,
  getFundValuationProfile,
  getWeightParams,
  getSyntheticHoldings,
  getProxyCandidates,
  discoverProxyCandidates,
  loadValuationProfiles,
  FEEDER_MAP,
} from './valuation-profile.js';

import { loadValuationProfiles } from './valuation-profile.js';

/** @deprecated 由 valuation-profiles.json 驱动 */
export const PROXY_BY_CODE = new Proxy(
  {},
  {
    get(_t, code) {
      if (typeof code !== 'string') return undefined;
      return loadValuationProfiles()[code]?.proxyCode ?? undefined;
    },
  },
);

/** @deprecated */
export const HOLDINGS_FIRST_CODES = new Set();
