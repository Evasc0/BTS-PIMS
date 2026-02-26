import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db, initializeDatabase } from './db';
import type { Employee } from './types';

interface AuthContextValue {
  currentUser: Employee | null;
  loading: boolean;
  initError: string | null;
  syncNotice: string | null;
  loginIntroPending: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  refreshAssignedUpdates: () => Promise<void>;
  clearSyncNotice: () => void;
  completeLoginIntro: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const SESSION_KEY = 'bts-pims-session-user';
const readEnvMs = (key: string, fallback: number, min = 1000): number => {
  const raw = String((import.meta as any)?.env?.[key] ?? '').trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.floor(parsed);
};
const REALTIME_SYNC_POLL_MS = readEnvMs('VITE_SYNC_REALTIME_POLL_MS', 10000, 5000);
const IDLE_SYNC_AFTER_MS = readEnvMs('VITE_SYNC_IDLE_AFTER_MS', 5 * 60 * 1000, 60000);
const IDLE_SYNC_POLL_MS = readEnvMs('VITE_SYNC_IDLE_POLL_MS', 30000, 5000);
const ADMIN_SUBMISSION_PULL_MS = readEnvMs('VITE_SYNC_ADMIN_SUBMISSION_POLL_MS', 30000, 5000);
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
  const [loginIntroPending, setLoginIntroPending] = useState(false);
  const employeeSyncInFlightRef = useRef(false);
  const adminSyncInFlightRef = useRef(false);
  const lastActivityAtRef = useRef(Date.now());
  const idleSyncRef = useRef(false);
  const modeTransitionInFlightRef = useRef(false);
  const lastAdminSubmissionPullAtRef = useRef(0);

