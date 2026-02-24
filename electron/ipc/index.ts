import { createHash } from 'crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import { dataStore } from '../db';
import { authService as importedAuthService } from '../auth/authService';
import {
  autoPullEmployeeSubmissions,
  checkPendingFullSyncRequest,
  confirmFullSyncRequest,
  clearSyncActorAccessToken,
  getFullSyncSession,
  getLocalChanges,
  getSyncStatus,
  listFullSyncRequests,
  previewRemoteChanges,
  pullNextFullSyncChunk,
  pullRemoteChanges,
  pushLocalChanges,
  requestFullSync,
  reviewFullSyncRequest,
  setSyncActorAccessToken,
  setOnlineMode,
  syncNow,
  uploadNextFullSyncChunk
} from '../sync/syncService';
import { checkForUpdates, installUpdate } from '../update/updater';

type AuthServiceApi = typeof importedAuthService;

const resolveAuthService = (): AuthServiceApi => {
  if (importedAuthService) return importedAuthService;
  try {
    const runtimeModule = require('../auth/authService') as { authService?: AuthServiceApi };
    if (runtimeModule?.authService) {
      return runtimeModule.authService;
    }
  } catch {
    // fall through to consistent error
  }
  throw new Error('Auth service failed to initialize. Restart the app and try again.');
};

