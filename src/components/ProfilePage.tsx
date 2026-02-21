import React, { useEffect, useMemo, useState } from 'react';
import { Mail, Phone, MapPin, Calendar, Save, Camera, Key, Sun, Moon } from 'lucide-react';
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee } from '../lib/types';
import { db } from '../lib/db';
import { createPasswordHash } from '../lib/security';
import { formatDate } from '../lib/utils';
import { logActivity } from '../lib/activity';
import { useAuth } from '../lib/auth';
import {
  applyThemePreference,
  getStoredThemePreference,
  setStoredThemePreference,
  type ThemePreference
} from '../lib/theme';

interface ProfilePageProps {
  user: Employee;
}

export function ProfilePage({ user }: ProfilePageProps) {
  const { refreshUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getStoredThemePreference(user.id));
  const [profileState, setProfileState] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    department: '',
    location: ''
  });

  const products = useLiveQuery(() => db.products.toArray(), []);
  const returns = useLiveQuery(() => db.returns.toArray(), []);

  const assignedCount = useMemo(
    () => (products || []).filter((product) => product.assignedToEmployeeId === user.id).length,
    [products, user.id]
  );

  const returnCount = useMemo(
    () => (returns || []).filter((ret) => ret.returnedByEmployeeId === user.id).length,
    [returns, user.id]
  );

  useEffect(() => {
    const [firstName, ...rest] = user.fullName.split(' ');
    setProfileState({
      firstName: firstName || '',
      lastName: rest.join(' '),
      email: user.email,
      phone: user.phone,
      department: user.department,
      location: user.location
    });
    setThemePreference(getStoredThemePreference(user.id));
  }, [user]);

  const handleSave = async () => {
    setFormError(null);
    const fullName = `${profileState.firstName} ${profileState.lastName}`.trim();
    if (!fullName || !profileState.email.trim()) {
      setFormError('Name and email are required.');
      return;
    }

    const normalizedEmail = profileState.email.trim().toLowerCase();
    const existing = await db.employees.where('email').equals(normalizedEmail).first();
    if (existing && existing.id !== user.id) {
      setFormError('Another employee already uses this email.');
      return;
    }

    await db.employees.update(user.id, {
      fullName,
      email: normalizedEmail,
      phone: profileState.phone.trim(),
      department: profileState.department.trim(),
      location: profileState.location.trim()
    });

    await logActivity({
      action: 'UPDATE',
      entityType: 'employee',
      entityId: user.id,
      performedByEmployeeId: user.id,
      details: 'Profile updated'
    });

    await refreshUser();
    setIsEditing(false);
  };

  const handleChangePassword = async () => {
    const newPassword = window.prompt('Enter a new password:');
    if (!newPassword) return;
    if (newPassword.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    const confirmPassword = window.prompt('Confirm the new password:');
    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    const { hash, salt } = await createPasswordHash(newPassword);
    await db.employees.update(user.id, {
      passwordHash: hash,
      passwordSalt: salt,
      authSyncStatus: 'pending_upload',
      pendingPasswordPlain: newPassword
    });
    await logActivity({
      action: 'UPDATE',
      entityType: 'employee',
      entityId: user.id,
      performedByEmployeeId: user.id,
      details: 'Password updated'
    });
    setFormError(null);
  };

  const handleViewSessions = () => {
    window.alert('Active session: current browser session.');
  };

  const handleThemeChange = (theme: ThemePreference) => {
    const normalizedTheme = setStoredThemePreference(theme, user.id);
    setThemePreference(normalizedTheme);
    applyThemePreference(normalizedTheme);
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2">My Profile</h1>
        <p className="text-gray-600">View and update your personal information</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="text-center mb-6">
              <div className="relative inline-block">
                <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl font-bold text-indigo-600">
                    {user.fullName
                      .split(' ')
                      .filter(Boolean)
                      .map((n) => n[0])
                      .join('')}
                  </span>
                </div>
                <button className="absolute bottom-3 right-0 w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-700 transition">
                  <Camera className="w-4 h-4 text-white" />
                </button>
              </div>
              <h2 className="font-bold text-gray-900 mb-1">{user.fullName}</h2>
              <p className="text-sm text-gray-600 capitalize">{user.role}</p>
            </div>

            <div className="space-y-4 pt-6 border-t border-gray-200">
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{user.email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{user.phone || 'No phone number'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{user.location || 'No location set'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">Joined {formatDate(user.createdAt)}</span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Products Assigned</span>
                  <span className="text-sm font-medium text-gray-900">{assignedCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Returns Submitted</span>
                  <span className="text-sm font-medium text-gray-900">{returnCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Account Status</span>
                  <span className={`text-sm font-medium ${user.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                    {user.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Personal Information</h2>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="px-4 py-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition text-sm font-medium"
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                <input
                  type="text"
                  value={profileState.firstName}
                  onChange={(e) => setProfileState({ ...profileState, firstName: e.target.value })}
                  disabled={!isEditing}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                <input
                  type="text"
                  value={profileState.lastName}
                  onChange={(e) => setProfileState({ ...profileState, lastName: e.target.value })}
                  disabled={!isEditing}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={profileState.email}
                  onChange={(e) => setProfileState({ ...profileState, email: e.target.value })}
                  disabled={!isEditing}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                <input
                  type="tel"
                  value={profileState.phone}
                  onChange={(e) => setProfileState({ ...profileState, phone: e.target.value })}
                  disabled={!isEditing}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                <input
                  type="text"
                  value={profileState.department}
                  onChange={(e) => setProfileState({ ...profileState, department: e.target.value })}
                  disabled={!isEditing}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                <input
                  type="text"
                  value={profileState.location}
                  onChange={(e) => setProfileState({ ...profileState, location: e.target.value })}
                  disabled={!isEditing}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
            </div>

            {formError && <p className="text-sm text-red-600 mt-4">{formError}</p>}

            {isEditing && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <button
                  onClick={handleSave}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-6">Security Settings</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <Key className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Change Password</p>
                    <p className="text-sm text-gray-600">Update your password regularly for security</p>
                  </div>
                </div>
                <button
                  onClick={handleChangePassword}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  Change
                </button>
              </div>

              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium text-gray-900">Active Sessions</p>
                  <p className="text-sm text-gray-600">Manage devices where you're currently logged in</p>
                </div>
                <button
                  onClick={handleViewSessions}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
                >
                  View
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-6">Preferences</h2>

            <div className="space-y-4">
              <div className="py-3">
                <p className="font-medium text-gray-900 mb-1">Theme Mode</p>
                <p className="text-sm text-gray-600 mb-3">Choose how the interface looks for your account.</p>
                <div className="inline-flex rounded-lg border border-gray-200 p-1 gap-1">
                  <button
                    onClick={() => handleThemeChange('light')}
                    className={`px-3 py-2 rounded-md text-sm transition flex items-center gap-2 ${
                      themePreference === 'light'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    Light
                  </button>
                  <button
                    onClick={() => handleThemeChange('dark')}
                    className={`px-3 py-2 rounded-md text-sm transition flex items-center gap-2 ${
                      themePreference === 'dark'
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    Dark
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
