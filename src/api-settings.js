
import { getWebStorage, STORAGE_KEYS } from '@fund-tracker/storage';

export const API_MODE_LOCAL = 'local';
export const API_MODE_REMOTE = 'remote';

/** @returns {string} */
export function loadApiMode() {
  return getWebStorage().getItem(STORAGE_KEYS.API_MODE) || API_MODE_LOCAL;
}

/** @returns {string} */
export function loadApiBaseFromStorage() {
  return getWebStorage().getItem(STORAGE_KEYS.API_BASE) || '';
}

/** @returns {string} */
export function loadApiTokenFromStorage() {
  return getWebStorage().getItem(STORAGE_KEYS.API_TOKEN) || '';
}

/** @returns {string} */
export function resolveApiBaseUrl() {
  const envBase = import.meta.env.VITE_API_BASE ?? '';
  if (loadApiMode() === API_MODE_REMOTE) {
    return loadApiBaseFromStorage() || envBase;
  }
  return envBase;
}

/**
 * @param {{ mode?: string, baseUrl?: string, token?: string }} patch
 * @returns {{ mode: string, baseUrl: string, token: string }}
 */
export function saveApiSettings(patch = {}) {
  const storage = getWebStorage();
  const mode = patch.mode ?? loadApiMode();
  const baseUrl = patch.baseUrl != null ? patch.baseUrl.trim() : loadApiBaseFromStorage();
  const token = patch.token != null ? patch.token.trim() : loadApiTokenFromStorage();
  storage.setItem(STORAGE_KEYS.API_MODE, mode);
  storage.setItem(STORAGE_KEYS.API_BASE, baseUrl);
  storage.setItem(STORAGE_KEYS.API_TOKEN, token);
  return { mode, baseUrl, token };
}

/** @returns {{ mode: string, baseUrl: string, token: string }} */
export function readApiSettings() {
  return {
    mode: loadApiMode(),
    baseUrl: loadApiBaseFromStorage(),
    token: loadApiTokenFromStorage(),
  };
}