export function registerIpc(mainWindow: BrowserWindow): void {
  const sanitizeEmployeeForRenderer = <T extends Record<string, any> | null | undefined>(employee: T): T => {
    if (!employee || typeof employee !== 'object') return employee;
    const output = { ...employee } as Record<string, any>;
    const passwordHash = String(output.passwordHash || '');
    const passwordSalt = String(output.passwordSalt || '');
    output.credentialFingerprint =
      passwordHash || passwordSalt
        ? createHash('sha256').update(`${passwordHash}:${passwordSalt}`).digest('hex')
        : undefined;
    delete output.passwordHash;
    delete output.passwordSalt;
    delete output.pendingPasswordPlain;
    delete output.pendingPasswordEncrypted;
    delete output.hashedSessionToken;
    delete output.authLastError;
    return output as T;
  };

  const resolveSyncActor = (userId: string) => {
    if (!userId) {
      throw new Error('Missing user id for sync operation.');
    }

    const user = dataStore.employees.get(userId);
    if (!user || user.status !== 'active') {
      throw new Error('Invalid or inactive user for sync operation.');
    }

    return { userId: user.id, role: user.role as 'system_admin' | 'employee' };
  };

  const notify = (table: string, ids: string[]) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('db:changed', { table, ids });
  };
  const notifyInventoryRefresh = () => {
    notify('employees', []);
    notify('products', []);
    notify('returns', []);
  };

  ipcMain.handle('db:initialize', () => dataStore.initialize());

  ipcMain.handle('db:employees:list', () => dataStore.employees.list().map((employee) => sanitizeEmployeeForRenderer(employee)));
  ipcMain.handle('db:employees:count', () => dataStore.employees.count());
  ipcMain.handle('db:employees:get', (_evt, id) => sanitizeEmployeeForRenderer(dataStore.employees.get(id)));
  ipcMain.handle('db:employees:findBy', (_evt, field, value) => sanitizeEmployeeForRenderer(dataStore.employees.findBy(field, value)));
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
  ipcMain.handle(
    'db:returns:process',
    (
      _evt,
      payload: { id: string; adminUserId: string; decision: 'approve' | 'reject'; reason?: string }
    ) => {
      const result = dataStore.returns.processDecision(payload);
      notify('returns', [payload.id]);
      if (result?.product?.id) {
        notify('products', [result.product.id]);
      }
      return result;
    }
  );
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

  ipcMain.handle(
    'auth:login',
    async (
      _evt,
      payload: {
        email: string;
        password: string;
        preferOnline: boolean;
      }
    ) => {
      const authService = resolveAuthService();
      const result = await authService.loginOfflineFirst(payload);
      if (result.success && result.verifiedOnline && result.sessionAccessToken) {
        setSyncActorAccessToken(result.userId, result.sessionAccessToken, result.sessionAccessTokenExpiresAt || null);
      }
      if (result.success && Object.prototype.hasOwnProperty.call(result, 'sessionAccessToken')) {
        delete (result as any).sessionAccessToken;
      }
      if (result.success && Object.prototype.hasOwnProperty.call(result, 'sessionAccessTokenExpiresAt')) {
        delete (result as any).sessionAccessTokenExpiresAt;
      }
      return result;
    }
  );

  ipcMain.handle('auth:provision-pending', async (_evt, adminUserId: string, adminAccessToken: string) => {
    const authService = resolveAuthService();
    return authService.provisionPendingEmployees({ adminUserId, adminAccessToken });
  });

  ipcMain.handle(
    'auth:create-user',
    async (
      _evt,
      payload: {
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
      }
    ) => {
      const authService = resolveAuthService();
      const result = await authService.createUserInstant(payload);
      if (result.success && result.employeeId) {
        notify('employees', [result.employeeId]);
      }
      return result;
    }
  );

  ipcMain.handle(
    'auth:change-password',
    async (
      _evt,
      payload: {
        userId: string;
        currentPassword: string;
        newPassword: string;
      }
    ) => {
      const authService = resolveAuthService();
      const result = await authService.changeOwnPassword(payload);
      if (result.success) {
        setSyncActorAccessToken(payload.userId, result.accessToken, result.expiresAt || null);
        notify('employees', [payload.userId]);
      }
      const sanitized = { ...result } as any;
      delete sanitized.accessToken;
      delete sanitized.expiresAt;
      return sanitized;
    }
  );

  ipcMain.handle(
    'auth:change-email',
    async (
      _evt,
      payload: {
        userId: string;
        newEmail: string;
      }
    ) => {
      const authService = resolveAuthService();
      const result = await authService.changeOwnEmail(payload);
      if (result.success) {
        notify('employees', [payload.userId]);
      }
      return result;
    }
  );

  ipcMain.handle(
    'auth:admin-update-email',
    async (
      _evt,
      payload: {
        adminUserId: string;
        targetEmployeeId: string;
        newEmail: string;
      }
    ) => {
      const authService = resolveAuthService();
      const result = await authService.adminUpdateEmployeeEmail(payload);
      if (result.success) {
        notify('employees', [payload.targetEmployeeId]);
      }
      return result;
    }
  );

  ipcMain.handle(
    'auth:admin-reset-password',
    async (
      _evt,
      payload: {
        adminUserId: string;
        targetEmployeeId: string;
        newPassword: string;
      }
    ) => {
      const authService = resolveAuthService();
      const result = await authService.adminResetEmployeePassword(payload);
      if (result.success) {
        notify('employees', [payload.targetEmployeeId]);
      }
      return result;
    }
  );

  ipcMain.handle('auth:logout', (_evt, userId: string) => {
    if (userId) {
      const authService = resolveAuthService();
      authService.clearLocalSessionCache(userId);
      clearSyncActorAccessToken(userId);
    }
    return true;
  });

  ipcMain.handle('sync:trigger', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    const result = await syncNow(actor);
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:get-status', (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    return getSyncStatus(actor);
  });
  ipcMain.handle('sync:set-mode', (_evt, userId: string, online: boolean) => {
    const actor = resolveSyncActor(userId);
    const result = setOnlineMode(actor, Boolean(online));
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:push', async (_evt, userId: string, stage?: { categories?: string[]; outboxIds?: number[] }) => {
    const actor = resolveSyncActor(userId);
    const result = await pushLocalChanges(actor, stage);
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:view-local-changes', (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    return getLocalChanges(actor);
  });
  ipcMain.handle('sync:auto-pull-employee-submissions', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    const result = await autoPullEmployeeSubmissions(actor);
    if (result.status === 'synced' || result.status === 'conflict' || result.status === 'idle') {
      notifyInventoryRefresh();
    }
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:preview-pull', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    return previewRemoteChanges(actor);
  });
  ipcMain.handle('sync:pull', async (_evt, userId: string, conflictStrategy: 'skip' | 'remote_wins' = 'skip') => {
    const actor = resolveSyncActor(userId);
    const result = await pullRemoteChanges(actor, conflictStrategy);
    if (result.status === 'synced' || result.status === 'conflict' || result.status === 'idle') {
      notifyInventoryRefresh();
    }
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:full:request', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    const result = await requestFullSync(actor);
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:full:check', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    return checkPendingFullSyncRequest(actor);
  });
  ipcMain.handle('sync:full:session', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    return getFullSyncSession(actor);
  });
  ipcMain.handle('sync:full:confirm', async (_evt, userId: string, requestId: string, decision: 'confirm' | 'cancel' = 'confirm') => {
    const actor = resolveSyncActor(userId);
    const result = await confirmFullSyncRequest(actor, requestId, decision);
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:full:pull-next', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    const result = await pullNextFullSyncChunk(actor);
    if (result.status === 'pulled' || result.status === 'completed') {
      notifyInventoryRefresh();
    }
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });
  ipcMain.handle('sync:full:admin:list', async (_evt, userId: string) => {
    const actor = resolveSyncActor(userId);
    return listFullSyncRequests(actor);
  });
  ipcMain.handle(
    'sync:full:admin:review',
    async (_evt, userId: string, requestId: string, decision: 'approve' | 'reject', reason?: string) => {
      const actor = resolveSyncActor(userId);
      const result = await reviewFullSyncRequest(actor, requestId, decision, reason);
      notify('sync_state', [`sync:${actor.userId}`]);
      return result;
    }
  );
  ipcMain.handle('sync:full:admin:upload-next', async (_evt, userId: string, requestId: string) => {
    const actor = resolveSyncActor(userId);
    const result = await uploadNextFullSyncChunk(actor, requestId);
    notify('sync_state', [`sync:${actor.userId}`]);
    return result;
  });

  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => installUpdate());

  ipcMain.handle('system:version', () => app.getVersion());
}
