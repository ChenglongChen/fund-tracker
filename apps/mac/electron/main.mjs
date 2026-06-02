
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';

app.setPath('userData', path.join(app.getPath('appData'), '@fund-tracker', 'mac'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_PORT = 8790;
const API_MODE_LOCAL = 'local';
const API_MODE_REMOTE = 'remote';

/** @type {import('node:http').Server | null} */
let apiServer = null;
/** @type {number} */
let apiPort = DEFAULT_PORT;

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readDesktopSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const data = JSON.parse(raw);
    return { apiMode: data.apiMode === API_MODE_REMOTE ? API_MODE_REMOTE : API_MODE_LOCAL };
  } catch {
    return { apiMode: API_MODE_LOCAL };
  }
}

function writeDesktopSettings(patch) {
  const current = readDesktopSettings();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

async function waitForHealth(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`API health check failed on port ${port}`);
}

async function startEmbeddedServer() {
  process.env.FUND_TRACKER_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.PORT = String(DEFAULT_PORT);
  process.env.HOST = '127.0.0.1';

  const { startFundTrackerServer } = await import(path.join(ROOT, 'server', 'index.js'));
  const started = await startFundTrackerServer({ port: DEFAULT_PORT, host: '127.0.0.1' });
  apiServer = started.server;
  apiPort = started.port;
  await waitForHealth(apiPort);
}

function createWindow(target) {
  const win = new BrowserWindow({
    width: 420,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: 'Fund Tracker',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });

  if (target.startsWith('http')) win.loadURL(target);
  else win.loadFile(target);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

function registerIpc() {
  ipcMain.handle('desktop:getApiMode', () => readDesktopSettings().apiMode);
  ipcMain.handle('desktop:saveSettings', (_evt, patch) => writeDesktopSettings(patch));
  ipcMain.handle('desktop:restart', () => {
    app.relaunch();
    app.exit(0);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  const { apiMode } = readDesktopSettings();
  if (apiMode === API_MODE_LOCAL) {
    await startEmbeddedServer();
    createWindow(`http://127.0.0.1:${apiPort}/`);
  } else {
    createWindow(path.join(ROOT, 'dist', 'index.html'));
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const mode = readDesktopSettings().apiMode;
      if (mode === API_MODE_LOCAL) createWindow(`http://127.0.0.1:${apiPort}/`);
      else createWindow(path.join(ROOT, 'dist', 'index.html'));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  apiServer?.close();
});
