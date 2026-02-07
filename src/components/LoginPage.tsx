import React, { useState } from 'react';
import { LogIn, Shield, UserCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { DEFAULT_ADMIN_CREDENTIALS } from '../lib/db';

interface LoginPageProps {
  initError: string | null;
}

export function LoginPage({ initError }: LoginPageProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await login(email, password);
    if (!result.success) {
      setError(result.error || 'Unable to sign in.');
    }
  };

  const fillDefaultAdmin = () => {
    setEmail(DEFAULT_ADMIN_CREDENTIALS.email);
    setPassword(DEFAULT_ADMIN_CREDENTIALS.password);
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
                placeholder="********"
                required
              />
            </div>

            {initError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {initError}
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition font-medium flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Sign In
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-gray-200">
            <p className="text-sm text-gray-600 text-center mb-4">First Run Admin Credentials</p>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span>Email</span>
                <span className="font-medium">{DEFAULT_ADMIN_CREDENTIALS.email}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span>Password</span>
                <span className="font-medium">{DEFAULT_ADMIN_CREDENTIALS.password}</span>
              </div>
              <button
                type="button"
                onClick={fillDefaultAdmin}
                className="w-full px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition font-medium text-sm flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Use Default Admin
              </button>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <UserCircle className="w-4 h-4" />
                Update these credentials after first login.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
