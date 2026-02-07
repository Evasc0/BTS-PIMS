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
import { useAuth } from './lib/auth';
import type { EmployeeRole } from './lib/types';

export default function App() {
  const { currentUser, loading, initError, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState('dashboard');

  const pagePermissions = useMemo<Record<string, EmployeeRole[]>>(
    () => ({
      dashboard: ['admin', 'supervisor', 'employee'],
      products: ['admin', 'supervisor', 'employee'],
      employees: ['admin'],
      returns: ['admin', 'supervisor', 'employee'],
      reports: ['admin'],
      'activity-logs': ['admin'],
      settings: ['admin'],
      profile: ['admin', 'supervisor', 'employee']
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Loading local database...</p>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage initError={initError} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard user={currentUser} />;
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
        return <Dashboard user={currentUser} />;
    }
  };

  return (
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
  );
}
