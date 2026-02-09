import { contextBridge, ipcRenderer } from 'electron';

const dbApi = {
  initialize: () => ipcRenderer.invoke('db:initialize'),
  onChanged: (callback: (payload: { table: string; ids: string[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { table: string; ids: string[] }) => callback(payload);
    ipcRenderer.on('db:changed', handler);
    return () => ipcRenderer.removeListener('db:changed', handler);
  },
  employees: {
    list: () => ipcRenderer.invoke('db:employees:list'),
    get: (id: string) => ipcRenderer.invoke('db:employees:get', id),
    add: (record: unknown) => ipcRenderer.invoke('db:employees:add', record),
    update: (id: string, changes: unknown) => ipcRenderer.invoke('db:employees:update', id, changes),
    delete: (id: string) => ipcRenderer.invoke('db:employees:delete', id),
    findBy: (field: string, value: unknown) => ipcRenderer.invoke('db:employees:findBy', field, value),
    count: () => ipcRenderer.invoke('db:employees:count')
  },
  products: {
    list: () => ipcRenderer.invoke('db:products:list'),
    get: (id: string) => ipcRenderer.invoke('db:products:get', id),
    add: (record: unknown) => ipcRenderer.invoke('db:products:add', record),
    update: (id: string, changes: unknown) => ipcRenderer.invoke('db:products:update', id, changes),
    delete: (id: string) => ipcRenderer.invoke('db:products:delete', id),
    findBy: (field: string, value: unknown) => ipcRenderer.invoke('db:products:findBy', field, value)
  },
  returns: {
    list: () => ipcRenderer.invoke('db:returns:list'),
    get: (id: string) => ipcRenderer.invoke('db:returns:get', id),
    add: (record: unknown) => ipcRenderer.invoke('db:returns:add', record),
    update: (id: string, changes: unknown) => ipcRenderer.invoke('db:returns:update', id, changes),
    delete: (id: string) => ipcRenderer.invoke('db:returns:delete', id),
    findBy: (field: string, value: unknown) => ipcRenderer.invoke('db:returns:findBy', field, value)
  },
  activityLogs: {
    list: () => ipcRenderer.invoke('db:activityLogs:list'),
    get: (id: string) => ipcRenderer.invoke('db:activityLogs:get', id),
    add: (record: unknown) => ipcRenderer.invoke('db:activityLogs:add', record)
  },
  settings: {
    get: (id: string) => ipcRenderer.invoke('db:settings:get', id),
    put: (record: unknown) => ipcRenderer.invoke('db:settings:put', record),
    list: () => ipcRenderer.invoke('db:settings:list'),
    add: (record: unknown) => ipcRenderer.invoke('db:settings:add', record),
    update: (id: string, changes: unknown) => ipcRenderer.invoke('db:settings:update', id, changes),
    delete: (id: string) => ipcRenderer.invoke('db:settings:delete', id),
    findBy: (field: string, value: unknown) => ipcRenderer.invoke('db:settings:findBy', field, value)
  }
};

contextBridge.exposeInMainWorld('api', {
  db: dbApi,
  migration: {
    importLegacyDump: (dump: unknown) => ipcRenderer.invoke('migration:import', dump)
  },
  sync: {
    trigger: () => ipcRenderer.invoke('sync:trigger')
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onDownloaded: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.removeListener('update:downloaded', handler);
    },
    onError: (callback: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
      ipcRenderer.on('update:error', handler);
      return () => ipcRenderer.removeListener('update:error', handler);
    }
  },
  system: {
    version: () => ipcRenderer.invoke('system:version')
  }
});
