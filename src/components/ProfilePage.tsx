import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Phone, MapPin, Calendar, Save, Camera, Key, Sun, Moon, Trash2, Eye, EyeOff } from 'lucide-react';
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee } from '../lib/types';
import { db } from '../lib/db';
import { formatDate } from '../lib/utils';
import { logActivity } from '../lib/activity';
import { useAuth } from '../lib/auth';
import { buildFullName, getInitials, optimizeProfileImage, splitFullName } from '../lib/profile';
import {
  applyThemePreference,
  getStoredThemePreference,
  setStoredThemePreference,
  type ThemePreference
} from '../lib/theme';

interface ProfilePageProps {
  user: Employee;
}

interface ProfileFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  address: string;
}

const profileStateFromUser = (user: Employee): ProfileFormState => {
  const split = splitFullName(user.fullName);
  return {
    firstName: user.firstName ?? split.firstName,
    lastName: user.lastName ?? split.lastName,
    email: user.email,
    phone: user.phone,
    position: user.position ?? (user.role === 'system_admin' ? 'System Admin' : 'Employee'),
    department: user.department,
    address: user.address ?? user.location ?? ''
  };
};

const passwordStrengthError = (value: string): string | null => {
  const password = String(value || '');
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/u.test(password)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/u.test(password)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/u.test(password)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/u.test(password)) return 'Password must include a special character.';
  return null;
};

