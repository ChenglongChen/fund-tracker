
/** Cross-platform key-value storage keys. */
export const STORAGE_KEYS = {
  ACTIVE_SCOPE: 'fund-tracker-active-scope',
  API_MODE: 'fund-tracker-api-mode',
  API_BASE: 'fund-tracker-api-base',
  API_TOKEN: 'fund-tracker-api-token',
  HIDE_ASSETS: 'fund-tracker-hide-assets',
};

/**
 * @param {{ getItem?: (k: string) => string|null, setItem?: (k: string, v: string) => void, removeItem?: (k: string) => void }} backing
 */
export function createStorage(backing) {
  return {
    getItem(key) {
      try {
        return backing.getItem?.(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        backing.setItem?.(key, value);
      } catch {
        /* ignore */
      }
    },
    removeItem(key) {
      try {
        backing.removeItem?.(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** @returns {ReturnType<typeof createStorage>} */
export function createWebStorage(localStorageRef = globalThis.localStorage) {
  return createStorage({
    getItem: (k) => localStorageRef.getItem(k),
    setItem: (k, v) => localStorageRef.setItem(k, v),
    removeItem: (k) => localStorageRef.removeItem(k),
  });
}

/** @type {ReturnType<typeof createWebStorage> | null} */
let defaultWebStorage = null;

/** @returns {ReturnType<typeof createWebStorage>} */
export function getWebStorage() {
  if (!defaultWebStorage) defaultWebStorage = createWebStorage();
  return defaultWebStorage;
}

/** @param {ReturnType<typeof createWebStorage>} storage */
export function setDefaultWebStorage(storage) {
  defaultWebStorage = storage;
}
