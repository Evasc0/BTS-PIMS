import React, { useEffect, useMemo, useState } from 'react';
import { Settings, Save, Bell, Lock, Database, Mail, Globe, Shield } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Employee, SystemSettings } from '../lib/types';
import { db } from '../lib/db';
import { maskSecret, regenerateApiKey } from '../lib/security';
import { nowIso } from '../lib/utils';
import { logActivity } from '../lib/activity';

interface SettingsPageProps {
  user: Employee;
}

const defaultSettings: SystemSettings = {
  id: 'system',
  systemName: '',
  companyName: '',
  timeZone: '',
  dateFormat: 'YYYY-MM-DD',
  maintenanceMode: false,
  notificationsLowStock: false,
  notificationsNewReturn: false,
  notificationsReturnApproved: false,
  notificationsEmployeeAdded: false,
  notificationsSystemUpdates: false,
  passwordPolicy: 'medium',
  sessionTimeoutMinutes: 30,
  maxLoginAttempts: 5,
  requireTwoFactor: false,
  ipWhitelistEnabled: false,
  backupFrequency: 'monthly',
  lastBackupAt: '',
  smtpServer: '',
  smtpPort: '',
  smtpEncryption: 'TLS',
  smtpFromEmail: '',
  apiKey: '',
  apiRateLimit: 100,
  apiEnabled: false
};