  const autoPullAssignedUpdates = async (
    user: Employee,
    options?: { silent?: boolean; skipPreview?: boolean }
  ): Promise<void> => {
    if (user.role !== 'employee' || !window.api?.sync) return;
    const silent = Boolean(options?.silent);
    const skipPreview = Boolean(options?.skipPreview);

    if (!navigator.onLine) {
      if (!silent) {
        setSyncNotice('Offline: assigned data is loaded from local storage.');
      }
      return;
    }

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured) {
        if (!silent) {
          setSyncNotice('Supabase sync is not configured. Assigned data will stay local.');
        }
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
              note += ' Full Sync request sent. Waiting for co-admin approval.';
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
            note += ' Full Sync request sent. Waiting for co-admin approval.';
          } else if (requestResult.status === 'exists') {
            note += ' Full Sync request is already pending.';
          }
        }
        setSyncNotice(note);
        return;
      }

      if (!skipPreview) {
        const preview = await window.api.sync.previewPull(user.id);
        if (preview.status === 'full_sync_required') {
          setSyncNotice(preview.error || 'Full sync required before assigned updates can be pulled.');
          return;
        }
        if (preview.status !== 'ok') {
          if (!silent) {
            setSyncNotice(preview.error || 'Unable to check assigned updates.');
          }
          return;
        }

        if (preview.newRecords === 0) {
          if (!silent) {
            setSyncNotice(preview.message || 'Assigned data is up to date.');
          }
          return;
        }
      }

      const result = await window.api.sync.pull(user.id, 'skip');
      if (result.status === 'idle') {
        if (!silent) {
          setSyncNotice('Assigned data is up to date.');
        }
        return;
      }

      if (result.status === 'synced') {
        if (!silent || result.pulledCount > 0) {
          setSyncNotice(`Synced ${result.pulledCount} assigned update(s).`);
        }
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

      if (!silent) {
        setSyncNotice(result.error || 'Assigned updates were found but could not be pulled.');
      }
    } catch (error: any) {
      if (!silent) {
        setSyncNotice(error?.message || 'Automatic assigned pull failed.');
      }
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
      if (Number(status.pendingLocalChanges || 0) === 0) return;
      await window.api.sync.push(user.id);
    } catch {
      // keep silent for background push
    }
  };

  const autoSyncAdmin = async (user: Employee, options?: { silent?: boolean }): Promise<void> => {
    if (user.role !== 'system_admin' || !window.api?.sync) return;
    if (!navigator.onLine) return;
    const silent = Boolean(options?.silent);

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured) return;

      if (status.mode !== 'online') {
        status = await window.api.sync.setMode(user.id, true);
      }

      if (status.fullSyncRequired) {
        if (!silent) {
          setSyncNotice(status.fullSyncReason || 'Full sync is required before automatic admin sync can continue.');
        }
        return;
      }

      let lastStepError: string | null = null;
      let pushFailed = false;

      if (Number(status.pendingLocalChanges || 0) > 0) {
        try {
          await window.api.sync.push(user.id);
        } catch (error: any) {
          lastStepError = error?.message || 'Automatic admin push failed.';
          pushFailed = true;
        }
      }

      if (!pushFailed) {
        try {
          await window.api.sync.pull(user.id, 'skip');
        } catch (error: any) {
          lastStepError = error?.message || 'Automatic admin pull failed.';
        }
      }

      const nowMs = Date.now();
      const shouldPullEmployeeSubmissions = nowMs - lastAdminSubmissionPullAtRef.current >= ADMIN_SUBMISSION_PULL_MS;
      if (window.api.sync.autoPullEmployeeSubmissions && shouldPullEmployeeSubmissions) {
        try {
          await window.api.sync.autoPullEmployeeSubmissions(user.id);
          lastAdminSubmissionPullAtRef.current = nowMs;
        } catch (error: any) {
          lastStepError = error?.message || 'Automatic employee-submission pull failed.';
        }
      }

      if (!silent && lastStepError) {
        setSyncNotice(lastStepError);
      }
    } catch (error: any) {
      if (!silent) {
        setSyncNotice(error?.message || 'Automatic admin sync failed.');
      }
    }
  };

  const runEmployeeRealtimeSync = async (
    user: Employee,
    options?: { silent?: boolean; skipPreview?: boolean }
  ): Promise<void> => {
    if (employeeSyncInFlightRef.current) return;
    employeeSyncInFlightRef.current = true;
    try {
      await autoPushEmployeeSubmissions(user);
      await autoPullAssignedUpdates(user, options);
    } finally {
      employeeSyncInFlightRef.current = false;
    }
  };

  const runAdminRealtimeSync = async (user: Employee, options?: { silent?: boolean }): Promise<void> => {
    if (adminSyncInFlightRef.current) return;
    adminSyncInFlightRef.current = true;
    try {
      await autoSyncAdmin(user, options);
    } finally {
      adminSyncInFlightRef.current = false;
    }
  };

  const setAutomaticSyncMode = async (user: Employee, online: boolean): Promise<void> => {
    if (!window.api?.sync) return;
    if (modeTransitionInFlightRef.current) return;
    modeTransitionInFlightRef.current = true;
    try {
      const status = await window.api.sync.getStatus(user.id);
      if (!status.configured) return;
      if ((status.mode === 'online') === online) return;
      await window.api.sync.setMode(user.id, online);
    } catch {
      // mode transitions are best-effort for background idle handling
    } finally {
      modeTransitionInFlightRef.current = false;
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
              await runEmployeeRealtimeSync(user, { skipPreview: true });
            } else if (user.role === 'system_admin') {
              await runAdminRealtimeSync(user);
            }
            if (isMounted) setCurrentUser(user);
          } else {
            localStorage.removeItem(SESSION_KEY);
            if (isMounted) setLoginIntroPending(false);
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
        setLoginIntroPending(false);
        setCurrentUser(null);
        setSyncNotice(null);
        setInitError('Your account has been deactivated. Contact administrator.');
        return;
      }

      const previousEmail = String(currentUser.email || '').trim().toLowerCase();
      const latestEmail = String(latest.email || '').trim().toLowerCase();
      const emailChanged = latestEmail !== previousEmail;
      const previousCredentialUpdatedAt = String(currentUser.credentialUpdatedAt || '').trim();
      const latestCredentialUpdatedAt = String(latest.credentialUpdatedAt || '').trim();
      const credentialsChanged = Boolean(latestCredentialUpdatedAt && latestCredentialUpdatedAt !== previousCredentialUpdatedAt);
      if (emailChanged || credentialsChanged) {
        if (window.api?.auth) {
          void window.api.auth.logout(currentUser.id);
        }
        localStorage.removeItem(SESSION_KEY);
        setLoginIntroPending(false);
        setCurrentUser(null);
        setSyncNotice(null);
        setInitError('Your credentials were updated. Please sign in again with your latest email/password.');
        return;
      }
      setCurrentUser(latest);
    });
    return unsubscribe;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !window.api?.sync) return;
    const onOnline = () => {
      if (idleSyncRef.current) return;
      if (currentUser.role === 'employee') {
        void runEmployeeRealtimeSync(currentUser, { skipPreview: true });
      } else if (currentUser.role === 'system_admin') {
        void runAdminRealtimeSync(currentUser);
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !window.api?.sync) return;

    const markActive = () => {
      lastActivityAtRef.current = Date.now();
    };

    const wakeSyncIfIdle = () => {
      const wasIdle = idleSyncRef.current;
      markActive();
      if (!wasIdle || !navigator.onLine) return;
      idleSyncRef.current = false;
      void (async () => {
        await setAutomaticSyncMode(currentUser, true);
        if (currentUser.role === 'employee') {
          await runEmployeeRealtimeSync(currentUser, { silent: true, skipPreview: true });
        } else if (currentUser.role === 'system_admin') {
          await runAdminRealtimeSync(currentUser, { silent: true });
        }
      })();
    };

    const onVisibility = () => {
      if (document.hidden) return;
      wakeSyncIfIdle();
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'scroll', 'focus'];
    for (const eventName of events) {
      window.addEventListener(eventName, wakeSyncIfIdle, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    markActive();

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, wakeSyncIfIdle);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!currentUser || !window.api?.sync) return;

    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (disposed) return;

      const idleForMs = Date.now() - lastActivityAtRef.current;
      const isIdle = idleForMs >= IDLE_SYNC_AFTER_MS;
      const wasIdle = idleSyncRef.current;
      idleSyncRef.current = isIdle;
      const intervalMs = isIdle ? IDLE_SYNC_POLL_MS : REALTIME_SYNC_POLL_MS;

      if (isIdle) {
        if (!wasIdle && navigator.onLine) {
          await setAutomaticSyncMode(currentUser, false);
        }
        schedule(intervalMs);
        return;
      }

      if (!navigator.onLine) {
        schedule(intervalMs);
        return;
      }

      if (currentUser.role === 'employee') {
        await runEmployeeRealtimeSync(currentUser, { silent: true, skipPreview: true });
      } else if (currentUser.role === 'system_admin') {
        await runAdminRealtimeSync(currentUser, { silent: true });
      }

      schedule(intervalMs);
    };

    void tick();

    return () => {
      disposed = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [currentUser?.id, currentUser?.role]);

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
      await runEmployeeRealtimeSync(user, { skipPreview: true });
    } else if (user.role === 'system_admin') {
      await runAdminRealtimeSync(user);
    }

    localStorage.setItem(SESSION_KEY, user.id);
    setInitError(null);
    setLoginIntroPending(true);
    setCurrentUser(user);
    return { success: true };
  };

  const completeLoginIntro = useCallback(() => {
    setLoginIntroPending(false);
  }, []);

  const logout = () => {
    if (currentUser && window.api?.auth) {
      void window.api.auth.logout(currentUser.id);
    }
    localStorage.removeItem(SESSION_KEY);
    setSyncNotice(null);
    setLoginIntroPending(false);
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
      await runEmployeeRealtimeSync(currentUser, { skipPreview: true });
      await refreshUser();
      return;
    }

    if (currentUser.role === 'system_admin') {
      await runAdminRealtimeSync(currentUser);
      await refreshUser();
    }
  };

  const clearSyncNotice = () => setSyncNotice(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      loading,
      initError,
      syncNotice,
      loginIntroPending,
      login,
      logout,
      refreshUser,
      refreshAssignedUpdates,
      clearSyncNotice,
      completeLoginIntro
    }),
    [currentUser, loading, initError, syncNotice, loginIntroPending, completeLoginIntro]
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
