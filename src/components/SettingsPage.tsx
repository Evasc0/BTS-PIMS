import React, { useEffect, useMemo, useState } from 'react';
import { Settings, Save, Bell, Lock, Database, Mail, Globe, Shield, Wifi, WifiOff, Upload, Download } from 'lucide-react';
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee, SystemSettings } from '../lib/types';
import { db } from '../lib/db';
import { maskSecret, regenerateApiKey } from '../lib/security';
import { nowIso } from '../lib/utils';
import { logActivity } from '../lib/activity';

interface SettingsPageProps {
  user: Employee;
}

interface SyncLogEntry {
  id: number;
  eventType: string;
  message: string;
  pushedCount: number;
  pulledCount: number;
  conflictCount: number;
  createdAt: string;
}

interface SyncStatusSnapshot {
  fullSyncRequired?: boolean;
  fullSyncReason?: string | null;
  lastSuccessfulSyncAt?: string | null;
  retentionDays?: number;
  maxOfflineDays?: number;
  mode: 'online' | 'offline';
  configured: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastPushCount: number;
  lastPullCount: number;
  lastConflictCount: number;
  lastStatus: string;
  lastError: string | null;
  pendingLocalChanges: number;
  recentLogs: SyncLogEntry[];
}

interface FullSyncRequestSummary {
  requestId: string;
  requesterDeviceId: string;
  requesterUserId: string | null;
  requestedAt: string;
  status: string;
  lastSuccessfulSyncAt: string | null;
  estimatedDbSizeBytes: number | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  totalChunks: number | null;
  manifestChecksum: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completedByDeviceId: string | null;
  uploadedChunks: number;
  ackedChunks: number;
  nextUploadedChunkIndex: number | null;
  updatedAt: string | null;
}

interface FullSyncSessionSnapshot {
  status: string;
  request?: FullSyncRequestSummary | null;
  nextChunk?: {
    chunkId: string;
    chunkIndex: number;
    chunkSizeBytes: number;
    checksumSha256: string;
  } | null;
  error?: string;
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
  const [syncMessage, setSyncMessage] = useState('');
  const [syncBusy, setSyncBusy] = useState<'mode' | 'push' | 'pull' | null>(null);
  const [fullSyncBusy, setFullSyncBusy] = useState<'request' | 'pull' | 'approve' | 'reject' | 'upload' | null>(null);
  const [fullSyncMessage, setFullSyncMessage] = useState('');
  const [fullSyncSession, setFullSyncSession] = useState<FullSyncSessionSnapshot | null>(null);
  const [adminFullSyncRequests, setAdminFullSyncRequests] = useState<FullSyncRequestSummary[]>([]);
  const [networkOnline, setNetworkOnline] = useState<boolean>(navigator.onLine);

  const settings = useLiveQuery(() => db.settings.get('system'), []);
  const syncStatus = useLiveQuery<SyncStatusSnapshot | undefined>(() => window.api?.sync?.getStatus?.(user.id), [user.id]);
  const isAdmin = user.role === 'system_admin';
  const isEmployee = user.role === 'employee';

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

  useEffect(() => {
    const onOnline = () => setNetworkOnline(true);
    const onOffline = () => setNetworkOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!active) return;
      await loadFullSyncData();
    };

