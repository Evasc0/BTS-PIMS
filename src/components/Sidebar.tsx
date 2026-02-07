import React from 'react';
import type { Employee } from '../lib/types';
import {
  LayoutDashboard,
  Package,
  Users,
  RotateCcw,
  FileText,
  History,
  Settings,
  UserCircle,
  LogOut,
  Shield,
  UserCog
} from 'lucide-react';

interface SidebarProps {
  user: Employee;
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
}

export function Sidebar({ user, currentPage, onNavigate, onLogout }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'supervisor', 'employee'] },
    { id: 'products', label: 'Products', icon: Package, roles: ['admin', 'supervisor', 'employee'] },
    { id: 'employees', label: 'Employees', icon: Users, roles: ['admin'] },
    { id: 'returns', label: 'Returns', icon: RotateCcw, roles: ['admin', 'supervisor', 'employee'] },
    { id: 'reports', label: 'Reports', icon: FileText, roles: ['admin'] },
    { id: 'activity-logs', label: 'Activity Logs', icon: History, roles: ['admin'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] },
  ];

  const getRoleColor = () => {
    switch (user.role) {
      case 'admin':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'supervisor':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'employee':
        return 'bg-green-100 text-green-700 border-green-200';
    }
  };

  const getRoleIcon = () => {
    switch (user.role) {
      case 'admin':
        return <Shield className="w-4 h-4" />;
      case 'supervisor':
        return <UserCog className="w-4 h-4" />;
      case 'employee':
        return <UserCircle className="w-4 h-4" />;
    }
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900">BTS PIMS</h1>
            <p className="text-xs text-gray-500">Property System</p>
          </div>
        </div>
        
        <div className={`px-3 py-2 rounded-lg border ${getRoleColor()} flex items-center gap-2`}>
          {getRoleIcon()}
          <span className="text-sm font-medium capitalize">{user.role}</span>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          if (!item.roles.includes(user.role)) return null;
          
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full px-4 py-3 rounded-lg flex items-center gap-3 transition ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-200 space-y-1">
        <button
          onClick={() => onNavigate('profile')}
          className={`w-full px-4 py-3 rounded-lg flex items-center gap-3 transition ${
            currentPage === 'profile'
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <UserCircle className="w-5 h-5" />
          <span>Profile</span>
        </button>
        <button
          onClick={onLogout}
          className="w-full px-4 py-3 rounded-lg flex items-center gap-3 text-red-600 hover:bg-red-50 transition"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
