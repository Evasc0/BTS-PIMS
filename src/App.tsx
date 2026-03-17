import React, { useEffect, useMemo, useState } from 'react';
import { LoginPage } from './components/LoginPage';
import { Dashboard } from './components/Dashboard';
import { ProductsPage } from './components/ProductsPage';
import { EmployeesPage } from './components/EmployeesPage';
import { ReturnsPage } from './components/ReturnsPage';
import { ReportsPage } from './components/ReportsPage';
import { ActivityLogsPage } from './components/ActivityLogsPage';
import { SettingsPage } from './components/SettingsPage';
import { ProfilePage } from './components/ProfilePage';
import { Sidebar } from './components/Sidebar';
import { LoginTransitionScreen } from './components/LoginTransitionScreen';
import { useAuth } from './lib/auth';
import type { EmployeeRole } from './lib/types';
import { applyThemePreference, getStoredThemePreference } from './lib/theme';

export default function App() {
  const {
    currentUser,
    loading,
    initError,
    logout,
    syncNotice,
    refreshAssignedUpdates,
    clearSyncNotice,
    loginIntroPending,
    completeLoginIntro
  } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const pagePermissions = useMemo<Record<string, EmployeeRole[]>>(
    () => ({
      dashboard: ['system_admin', 'employee'],
      products: ['system_admin', 'employee'],
      employees: ['system_admin'],
      returns: ['system_admin', 'employee'],
      reports: ['system_admin'],
      'activity-logs': ['system_admin'],
      settings: ['system_admin'],
      profile: ['system_admin', 'employee']
    }),
    []
  );

  useEffect(() => {
    if (!currentUser) return;
    const allowedRoles = pagePermissions[currentPage];
    if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
      setCurrentPage('dashboard');
    }
  }, [currentPage, currentUser, pagePermissions]);

  useEffect(() => {
    applyThemePreference(getStoredThemePreference(currentUser?.id));
  }, [currentUser?.id]);

  useEffect(() => {
    if (import.meta.env.DEV || !window.api?.update) return;

    const removeDownloadedListener = window.api.update.onDownloaded(() => {
      setUpdateError(null);
      setUpdateDownloaded(true);
    });
    const removeErrorListener = window.api.update.onError((message) => {
      setUpdateError(String(message || 'Failed to check for updates.'));
    });

    void window.api.update.check().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to check for updates.';
      setUpdateError(message);
    });

    return () => {
      removeDownloadedListener();
      removeErrorListener();
    };
  }, []);

  const handleInstallUpdate = async () => {
    if (!window.api?.update?.install || updateInstalling) return;
    setUpdateInstalling(true);
    setUpdateError(null);
    try {
      await window.api.update.install();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to install update.';
      setUpdateInstalling(false);
      setUpdateError(message);
    }
  };

  const updateBanner = updateDownloaded ? (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm rounded-xl border border-indigo-200 bg-white p-4 shadow-xl">
      <p className="text-sm font-semibold text-gray-900">Update Ready</p>
      <p className="mt-1 text-sm text-gray-700">A new version has been downloaded. Restart to install it.</p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setUpdateDownloaded(false)}
          disabled={updateInstalling}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => void handleInstallUpdate()}
          disabled={updateInstalling}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {updateInstalling ? 'Installing...' : 'Restart & Install'}
        </button>
      </div>
    </div>
  ) : null;

  const updateErrorBanner = updateError ? (
    <div className="fixed bottom-4 left-4 z-50 w-full max-w-sm rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg">
      <p className="text-sm text-amber-900">{updateError}</p>
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-gray-600">Loading local database...</p>
        </div>
        {updateBanner}
        {updateErrorBanner}
      </>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginPage initError={initError} />
        {updateBanner}
        {updateErrorBanner}
      </>
    );
  }

  if (loginIntroPending) {
    return (
      <>
        <LoginTransitionScreen onComplete={completeLoginIntro} />
        {updateBanner}
        {updateErrorBanner}
      </>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return (
          <Dashboard
            user={currentUser}
            syncNotice={syncNotice}
            onRefreshAssignedUpdates={refreshAssignedUpdates}
            onDismissSyncNotice={clearSyncNotice}
          />
        );
      case 'products':
        return <ProductsPage user={currentUser} />;
      case 'employees':
        return <EmployeesPage user={currentUser} />;
      case 'returns':
        return <ReturnsPage user={currentUser} />;
      case 'reports':
        return <ReportsPage user={currentUser} />;
      case 'activity-logs':
        return <ActivityLogsPage user={currentUser} />;
      case 'settings':
        return <SettingsPage user={currentUser} />;
      case 'profile':
        return <ProfilePage user={currentUser} />;
      default:
        return <Dashboard user={currentUser} onRefreshAssignedUpdates={refreshAssignedUpdates} />;
    }
  };

  return (
    <>
      <div className="flex h-screen bg-gray-50">
        <Sidebar
          user={currentUser}
          currentPage={currentPage}
          onNavigate={setCurrentPage}
          onLogout={logout}
        />
        <main className="flex-1 overflow-auto">
          {renderPage()}
        </main>
      </div>
      {updateBanner}
      {updateErrorBanner}
    </>
  );
}