    refresh();
    const timer = window.setInterval(refresh, 10000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user.id, isAdmin, syncStatus?.mode, syncStatus?.configured, syncStatus?.fullSyncRequired]);

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

  const formatTimestamp = (value?: string | null) => {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
  };

  const formatBytes = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const loadFullSyncData = async () => {
    if (!window.api?.sync?.fullSyncSession) return;
    try {
      const session = await window.api.sync.fullSyncSession(user.id);
      setFullSyncSession(session);
    } catch {
      setFullSyncSession(null);
    }

    if (isAdmin && window.api?.sync?.fullSyncAdminList) {
      try {
        const listResult = await window.api.sync.fullSyncAdminList(user.id);
        setAdminFullSyncRequests(listResult.requests || []);
      } catch {
        setAdminFullSyncRequests([]);
      }
    }
  };

  const handleSyncModeChange = async (online: boolean) => {
    if (!window.api?.sync?.setMode) return;
    setSyncBusy('mode');
    try {
      const result = await window.api.sync.setMode(user.id, online);
      if (online && result.fullSyncRequired) {
        let autoRequestNote = '';
        if (window.api?.sync?.fullSyncRequest) {
          const requestResult = await window.api.sync.fullSyncRequest(user.id);
          if (requestResult.status === 'requested') {
            autoRequestNote = ' Full Sync request sent. Waiting for Master approval.';
          } else if (requestResult.status === 'exists') {
            autoRequestNote = ' Full Sync request is already pending.';
          }
          await loadFullSyncData();
        }
        setSyncMessage((result.fullSyncReason || 'Full sync is required before this device can push or pull.') + autoRequestNote);
      } else {
        setSyncMessage(online ? 'Online mode enabled. Push and Pull are available.' : 'Offline mode enabled.');
      }
    } catch (error: any) {
      setSyncMessage(error?.message || 'Failed to update sync mode.');
    } finally {
      setSyncBusy(null);
    }
  };

  const handlePushChanges = async () => {
    if (!window.api?.sync?.push) return;
    setSyncBusy('push');
    try {
      const result = await window.api.sync.push(user.id);
      if (result.status === 'synced') {
        setSyncMessage(`Pushed ${result.pushedCount} record(s) to sync queue.`);
      } else if (result.status === 'idle') {
        setSyncMessage('No local changes to push.');
      } else if (result.status === 'full_sync_required') {
        setSyncMessage(result.error || 'Full sync required before push is allowed.');
      } else {
        setSyncMessage(result.error || 'Push failed.');
      }
    } catch (error: any) {
      setSyncMessage(error?.message || 'Push failed.');
    } finally {
      setSyncBusy(null);
    }
  };

  const handlePullChanges = async () => {
    if (!window.api?.sync?.previewPull || !window.api?.sync?.pull) return;
    setSyncBusy('pull');
    try {
      const preview = await window.api.sync.previewPull(user.id);
      if (preview.status === 'error') {
        setSyncMessage(preview.error || 'Unable to check remote changes.');
        return;
      }
      if (preview.status === 'full_sync_required') {
        setSyncMessage(preview.error || 'Full sync required before pull is allowed.');
        return;
      }
      if (preview.newRecords === 0) {
        setSyncMessage('No new remote records available.');
        return;
      }

      const confirmed = window.confirm(
        isEmployee
          ? `You have ${preview.newRecords} updated assigned properties. Pull now?`
          : `${preview.newRecords} new records are available. Pull now?`
      );
      if (!confirmed) {
        setSyncMessage('Pull skipped. Remote records were left in queue.');
        return;
      }

      let result = await window.api.sync.pull(user.id, 'skip');
      if (result.status === 'conflict' && result.conflictCount > 0) {
        const overwrite = window.confirm(
          isEmployee
            ? `${result.conflictCount} conflict(s) detected in assigned updates. Overwrite your local copies with remote records?`
            : `${result.conflictCount} conflict(s) detected. Overwrite local conflicts with remote records?`
        );
        if (overwrite) {
          result = await window.api.sync.pull(user.id, 'remote_wins');
        }
      }

      if (result.status === 'synced') {
        setSyncMessage(isEmployee ? `Pulled ${result.pulledCount} assigned update(s).` : `Pulled ${result.pulledCount} record(s).`);
      } else if (result.status === 'conflict') {
        setSyncMessage(`Pulled ${result.pulledCount} record(s). ${result.conflictCount} conflict(s) pending.`);
      } else if (result.status === 'idle') {
        setSyncMessage('No eligible remote changes to pull.');
      } else if (result.status === 'full_sync_required') {
        setSyncMessage(result.error || 'Full sync required before pull is allowed.');
      } else {
        setSyncMessage(result.error || 'Pull failed.');
      }
    } catch (error: any) {
      setSyncMessage(error?.message || 'Pull failed.');
    } finally {
      setSyncBusy(null);
    }
  };

  const handleRequestFullSync = async () => {
    if (!window.api?.sync?.fullSyncRequest) return;
    setFullSyncBusy('request');
    try {
      const result = await window.api.sync.fullSyncRequest(user.id);
      if (result.status === 'requested') {
        setFullSyncMessage('Full Sync requested. Waiting for Master approval.');
      } else if (result.status === 'exists') {
        setFullSyncMessage('A Full Sync request is already active for this device.');
      } else {
        setFullSyncMessage(result.error || 'Failed to request Full Sync.');
      }
      await loadFullSyncData();
    } catch (error: any) {
      setFullSyncMessage(error?.message || 'Failed to request Full Sync.');
    } finally {
      setFullSyncBusy(null);
    }
  };

  const handlePullNextFullSyncChunk = async () => {
    if (!window.api?.sync?.fullSyncPullNext) return;
    setFullSyncBusy('pull');
    try {
      const result = await window.api.sync.fullSyncPullNext(user.id);
      if (result.status === 'pulled') {
        setFullSyncMessage(`Pulled full-sync chunk #${(result.pulledChunkIndex ?? 0) + 1}.`);
      } else if (result.status === 'completed') {
        setFullSyncMessage('Full Sync completed successfully. Local inventory was rebuilt.');
      } else if (result.status === 'pending') {
        setFullSyncMessage('Full Sync request is pending master approval.');
      } else if (result.status === 'waiting_chunk') {
        setFullSyncMessage('Waiting for Master to upload the next chunk.');
      } else {
        setFullSyncMessage(result.error || 'Unable to pull next Full Sync chunk.');
      }
      await loadFullSyncData();
    } catch (error: any) {
      setFullSyncMessage(error?.message || 'Unable to pull next Full Sync chunk.');
    } finally {
      setFullSyncBusy(null);
    }
  };

  const handleAdminReviewFullSync = async (requestId: string, decision: 'approve' | 'reject') => {
    if (!window.api?.sync?.fullSyncAdminReview) return;
    setFullSyncBusy(decision === 'approve' ? 'approve' : 'reject');
    try {
      const reason =
        decision === 'reject' ? window.prompt('Optional rejection reason:', 'Request rejected by master device.') || undefined : undefined;
      const result = await window.api.sync.fullSyncAdminReview(user.id, requestId, decision, reason);
      if (result.status === 'approved') {
        setFullSyncMessage(`Request ${requestId} approved.`);
      } else if (result.status === 'rejected') {
        setFullSyncMessage(`Request ${requestId} rejected.`);
      } else {
        setFullSyncMessage(result.error || `Failed to ${decision} request ${requestId}.`);
      }
      await loadFullSyncData();
    } catch (error: any) {
      setFullSyncMessage(error?.message || `Failed to ${decision} request.`);
    } finally {
      setFullSyncBusy(null);
    }
  };

  const handleAdminUploadNextChunk = async (requestId: string) => {
    if (!window.api?.sync?.fullSyncAdminUploadNext) return;
    setFullSyncBusy('upload');
    try {
      const result = await window.api.sync.fullSyncAdminUploadNext(user.id, requestId);
      if (result.status === 'uploaded' && result.uploadedChunk) {
        setFullSyncMessage(`Uploaded chunk #${result.uploadedChunk.chunkIndex + 1} for request ${requestId}.`);
      } else if (result.status === 'waiting_for_ack') {
        setFullSyncMessage('Waiting for requester confirmation before uploading the next chunk.');
      } else if (result.status === 'awaiting_finalize') {
        setFullSyncMessage('All chunks have been uploaded and acknowledged. Waiting for requester finalize.');
      } else {
        setFullSyncMessage(result.error || `Failed to upload next chunk for request ${requestId}.`);
      }
      await loadFullSyncData();
    } catch (error: any) {
      setFullSyncMessage(error?.message || 'Failed to upload next full-sync chunk.');
    } finally {
      setFullSyncBusy(null);
    }
  };

  const databaseStatus = db.isOpen() ? 'Connected and operational' : 'Disconnected';
  const syncModeOnline = syncStatus?.mode === 'online';
  const fullSyncRequired = Boolean(syncStatus?.fullSyncRequired);
  const syncConnectivity = syncModeOnline && networkOnline && syncStatus?.configured;
  const lastSyncAt =
    syncStatus?.lastPushAt && syncStatus?.lastPullAt
      ? (syncStatus.lastPushAt > syncStatus.lastPullAt ? syncStatus.lastPushAt : syncStatus.lastPullAt)
      : syncStatus?.lastPushAt || syncStatus?.lastPullAt || null;
  const sessionRequest = fullSyncSession?.request || null;
  const sessionNextChunk = fullSyncSession?.nextChunk || null;

  if (!settings) {
    return (
      <div className="p-8">
        <p className="text-gray-600">Loading settings...</p>
      </div>
    );
  }

  if (isEmployee) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <h1 className="font-bold text-gray-900 mb-2">Settings</h1>
          <p className="text-gray-600">Manage your connectivity and assigned property updates.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 max-w-3xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">Go Online / Offline</p>
              <p className="text-sm text-gray-600">Online mode enables pull for your assigned property updates.</p>
            </div>
            <button
              onClick={() => handleSyncModeChange(!syncModeOnline)}
              disabled={syncBusy === 'mode'}
              className={`px-4 py-2 rounded-lg border transition flex items-center gap-2 ${
                syncModeOnline
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
              } disabled:opacity-60`}
            >
              {syncModeOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {syncModeOnline ? 'Go Offline' : 'Go Online'}
            </button>
          </div>

          {!syncStatus?.configured && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Supabase is not configured. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`).
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Mode</p>
              <p className="font-medium text-gray-900">{syncModeOnline ? 'Online' : 'Offline'}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
              <p className={`font-medium ${syncConnectivity ? 'text-emerald-700' : 'text-gray-700'}`}>
                {syncConnectivity ? 'Online' : 'Offline'}
              </p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Last Pull</p>
              <p className="font-medium text-gray-900">{formatTimestamp(syncStatus?.lastPullAt)}</p>
            </div>
          </div>

          <button
            onClick={handlePullChanges}
            disabled={!syncModeOnline || !syncStatus?.configured || syncBusy !== null || fullSyncRequired}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Pull Assigned Updates
          </button>

          {(syncMessage || syncStatus?.fullSyncReason || syncStatus?.lastError || (syncStatus?.lastConflictCount ?? 0) > 0) && (
            <div className="space-y-2">
              {syncMessage && <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2">{syncMessage}</p>}
              {syncStatus?.fullSyncReason && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{syncStatus.fullSyncReason}</p>
              )}
              {syncStatus?.lastError && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{syncStatus.lastError}</p>
              )}
              {(syncStatus?.lastConflictCount ?? 0) > 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Conflict warning: {syncStatus?.lastConflictCount} assigned record(s) need attention.
                </p>
              )}
            </div>
          )}

          {(fullSyncMessage || sessionRequest || fullSyncRequired) && (
            <div className="border border-amber-200 rounded-lg p-4 space-y-3 bg-amber-50/40">
              <div>
                <p className="font-medium text-gray-900">Controlled Full Sync</p>
                <p className="text-sm text-gray-700">
                  If this device was offline for too long, request master approval and pull 200MB chunks until rebuild is complete.
                </p>
              </div>

              {fullSyncMessage && <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2">{fullSyncMessage}</p>}

              {sessionRequest && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="border border-amber-200 rounded-lg p-3 bg-white">
                    <p className="text-gray-500">Request ID</p>
                    <p className="font-medium text-gray-900 break-all">{sessionRequest.requestId}</p>
                  </div>
                  <div className="border border-amber-200 rounded-lg p-3 bg-white">
                    <p className="text-gray-500">Status</p>
                    <p className="font-medium text-gray-900 capitalize">{sessionRequest.status}</p>
                  </div>
                  <div className="border border-amber-200 rounded-lg p-3 bg-white">
                    <p className="text-gray-500">Chunks</p>
                    <p className="font-medium text-gray-900">
                      {sessionRequest.ackedChunks}/{sessionRequest.totalChunks ?? '?'} acknowledged
                    </p>
                  </div>
                  <div className="border border-amber-200 rounded-lg p-3 bg-white">
                    <p className="text-gray-500">Estimated DB</p>
                    <p className="font-medium text-gray-900">{formatBytes(sessionRequest.estimatedDbSizeBytes)}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleRequestFullSync}
                  disabled={fullSyncBusy !== null || !syncModeOnline || !syncStatus?.configured}
                  className="px-4 py-2 border border-amber-300 rounded-lg hover:bg-amber-100 transition disabled:opacity-60"
                >
                  Request Full Sync
                </button>
                <button
                  onClick={handlePullNextFullSyncChunk}
                  disabled={
                    fullSyncBusy !== null ||
                    !syncModeOnline ||
                    !syncStatus?.configured ||
                    !sessionRequest ||
                    !['approved', 'transferring'].includes(sessionRequest.status) ||
                    !sessionNextChunk
                  }
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60"
                >
                  Pull Next 200MB Chunk
                </button>
              </div>
            </div>
          )}
        </div>
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
                <h2 className="font-bold text-gray-900 mb-6">Database & Sync Settings</h2>
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

                  <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">Manual Sync Control</p>
                        <p className="text-sm text-gray-600">Keep full offline operation and sync only when you choose.</p>
                      </div>
                      <button
                        onClick={() => handleSyncModeChange(!syncModeOnline)}
                        disabled={syncBusy === 'mode'}
                        className={`px-4 py-2 rounded-lg border transition flex items-center gap-2 ${
                          syncModeOnline
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
                        } disabled:opacity-60`}
                      >
                        {syncModeOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                        {syncModeOnline ? 'Go Offline' : 'Go Online'}
                      </button>
                    </div>

                    {!syncStatus?.configured && (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        Supabase is not configured. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) in the Electron process.
                      </p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Mode</p>
                        <p className="font-medium text-gray-900">{syncModeOnline ? 'Online' : 'Offline'}</p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Connection</p>
                        <p className={`font-medium ${syncConnectivity ? 'text-emerald-700' : 'text-gray-700'}`}>
                          {syncConnectivity ? 'Online' : 'Offline'}
                        </p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Pending Local</p>
                        <p className="font-medium text-gray-900">{syncStatus?.pendingLocalChanges ?? 0}</p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Last Sync</p>
                        <p className="font-medium text-gray-900">{formatTimestamp(lastSyncAt)}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={handlePushChanges}
                        disabled={!syncModeOnline || !syncStatus?.configured || syncBusy !== null || fullSyncRequired}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Push Local Changes
                      </button>
                      <button
                        onClick={handlePullChanges}
                        disabled={!syncModeOnline || !syncStatus?.configured || syncBusy !== null || fullSyncRequired}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Pull Remote Changes
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-gray-500">Last Push</p>
                        <p className="font-medium text-gray-900">{formatTimestamp(syncStatus?.lastPushAt)}</p>
                        <p className="text-xs text-gray-500 mt-1">Records: {syncStatus?.lastPushCount ?? 0}</p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-gray-500">Last Pull</p>
                        <p className="font-medium text-gray-900">{formatTimestamp(syncStatus?.lastPullAt)}</p>
                        <p className="text-xs text-gray-500 mt-1">Records: {syncStatus?.lastPullCount ?? 0}</p>
                      </div>
                    </div>

                    {(syncMessage || syncStatus?.fullSyncReason || syncStatus?.lastError || (syncStatus?.lastConflictCount ?? 0) > 0) && (
                      <div className="space-y-2">
                        {syncMessage && <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2">{syncMessage}</p>}
                        {syncStatus?.fullSyncReason && (
                          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{syncStatus.fullSyncReason}</p>
                        )}
                        {syncStatus?.lastError && (
                          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{syncStatus.lastError}</p>
                        )}
                        {(syncStatus?.lastConflictCount ?? 0) > 0 && (
                          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                            Conflict warning: {syncStatus?.lastConflictCount} record(s) need resolution.
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <p className="font-medium text-gray-900 mb-2">Recent Sync Activity</p>
                      <div className="max-h-56 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                        {(syncStatus?.recentLogs?.length ?? 0) === 0 && (
                          <p className="px-3 py-2 text-sm text-gray-500">No sync activity yet.</p>
                        )}
                        {syncStatus?.recentLogs?.map((entry) => (
                          <div key={entry.id} className="px-3 py-2">
                            <p className="text-sm text-gray-900">{entry.message}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(entry.createdAt).toLocaleString()} | push: {entry.pushedCount} | pull: {entry.pulledCount} | conflicts: {entry.conflictCount}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-amber-200 rounded-lg p-4 space-y-4 bg-amber-50/40">
                      <div>
                        <p className="font-medium text-gray-900">Controlled Full Sync (Master Approved)</p>
                        <p className="text-sm text-gray-700">
                          Use this only when a device was offline longer than the sync retention window.
                        </p>
                      </div>

                      {(fullSyncMessage || (fullSyncSession?.status === 'error' ? fullSyncSession.error : '')) && (
                        <div className="space-y-2">
                          {fullSyncMessage && (
                            <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2">{fullSyncMessage}</p>
                          )}
                          {fullSyncSession?.status === 'error' && fullSyncSession.error && (
                            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{fullSyncSession.error}</p>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          onClick={handleRequestFullSync}
                          disabled={fullSyncBusy !== null || !syncModeOnline || !syncStatus?.configured}
                          className="px-4 py-2 border border-amber-300 rounded-lg hover:bg-amber-100 transition disabled:opacity-60"
                        >
                          Request Full Sync (This Device)
                        </button>
                        <button
                          onClick={handlePullNextFullSyncChunk}
                          disabled={
                            fullSyncBusy !== null ||
                            !syncModeOnline ||
                            !syncStatus?.configured ||
                            !sessionRequest ||
                            !['approved', 'transferring'].includes(sessionRequest.status) ||
                            !sessionNextChunk
                          }
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60"
                        >
                          Pull Next 200MB Chunk (This Device)
                        </button>
                      </div>

                      {sessionRequest && (
                        <div className="text-sm border border-amber-200 rounded-lg p-3 bg-white">
                          <p className="font-medium text-gray-900 mb-1">This Device Request</p>
                          <p className="text-gray-700 break-all">Request ID: {sessionRequest.requestId}</p>
                          <p className="text-gray-700">Status: {sessionRequest.status}</p>
                          <p className="text-gray-700">
                            Progress: {sessionRequest.ackedChunks}/{sessionRequest.totalChunks ?? '?'} chunk(s)
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="font-medium text-gray-900 mb-2">Pending Full Sync Requests</p>
                        {adminFullSyncRequests.length === 0 && (
                          <p className="text-sm text-gray-600 border border-gray-200 rounded-lg p-3 bg-white">No pending requests.</p>
                        )}
                        <div className="space-y-3">
                          {adminFullSyncRequests.map((request) => (
                            <div key={request.requestId} className="border border-gray-200 rounded-lg p-3 bg-white">
                              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                <div className="text-sm">
                                  <p className="font-medium text-gray-900 break-all">{request.requestId}</p>
                                  <p className="text-gray-600">Device: {request.requesterDeviceId}</p>
                                  <p className="text-gray-600">Requested: {formatTimestamp(request.requestedAt)}</p>
                                  <p className="text-gray-600">Last Sync: {formatTimestamp(request.lastSuccessfulSyncAt)}</p>
                                  <p className="text-gray-600">Estimated DB: {formatBytes(request.estimatedDbSizeBytes)}</p>
                                  <p className="text-gray-600">
                                    Progress: {request.ackedChunks}/{request.totalChunks ?? '?'} chunk(s)
                                  </p>
                                  <p className="text-gray-600 capitalize">Status: {request.status}</p>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <button
                                    onClick={() => handleAdminReviewFullSync(request.requestId, 'approve')}
                                    disabled={fullSyncBusy !== null || request.status !== 'pending'}
                                    className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-60"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleAdminReviewFullSync(request.requestId, 'reject')}
                                    disabled={fullSyncBusy !== null || request.status !== 'pending'}
                                    className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-60"
                                  >
                                    Reject
                                  </button>
                                  <button
                                    onClick={() => handleAdminUploadNextChunk(request.requestId)}
                                    disabled={fullSyncBusy !== null || !['approved', 'transferring'].includes(request.status)}
                                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-60"
                                  >
                                    Upload Next Chunk
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
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
