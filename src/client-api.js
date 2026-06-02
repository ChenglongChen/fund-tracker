import { createClient } from '@fund-tracker/api-client';
import { getWebStorage, STORAGE_KEYS } from '@fund-tracker/storage';
import { resolveApiBaseUrl, loadApiTokenFromStorage } from './api-settings.js';

const client = createClient({
  baseUrl: resolveApiBaseUrl(),
  getToken: () =>
    getWebStorage().getItem(STORAGE_KEYS.API_TOKEN) ??
    loadApiTokenFromStorage() ??
    import.meta.env.VITE_API_TOKEN ??
    '',
});

/** Re-read storage and update client base URL. */
export function refreshApiClient() {
  client.setBaseUrl(resolveApiBaseUrl());
}

refreshApiClient();

export const {
  fetchLive,
  fetchSettings,
  saveAssetViewMode,
  fetchDailyHistory,
  fetchWatchlist,
  fetchWatchlistLive,
  addWatchlistApi,
  removeWatchlistApi,
  fetchPortfolio,
  fetchFundDetail,
  addFundApi,
  updateFundApi,
  deleteFundApi,
  savePortfolio,
  triggerSettle,
  fetchHealth,
} = client;

export function setApiBaseUrl(baseUrl) {
  client.setBaseUrl(baseUrl);
}

export function isApiMode() {
  return true;
}
