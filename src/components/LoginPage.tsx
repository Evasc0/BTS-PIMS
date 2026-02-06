import React, { useState } from 'react';
import { User, UserRole } from '../App';
import { LogIn, Shield, Users, UserCircle } from 'lucide-react';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

// Mock users for demo
const mockUsers = {
  admin: {
    id: '1',
    name: 'John Admin',
    email: 'admin@company.com',
    role: 'administrator' as UserRole,
  },
  employee: {
    id: '3',
    name: 'Mike Employee',
    email: 'employee@company.com',
    role: 'employee' as UserRole,
    assignedProducts: ['1'],
  },
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Simple mock authentication
    if (email.includes('admin')) {
      onLogin(mockUsers.admin);
    } else {
      onLogin(mockUsers.employee);
    }
  };

  const handleQuickLogin = (userType: keyof typeof mockUsers) => {
    onLogin(mockUsers[userType]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-full mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="font-bold text-gray-900 mb-2">BTS Property Inventory Management System</h1>
            <p className="text-gray-600">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                placeholder="you@company.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition font-medium flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Sign In
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-600 text-center mb-4">Quick Login (Demo)</p>
            <div className="space-y-2">
              <button
                onClick={() => handleQuickLogin('admin')}
                className="w-full px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition font-medium text-sm flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Administrator
              </button>
              <button
                onClick={() => handleQuickLogin('employee')}
                className="w-full px-4 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition font-medium text-sm flex items-center justify-center gap-2"
              >
                <UserCircle className="w-4 h-4" />
                Employee
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}