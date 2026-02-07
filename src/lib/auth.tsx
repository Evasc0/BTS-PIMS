import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { db, initializeDatabase } from './db';
import type { Employee } from './types';
import { verifyPassword } from './security';

interface AuthContextValue {
  currentUser: Employee | null;
  loading: boolean;
  initError: string | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const SESSION_KEY = 'bts-pims-session-user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        await initializeDatabase();
        const sessionUserId = localStorage.getItem(SESSION_KEY);
        if (sessionUserId) {
          const user = await db.employees.get(sessionUserId);
          if (user && user.status === 'active') {
            if (isMounted) setCurrentUser(user);
          } else {
            localStorage.removeItem(SESSION_KEY);
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

  const login = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return { success: false, error: 'Email and password are required.' };
    }
    const user = await db.employees.where('email').equals(normalizedEmail).first();
    if (!user) {
      return { success: false, error: 'Invalid email or password.' };
    }
    if (user.status !== 'active') {
      return { success: false, error: 'Account is inactive. Contact an administrator.' };
    }
    const valid = await verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!valid) {
      return { success: false, error: 'Invalid email or password.' };
    }
    localStorage.setItem(SESSION_KEY, user.id);
    setCurrentUser(user);
    return { success: true };
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setCurrentUser(null);
  };

  const refreshUser = async () => {
    if (!currentUser) return;
    const updated = await db.employees.get(currentUser.id);
    if (updated) {
      setCurrentUser(updated);
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({ currentUser, loading, initError, login, logout, refreshUser }),
    [currentUser, loading, initError]
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
