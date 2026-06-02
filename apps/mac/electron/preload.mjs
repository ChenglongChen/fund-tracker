
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fundTrackerDesktop', {
  isDesktop: true,
  getApiMode: () => ipcRenderer.invoke('desktop:getApiMode'),
  saveDesktopSettings: (patch) => ipcRenderer.invoke('desktop:saveSettings', patch),
  restartApp: () => ipcRenderer.invoke('desktop:restart'),
});
