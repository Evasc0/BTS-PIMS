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
    process: (payload: { id: string; adminUserId: string; decision: 'approve' | 'reject'; reason?: string }) =>
      ipcRenderer.invoke('db:returns:process', payload),
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
  auth: {
    login: (payload: { email: string; password: string; preferOnline: boolean }) => ipcRenderer.invoke('auth:login', payload),
    provisionPending: (adminUserId: string, adminAccessToken: string) =>
      ipcRenderer.invoke('auth:provision-pending', adminUserId, adminAccessToken),
    createUser: (payload: {
      adminUserId: string;
      fullName: string;
      email: string;
      phone?: string;
      position?: string;
      department?: string;
      address?: string;
      role: 'system_admin' | 'employee';
      status: 'active' | 'inactive';
      password: string;
      location?: string;
      language?: string;
    }) => ipcRenderer.invoke('auth:create-user', payload),
    changePassword: (payload: { userId: string; currentPassword: string; newPassword: string }) =>
      ipcRenderer.invoke('auth:change-password', payload),
    logout: (userId: string) => ipcRenderer.invoke('auth:logout', userId)
  },
  migration: {
    importLegacyDump: (dump: unknown) => ipcRenderer.invoke('migration:import', dump)
  },
  sync: {
    trigger: (userId: string) => ipcRenderer.invoke('sync:trigger', userId),
    getStatus: (userId: string) => ipcRenderer.invoke('sync:get-status', userId),
    setMode: (userId: string, online: boolean) => ipcRenderer.invoke('sync:set-mode', userId, online),
    push: (userId: string, stage?: { categories?: string[]; outboxIds?: number[] }) => ipcRenderer.invoke('sync:push', userId, stage),
    viewLocalChanges: (userId: string) => ipcRenderer.invoke('sync:view-local-changes', userId),
    autoPullEmployeeSubmissions: (userId: string) => ipcRenderer.invoke('sync:auto-pull-employee-submissions', userId),
    previewPull: (userId: string) => ipcRenderer.invoke('sync:preview-pull', userId),
    pull: (userId: string, conflictStrategy: 'skip' | 'remote_wins' = 'skip') =>
      ipcRenderer.invoke('sync:pull', userId, conflictStrategy),
    fullSyncRequest: (userId: string) => ipcRenderer.invoke('sync:full:request', userId),
    fullSyncCheck: (userId: string) => ipcRenderer.invoke('sync:full:check', userId),
    fullSyncSession: (userId: string) => ipcRenderer.invoke('sync:full:session', userId),
    fullSyncPullNext: (userId: string) => ipcRenderer.invoke('sync:full:pull-next', userId),
    fullSyncAdminList: (userId: string) => ipcRenderer.invoke('sync:full:admin:list', userId),
    fullSyncAdminReview: (userId: string, requestId: string, decision: 'approve' | 'reject', reason?: string) =>
      ipcRenderer.invoke('sync:full:admin:review', userId, requestId, decision, reason),
    fullSyncAdminUploadNext: (userId: string, requestId: string) =>
      ipcRenderer.invoke('sync:full:admin:upload-next', userId, requestId)
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
