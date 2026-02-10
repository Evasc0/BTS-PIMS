import { app, BrowserWindow, ipcMain } from 'electron';
import { dataStore } from '../db';
import { syncNow } from '../sync/syncService';
import { checkForUpdates, installUpdate } from '../update/updater';

export function registerIpc(mainWindow: BrowserWindow): void {
  const notify = (table: string, ids: string[]) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('db:changed', { table, ids });
  };

  ipcMain.handle('db:initialize', () => dataStore.initialize());

  ipcMain.handle('db:employees:list', () => dataStore.employees.list());
  ipcMain.handle('db:employees:count', () => dataStore.employees.count());
  ipcMain.handle('db:employees:get', (_evt, id) => dataStore.employees.get(id));
  ipcMain.handle('db:employees:findBy', (_evt, field, value) => dataStore.employees.findBy(field, value));
  ipcMain.handle('db:employees:add', (_evt, record) => {
    dataStore.employees.add(record);
    notify('employees', [record.id]);
  });
  ipcMain.handle('db:employees:update', (_evt, id, changes) => {
    dataStore.employees.update(id, changes);
    notify('employees', [id]);
  });
  ipcMain.handle('db:employees:delete', (_evt, id) => {
    dataStore.employees.remove(id);
    notify('employees', [id]);
  });

  ipcMain.handle('db:products:list', () => dataStore.products.list());
  ipcMain.handle('db:products:get', (_evt, id) => dataStore.products.get(id));
  ipcMain.handle('db:products:findBy', (_evt, field, value) => dataStore.products.findBy(field, value));
  ipcMain.handle('db:products:add', (_evt, record) => {
    dataStore.products.add(record);
    notify('products', [record.id]);
  });
  ipcMain.handle('db:products:update', (_evt, id, changes) => {
    dataStore.products.update(id, changes);
    notify('products', [id]);
  });
  ipcMain.handle('db:products:delete', (_evt, id) => {
    dataStore.products.remove(id);
    notify('products', [id]);
  });

  ipcMain.handle('db:returns:list', () => dataStore.returns.list());
  ipcMain.handle('db:returns:get', (_evt, id) => dataStore.returns.get(id));
  ipcMain.handle('db:returns:findBy', (_evt, field, value) => {
    if (field === 'id') return dataStore.returns.get(value);
    return undefined;
  });
  ipcMain.handle('db:returns:add', (_evt, record) => {
    dataStore.returns.add(record);
    notify('returns', [record.id]);
  });
  ipcMain.handle('db:returns:update', (_evt, id, changes) => {
    dataStore.returns.update(id, changes);
    notify('returns', [id]);
  });
  ipcMain.handle('db:returns:delete', (_evt, id) => {
    dataStore.returns.remove(id);
    notify('returns', [id]);
  });

  ipcMain.handle('db:activityLogs:list', () => dataStore.activityLogs.list());
  ipcMain.handle('db:activityLogs:get', (_evt, id) => dataStore.activityLogs.get(id));
  ipcMain.handle('db:activityLogs:add', (_evt, record) => {
    dataStore.activityLogs.add(record);
    notify('activity_logs', [record.id]);
  });

  ipcMain.handle('db:settings:get', (_evt, id) => dataStore.settings.get(id));
  ipcMain.handle('db:settings:put', (_evt, record) => {
    dataStore.settings.put(record);
    notify('settings', [record.id]);
  });
  ipcMain.handle('db:settings:list', () => dataStore.settings.list());
  ipcMain.handle('db:settings:add', (_evt, record) => {
    dataStore.settings.put(record);
    notify('settings', [record.id]);
  });
  ipcMain.handle('db:settings:update', (_evt, id, changes) => {
    const current = dataStore.settings.get(id);
    if (!current) return;
    dataStore.settings.put({ ...current, ...changes });
    notify('settings', [id]);
  });
  ipcMain.handle('db:settings:delete', () => undefined);
  ipcMain.handle('db:settings:findBy', (_evt, field, value) => {
    if (field === 'id') return dataStore.settings.get(value);
    return undefined;
  });

  ipcMain.handle('migration:import', (_evt, dump) => {
    dataStore.importLegacyDump(dump);
    notify('migration', []);
  });

  ipcMain.handle('sync:trigger', () => syncNow());

  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => installUpdate());

  ipcMain.handle('system:version', () => app.getVersion());
}