export function SettingsPage({ user }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [formState, setFormState] = useState<SystemSettings>(defaultSettings);
  const [saveMessage, setSaveMessage] = useState('');

  const settings = useLiveQuery(() => db.settings.get('system'), []);

  const timeZoneOptions = useMemo(() => {
    if ('supportedValuesOf' in Intl) {
      // @ts-ignore - supportedValuesOf is available in newer runtimes
      return Intl.supportedValuesOf('timeZone');
    }
    return ['UTC', 'UTC+08:00', 'UTC+09:00', 'UTC+01:00', 'UTC-05:00', 'UTC-08:00'];
  }, []);

  useEffect(() => {
    if (settings) {
      setFormState(settings);
    }
  }, [settings]);

  const handleSave = async () => {
    await db.settings.put(formState);
    await logActivity({
      action: 'UPDATE',
      entityType: 'sync',
      entityId: 'settings',
      performedByEmployeeId: user.id,
      details: 'System settings updated'
    });
    setSaveMessage('Settings saved.');
    setTimeout(() => setSaveMessage(''), 2000);
  };

  const handleBackupNow = async () => {
    const updated = { ...formState, lastBackupAt: nowIso() };
    setFormState(updated);
    await db.settings.put(updated);
    await logActivity({
      action: 'SYNC',
      entityType: 'sync',
      entityId: 'backup',
      performedByEmployeeId: user.id,
      details: 'Manual backup triggered'
    });
  };

  const handleRegenerateApiKey = () => {
    setFormState({ ...formState, apiKey: regenerateApiKey() });
  };

  const databaseStatus = db.isOpen() ? 'Connected and operational' : 'Disconnected';

  if (!settings) {
    return (
      <div className="p-8">
        <p className="text-gray-600">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2">System Settings</h1>
        <p className="text-gray-600">Configure system-wide settings and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <nav className="space-y-1">
              {[
                { id: 'general', label: 'General', icon: Settings },
                { id: 'notifications', label: 'Notifications', icon: Bell },
                { id: 'security', label: 'Security', icon: Lock },
                { id: 'database', label: 'Database', icon: Database },
                { id: 'email', label: 'Email', icon: Mail },
                { id: 'api', label: 'API Settings', icon: Globe }
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full px-4 py-3 rounded-lg flex items-center gap-3 transition ${
                      activeTab === tab.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            {activeTab === 'general' && (
              <div>
                <h2 className="font-bold text-gray-900 mb-6">General Settings</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">System Name</label>
                    <input
                      type="text"
                      value={formState.systemName}
                      onChange={(e) => setFormState({ ...formState, systemName: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                    <input
                      type="text"
                      value={formState.companyName}
                      onChange={(e) => setFormState({ ...formState, companyName: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Time Zone</label>
                    <select
                      value={formState.timeZone}
                      onChange={(e) => setFormState({ ...formState, timeZone: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    >
                      {timeZoneOptions.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
                    <select
                      value={formState.dateFormat}
                      onChange={(e) => setFormState({ ...formState, dateFormat: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    >
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between py-3 border-t border-gray-200">
                    <div>
                      <p className="font-medium text-gray-900">Maintenance Mode</p>
                      <p className="text-sm text-gray-600">Temporarily disable system access</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formState.maintenanceMode}
                        onChange={(e) => setFormState({ ...formState, maintenanceMode: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div>
                <h2 className="font-bold text-gray-900 mb-6">Notification Settings</h2>
                <div className="space-y-4">
                  {[
                    {
                      id: 'low-stock',
                      label: 'Low Stock Alerts',
                      description: 'Notify when products reach minimum stock level',
                      key: 'notificationsLowStock'
                    },
                    {
                      id: 'new-return',
                      label: 'New Return Requests',
                      description: 'Notify administrators when returns are submitted',
                      key: 'notificationsNewReturn'
                    },
                    {
                      id: 'return-approved',
                      label: 'Return Approvals',
                      description: 'Notify employees when their returns are processed',
                      key: 'notificationsReturnApproved'
                    },
                    {
                      id: 'employee-added',
                      label: 'New Employees',
                      description: 'Notify when new employee accounts are created',
                      key: 'notificationsEmployeeAdded'
                    },
                    {
                      id: 'system-updates',
                      label: 'System Updates',
                      description: 'Notify about system maintenance and updates',
                      key: 'notificationsSystemUpdates'
                    }
                  ].map((setting) => (
                    <div key={setting.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="font-medium text-gray-900">{setting.label}</p>
                        <p className="text-sm text-gray-600">{setting.description}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formState[setting.key as keyof SystemSettings] as boolean}
                          onChange={(e) =>
                            setFormState({ ...formState, [setting.key]: e.target.checked } as SystemSettings)
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div>
                <h2 className="font-bold text-gray-900 mb-6">Security Settings</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password Policy</label>
                    <select
                      value={formState.passwordPolicy}
                      onChange={(e) =>
                        setFormState({ ...formState, passwordPolicy: e.target.value as SystemSettings['passwordPolicy'] })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    >
                      <option value="strong">Strong (12+ characters, mixed case, numbers, symbols)</option>
                      <option value="medium">Medium (8+ characters, mixed case, numbers)</option>
                      <option value="basic">Basic (6+ characters)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Session Timeout (minutes)</label>
                    <input
                      type="number"
                      value={formState.sessionTimeoutMinutes}
                      onChange={(e) => setFormState({ ...formState, sessionTimeoutMinutes: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Login Attempts</label>
                    <input
                      type="number"
                      value={formState.maxLoginAttempts}
                      onChange={(e) => setFormState({ ...formState, maxLoginAttempts: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between py-3 border-t border-gray-200">
                    <div>
                      <p className="font-medium text-gray-900">Two-Factor Authentication</p>
                      <p className="text-sm text-gray-600">Require 2FA for all users</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formState.requireTwoFactor}
                        onChange={(e) => setFormState({ ...formState, requireTwoFactor: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                  <div className="flex items-center justify-between py-3 border-t border-gray-200">
                    <div>
                      <p className="font-medium text-gray-900">IP Whitelist</p>
                      <p className="text-sm text-gray-600">Only allow access from specific IP addresses</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formState.ipWhitelistEnabled}
                        onChange={(e) => setFormState({ ...formState, ipWhitelistEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'database' && (
              <div>
                <h2 className="font-bold text-gray-900 mb-6">Database Settings</h2>
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Database className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-900">Database Status</p>
                        <p className="text-sm text-blue-700 mt-1">{databaseStatus}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Backup Frequency</label>
                    <select
                      value={formState.backupFrequency}
                      onChange={(e) =>
                        setFormState({ ...formState, backupFrequency: e.target.value as SystemSettings['backupFrequency'] })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Last Backup</label>
                    <input
                      type="text"
                      value={formState.lastBackupAt ? new Date(formState.lastBackupAt).toLocaleString() : 'Not yet'}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                  <button
                    onClick={handleBackupNow}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                  >
                    Backup Now
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'email' && (
              <div>
                <h2 className="font-bold text-gray-900 mb-6">Email Settings</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">SMTP Server</label>
                    <input
                      type="text"
                      value={formState.smtpServer}
                      onChange={(e) => setFormState({ ...formState, smtpServer: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">SMTP Port</label>
                      <input
                        type="text"
                        value={formState.smtpPort}
                        onChange={(e) => setFormState({ ...formState, smtpPort: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Encryption</label>
                      <select
                        value={formState.smtpEncryption}
                        onChange={(e) =>
                          setFormState({ ...formState, smtpEncryption: e.target.value as SystemSettings['smtpEncryption'] })
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      >
                        <option value="TLS">TLS</option>
                        <option value="SSL">SSL</option>
                        <option value="None">None</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">From Email</label>
                    <input
                      type="email"
                      value={formState.smtpFromEmail}
                      onChange={(e) => setFormState({ ...formState, smtpFromEmail: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setSaveMessage('Email settings queued for test.');
                      setTimeout(() => setSaveMessage(''), 2000);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Send Test Email
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div>
                <h2 className="font-bold text-gray-900 mb-6">API Settings</h2>
                <div className="space-y-6">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-yellow-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-900">API Access</p>
                        <p className="text-sm text-yellow-700 mt-1">Manage API keys and access tokens</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={maskSecret(formState.apiKey)}
                        disabled
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 font-mono"
                      />
                      <button
                        onClick={handleRegenerateApiKey}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                      >
                        Regenerate
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Rate Limit (requests/minute)</label>
                    <input
                      type="number"
                      value={formState.apiRateLimit}
                      onChange={(e) => setFormState({ ...formState, apiRateLimit: Number(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between py-3 border-t border-gray-200">
                    <div>
                      <p className="font-medium text-gray-900">Enable API Access</p>
                      <p className="text-sm text-gray-600">Allow external applications to access the API</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formState.apiEnabled}
                        onChange={(e) => setFormState({ ...formState, apiEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between">
                {saveMessage && <p className="text-sm text-green-600">{saveMessage}</p>}
                <button
                  onClick={handleSave}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
