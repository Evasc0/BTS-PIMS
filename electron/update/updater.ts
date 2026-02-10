import { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export function setupAutoUpdate(mainWindow: BrowserWindow): void {
  if (process.env.ELECTRON_START_URL) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('update:downloaded');
  });

  autoUpdater.on('error', (error) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('update:error', error?.message ?? 'Update error');
  });

  autoUpdater.checkForUpdatesAndNotify();
}

export function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}

export function installUpdate() {
  autoUpdater.quitAndInstall();
}
