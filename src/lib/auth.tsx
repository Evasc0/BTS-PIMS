import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { db, initializeDatabase } from './db';
import type { Employee } from './types';

interface AuthContextValue {
  currentUser: Employee | null;
  loading: boolean;
  initError: string | null;
  syncNotice: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  refreshAssignedUpdates: () => Promise<void>;
  clearSyncNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const SESSION_KEY = 'bts-pims-session-user';
const parseDateMs = (value?: string): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isVerificationExpired = (user: Employee): boolean => {
  const expiryMs = parseDateMs(user.verificationExpiresAt);
  if (expiryMs == null) return true;
  return expiryMs < Date.now();
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const autoPullAssignedUpdates = async (user: Employee): Promise<void> => {
    if (user.role !== 'employee' || !window.api?.sync) return;

    if (!navigator.onLine) {
      setSyncNotice('Offline: assigned data is loaded from local storage.');
      return;
    }

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured) {
        setSyncNotice('Supabase sync is not configured. Assigned data will stay local.');
        return;
      }
      if (status.mode !== 'online') {
        const modeResult = await window.api.sync.setMode(user.id, true);
        status = modeResult;
        if (modeResult.fullSyncRequired) {
          let note = modeResult.fullSyncReason || 'Full sync required before assigned updates can be pulled.';
          if (window.api?.sync?.fullSyncRequest) {
            const requestResult = await window.api.sync.fullSyncRequest(user.id);
            if (requestResult.status === 'requested') {
              note += ' Full Sync request sent. Waiting for Master approval.';
            } else if (requestResult.status === 'exists') {
              note += ' Full Sync request is already pending.';
            }
          }
          setSyncNotice(note);
          return;
        }
      }

      if (status.fullSyncRequired) {
        let note = status.fullSyncReason || 'Full sync required before assigned updates can be pulled.';
        if (window.api?.sync?.fullSyncRequest) {
          const requestResult = await window.api.sync.fullSyncRequest(user.id);
          if (requestResult.status === 'requested') {
            note += ' Full Sync request sent. Waiting for Master approval.';
          } else if (requestResult.status === 'exists') {
            note += ' Full Sync request is already pending.';
          }
        }
        setSyncNotice(note);
        return;
      }

      const preview = await window.api.sync.previewPull(user.id);
      if (preview.status === 'full_sync_required') {
        setSyncNotice(preview.error || 'Full sync required before assigned updates can be pulled.');
        return;
      }
      if (preview.status !== 'ok') {
        setSyncNotice(preview.error || 'Unable to check assigned updates.');
        return;
      }

      if (preview.newRecords === 0) {
        setSyncNotice(preview.message || 'Assigned data is up to date.');
        return;
      }

      const result = await window.api.sync.pull(user.id, 'remote_wins');
      if (result.status === 'synced' || result.status === 'idle') {
        setSyncNotice(`Synced ${result.pulledCount} assigned update(s).`);
        return;
      }

      if (result.status === 'conflict') {
        setSyncNotice(`Synced ${result.pulledCount} assigned update(s). ${result.conflictCount} conflict(s) resolved.`);
        return;
      }

      if (result.status === 'full_sync_required') {
        setSyncNotice(result.error || 'Full sync required before assigned updates can be pulled.');
        return;
      }

      setSyncNotice(result.error || 'Assigned updates were found but could not be pulled.');
    } catch (error: any) {
      setSyncNotice(error?.message || 'Automatic assigned pull failed.');
    }
  };

  const autoPushEmployeeSubmissions = async (user: Employee): Promise<void> => {
    if (user.role !== 'employee' || !window.api?.sync) return;
    if (!navigator.onLine) return;

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured) return;

      if (status.mode !== 'online') {
        status = await window.api.sync.setMode(user.id, true);
      }

      if (status.fullSyncRequired) return;
      await window.api.sync.push(user.id);
    } catch {
      // keep silent for background push
    }
  };

  const autoPullEmployeeSubmissionsForAdmin = async (user: Employee): Promise<void> => {
    if (user.role !== 'system_admin' || !window.api?.sync?.autoPullEmployeeSubmissions) return;
    if (!navigator.onLine) return;

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured || status.fullSyncRequired) return;

      if (status.mode !== 'online') {
        status = await window.api.sync.setMode(user.id, true);
      }

      if (status.fullSyncRequired) return;
      await window.api.sync.autoPullEmployeeSubmissions(user.id);
    } catch {
      // keep silent for background admin pull
    }
  };

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        await initializeDatabase();
        const sessionUserId = localStorage.getItem(SESSION_KEY);
        if (sessionUserId) {
          const user = await db.employees.get(sessionUserId);
          if (user && user.status === 'active' && !isVerificationExpired(user)) {
            if (user.role === 'employee') {
              await autoPushEmployeeSubmissions(user);
              await autoPullAssignedUpdates(user);
            } else if (user.role === 'system_admin') {
              await autoPullEmployeeSubmissionsForAdmin(user);
            }
            if (isMounted) setCurrentUser(user);
          } else {
            localStorage.removeItem(SESSION_KEY);
            if (user && user.status === 'active' && isVerificationExpired(user) && isMounted) {
              setInitError('Session expired. Sign in online to verify your account.');
            }
          }
        }
      } catch (error) {
        if (isMounted) {
          setInitError('Failed to initialize local database.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    init();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUser || !window.api?.db?.onChanged) return;
    const unsubscribe = window.api.db.onChanged(async (payload) => {
      if (payload.table !== 'employees') return;
      const latest = await db.employees.get(currentUser.id);
      if (!latest || latest.status !== 'active') {
        localStorage.removeItem(SESSION_KEY);
        setCurrentUser(null);
        setSyncNotice(null);
        setInitError('Your account has been deactivated. Contact administrator.');
        return;
      }
      setCurrentUser(latest);
    });
    return unsubscribe;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !window.api?.sync) return;
    const onOnline = () => {
      if (currentUser.role === 'employee') {
        void autoPushEmployeeSubmissions(currentUser);
        void autoPullAssignedUpdates(currentUser);
      } else if (currentUser.role === 'system_admin') {
        void autoPullEmployeeSubmissionsForAdmin(currentUser);
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [currentUser]);

  const login = async (email: string, password: string) => {
    setSyncNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return { success: false, error: 'Email and password are required.' };
    }

    if (!window.api?.auth) {
      return { success: false, error: 'Authentication API is unavailable.' };
    }

    const result = await window.api.auth.login({
      email: normalizedEmail,
      password,
      preferOnline: navigator.onLine
    });

    if (!result.success || !result.userId) {
      return { success: false, error: result.error || 'Unable to sign in.' };
    }

    const user = await db.employees.get(result.userId);
    if (!user) {
      return { success: false, error: 'User profile was not found locally.' };
    }

    if (user.status !== 'active') {
      return { success: false, error: 'Your account has been deactivated. Contact administrator.' };
    }

    if (result.verifiedOnline && result.provisioning) {
      if (result.provisioning.failed > 0) {
        setSyncNotice(
          `Online verified. Employee provisioning synced ${result.provisioning.synced}/${result.provisioning.processed}. ${result.provisioning.failed} failed.`
        );
      } else if (result.provisioning.processed > 0) {
        setSyncNotice(`Online verified. Employee provisioning synced ${result.provisioning.synced} account(s).`);
      }
    }

    if (user.role === 'employee') {
      await autoPushEmployeeSubmissions(user);
      await autoPullAssignedUpdates(user);
    } else if (user.role === 'system_admin') {
      await autoPullEmployeeSubmissionsForAdmin(user);
    }

    localStorage.setItem(SESSION_KEY, user.id);
    setInitError(null);
    setCurrentUser(user);
    return { success: true };
  };

  const logout = () => {
    if (currentUser && window.api?.auth) {
      void window.api.auth.logout(currentUser.id);
    }
    localStorage.removeItem(SESSION_KEY);
    setSyncNotice(null);
    setCurrentUser(null);
  };

  const refreshUser = async () => {
    if (!currentUser) return;
    const updated = await db.employees.get(currentUser.id);
    if (updated) {
      setCurrentUser(updated);
    }
  };

  const refreshAssignedUpdates = async () => {
    if (!currentUser) return;

    if (currentUser.role === 'employee') {
      setSyncNotice('Refreshing assigned updates...');
      await autoPullAssignedUpdates(currentUser);
      await refreshUser();
      return;
    }

    if (currentUser.role === 'system_admin') {
      await autoPullEmployeeSubmissionsForAdmin(currentUser);
      await refreshUser();
    }
  };

  const clearSyncNotice = () => setSyncNotice(null);

  const value = useMemo<AuthContextValue>(
    () => ({ currentUser, loading, initError, syncNotice, login, logout, refreshUser, refreshAssignedUpdates, clearSyncNotice }),
    [currentUser, loading, initError, syncNotice]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