export function ProfilePage({ user }: ProfilePageProps) {
  const { refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canEditOwnEmail = user.role === 'system_admin';
  const [isEditing, setIsEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswordFields, setShowPasswordFields] = useState({
    current: false,
    next: false,
    confirm: false
  });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getStoredThemePreference(user.id));
  const [profileState, setProfileState] = useState<ProfileFormState>(() => profileStateFromUser(user));

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
    // Prevent background sync/user-refresh events from clobbering in-progress edits.
    if (isEditing) return;
    setProfileState(profileStateFromUser(user));
  }, [
    user.id,
    user.firstName,
    user.lastName,
    user.fullName,
    user.email,
    user.phone,
    user.position,
    user.role,
    user.department,
    user.address,
    user.location,
    isEditing
  ]);

  useEffect(() => {
    setThemePreference(getStoredThemePreference(user.id));
  }, [user.id]);

  const pushProfileChangesNow = async (): Promise<string | null> => {
    if (!window.api?.sync?.push) return null;
    if (!navigator.onLine) {
      return 'Changes are saved locally and will sync when internet is available.';
    }

    try {
      let stage: { outboxIds?: number[] } | undefined;
      if (window.api.sync.viewLocalChanges) {
        const summary = await window.api.sync.viewLocalChanges(user.id);
        const outboxIds = summary.changes
          .filter((change) => change.entityType === 'employees' && change.entityId === user.id)
          .map((change) => change.outboxId);
        if (outboxIds.length === 0) {
          return null;
        }
        if (outboxIds.length) {
          stage = { outboxIds };
        }
      }

      const result = await window.api.sync.push(user.id, stage);
      if (result.status === 'synced' || result.status === 'idle') return null;
      if (result.status === 'offline') return 'Sync mode is offline. Enable Online mode to sync now.';
      if (result.status === 'deferred') return result.error || 'Sync was deferred. The app will retry automatically.';
      return result.error || `Sync returned status: ${result.status}.`;
    } catch (error: any) {
      return error?.message || 'Immediate sync failed. The app will retry automatically.';
    }
  };

  const handleSave = async () => {
    setFormError(null);
    setFormSuccess(null);
    const fullName = buildFullName(profileState.firstName, profileState.lastName);
    if (!fullName) {
      setFormError('First name and last name are required.');
      return;
    }

    const normalizedEmail = profileState.email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFormError('Email is required.');
      return;
    }

    const existing = await db.employees.where('email').equals(normalizedEmail).first();
    if (existing && existing.id !== user.id) {
      setFormError('Another employee already uses this email.');
      return;
    }

    const previousEmail = String(user.email || '').trim().toLowerCase();
    const emailChanged = normalizedEmail !== previousEmail;
    if (emailChanged) {
      if (!canEditOwnEmail) {
        setFormError('Only system admin accounts can change email. Contact an admin for email updates.');
        return;
      }
      if (!navigator.onLine) {
        setFormError('Internet connection is required to change your email.');
        return;
      }
      if (!window.api?.auth?.changeEmail) {
        setFormError('Secure email update API is unavailable.');
        return;
      }
      const emailResult = await window.api.auth.changeEmail({
        userId: user.id,
        newEmail: normalizedEmail
      });
      if (!emailResult.success) {
        setFormError(emailResult.error || 'Unable to update email.');
        return;
      }
    }

    const trimmedAddress = profileState.address.trim();
    await db.employees.update(user.id, {
      firstName: profileState.firstName.trim(),
      lastName: profileState.lastName.trim(),
      fullName,
      email: normalizedEmail,
      phone: profileState.phone.trim(),
      position: profileState.position.trim(),
      department: profileState.department.trim(),
      address: trimmedAddress,
      location: trimmedAddress
    });

    await logActivity({
      action: 'UPDATE',
      entityType: 'employee',
      entityId: user.id,
      performedByEmployeeId: user.id,
      details: emailChanged ? 'Profile updated (email changed)' : 'Profile updated'
    });

    const syncWarning = await pushProfileChangesNow();
    setIsEditing(false);
    setFormSuccess(syncWarning ? `Profile updated. ${syncWarning}` : 'Profile updated successfully.');
    await refreshUser();
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!window.api?.auth?.changePassword) {
      setPasswordError('Secure password update API is unavailable.');
      return;
    }

    const currentPassword = passwordForm.currentPassword;
    const newPassword = passwordForm.newPassword;
    const confirmPassword = passwordForm.confirmPassword;

    if (!currentPassword) {
      setPasswordError('Current password is required.');
      return;
    }
    const strengthError = passwordStrengthError(newPassword);
    if (strengthError) {
      setPasswordError(strengthError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Password confirmation does not match.');
      return;
    }

    setPasswordBusy(true);
    try {
      const result = await window.api.auth.changePassword({
        userId: user.id,
        currentPassword,
        newPassword
      });
      if (!result.success) {
        setPasswordError(result.error || 'Unable to update password.');
        return;
      }

      await logActivity({
        action: 'UPDATE',
        entityType: 'employee',
        entityId: user.id,
        performedByEmployeeId: user.id,
        details: 'Password updated in Supabase Auth'
      });

      const syncWarning = await pushProfileChangesNow();
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordSuccess(syncWarning ? `Password updated. ${syncWarning}` : 'Password updated successfully.');
      await refreshUser();
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleImageUploadClick = () => {
    if (imageBusy) return;
    fileInputRef.current?.click();
  };

  const handleImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFormError('Please select a valid image file.');
      return;
    }

    setImageBusy(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const optimized = await optimizeProfileImage(file);
      const updatedAt = new Date().toISOString();
      await db.employees.update(user.id, {
        profileImageDataUrl: optimized.dataUrl,
        profileImageFormat: optimized.format,
        profileImageUpdatedAt: updatedAt
      });
      await logActivity({
        action: 'UPDATE',
        entityType: 'employee',
        entityId: user.id,
        performedByEmployeeId: user.id,
        details: 'Profile image updated'
      });
      const syncWarning = await pushProfileChangesNow();
      setFormSuccess(syncWarning ? `Profile image updated. ${syncWarning}` : 'Profile image updated.');
      await refreshUser();
    } catch (error: any) {
      setFormError(error?.message || 'Unable to process and save profile image.');
    } finally {
      setImageBusy(false);
    }
  };

  const handleRemoveImage = async () => {
    if (imageBusy) return;
    setImageBusy(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const updatedAt = new Date().toISOString();
      await db.employees.update(user.id, {
        profileImageDataUrl: null,
        profileImageFormat: null,
        profileImageUpdatedAt: updatedAt
      });
      await logActivity({
        action: 'UPDATE',
        entityType: 'employee',
        entityId: user.id,
        performedByEmployeeId: user.id,
        details: 'Profile image removed'
      });
      const syncWarning = await pushProfileChangesNow();
      setFormSuccess(syncWarning ? `Profile image removed. ${syncWarning}` : 'Profile image removed.');
      await refreshUser();
    } finally {
      setImageBusy(false);
    }
  };

  const handleViewSessions = () => {
    window.alert('Active session: current device session.');
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
                <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4 overflow-hidden">
                  {user.profileImageDataUrl ? (
                    <img src={user.profileImageDataUrl} alt={`${user.fullName} profile`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-indigo-600">{getInitials(user.fullName)}</span>
                  )}
                </div>
                <button
                  onClick={handleImageUploadClick}
                  disabled={imageBusy}
                  className="absolute bottom-3 right-0 w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center hover:bg-indigo-700 transition disabled:opacity-60"
                >
                  <Camera className="w-4 h-4 text-white" />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/jpg"
                hidden
                onChange={handleImageFileChange}
              />
              <h2 className="font-bold text-gray-900 mb-1">{user.fullName}</h2>
              <p className="text-sm text-gray-600">{profileState.position || user.role}</p>
              {user.profileImageDataUrl && (
                <button
                  onClick={handleRemoveImage}
                  disabled={imageBusy}
                  className="mt-3 inline-flex items-center gap-2 text-xs text-red-600 hover:text-red-700 disabled:opacity-60"
                >
                  <Trash2 className="w-3 h-3" />
                  Remove image
                </button>
              )}
            </div>

            <div className="space-y-4 pt-6 border-t border-gray-200">
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{user.email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{user.phone || 'No contact number set'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">{user.address || user.location || 'No address set'}</span>
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
                onClick={() => {
                  setFormError(null);
                  setFormSuccess(null);
                  if (isEditing) {
                    setProfileState(profileStateFromUser(user));
                    setIsEditing(false);
                    return;
                  }
                  setIsEditing(true);
                }}
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
                  disabled={!isEditing || !canEditOwnEmail}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing && canEditOwnEmail
                      ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
                      : 'bg-gray-50 text-gray-600'
                  }`}
                />
                {!canEditOwnEmail && (
                  <p className="mt-1 text-xs text-gray-500">Only system admin can change employee email.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Contact Number</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                <input
                  type="text"
                  value={profileState.position}
                  onChange={(e) => setProfileState({ ...profileState, position: e.target.value })}
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
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                <textarea
                  value={profileState.address}
                  onChange={(e) => setProfileState({ ...profileState, address: e.target.value })}
                  disabled={!isEditing}
                  rows={3}
                  className={`w-full px-4 py-2 border border-gray-300 rounded-lg outline-none ${
                    isEditing ? 'focus:ring-2 focus:ring-indigo-500 focus:border-transparent' : 'bg-gray-50 text-gray-600'
                  }`}
                />
              </div>
            </div>

            {formError && <p className="text-sm text-red-600 mt-4">{formError}</p>}
            {formSuccess && <p className="text-sm text-emerald-700 mt-4">{formSuccess}</p>}

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
              <div className="py-4 border-b border-gray-100">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <Key className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Change Password</p>
                    <p className="text-sm text-gray-600">Password updates are applied directly in Supabase Auth.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-center border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                    <input
                      type={showPasswordFields.current ? 'text' : 'password'}
                      placeholder="Current password"
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                      className="w-full flex-1 bg-transparent px-3 py-2 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordFields((prev) => ({ ...prev, current: !prev.current }))}
                      className="mr-2 inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-gray-700"
                      aria-label={showPasswordFields.current ? 'Hide current password' : 'Show current password'}
                    >
                      {showPasswordFields.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                    <input
                      type={showPasswordFields.next ? 'text' : 'password'}
                      placeholder="New password"
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                      className="w-full flex-1 bg-transparent px-3 py-2 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordFields((prev) => ({ ...prev, next: !prev.next }))}
                      className="mr-2 inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-gray-700"
                      aria-label={showPasswordFields.next ? 'Hide new password' : 'Show new password'}
                    >
                      {showPasswordFields.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                    <input
                      type={showPasswordFields.confirm ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                      className="w-full flex-1 bg-transparent px-3 py-2 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordFields((prev) => ({ ...prev, confirm: !prev.confirm }))}
                      className="mr-2 inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-gray-700"
                      aria-label={showPasswordFields.confirm ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      {showPasswordFields.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Minimum 8 chars with uppercase, lowercase, number, and special character.
                </p>
                {passwordError && <p className="text-sm text-red-600 mt-3">{passwordError}</p>}
                {passwordSuccess && <p className="text-sm text-emerald-700 mt-3">{passwordSuccess}</p>}
                <button
                  onClick={handleChangePassword}
                  disabled={passwordBusy}
                  className="mt-4 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm disabled:opacity-60"
                >
                  {passwordBusy ? 'Updating...' : 'Update Password'}
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
                      themePreference === 'light' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    Light
                  </button>
                  <button
                    onClick={() => handleThemeChange('dark')}
                    className={`px-3 py-2 rounded-md text-sm transition flex items-center gap-2 ${
                      themePreference === 'dark' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
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
