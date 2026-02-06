import React, { useState } from 'react';
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

export type UserRole = 'administrator' | 'employee';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  assignedProducts?: string[];
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setCurrentPage('dashboard');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentPage('dashboard');
  };

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
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
        onLogout={handleLogout}
      />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
    </div>
  );
}