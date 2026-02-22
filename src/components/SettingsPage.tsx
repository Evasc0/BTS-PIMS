import React, { useEffect, useMemo, useState } from 'react';
import { Settings, Save, Bell, Lock, Database, Mail, Globe, Shield } from 'lucide-react';
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
  fullSyncEligible?: boolean;
  fullSyncEligibilityReason?: string | null;
  deviceId?: string | null;
  lastAutoSyncAt?: string | null;
  lastFullSyncAt?: string | null;
  deviceRegisteredAt?: string | null;
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
  lastWarning?: string | null;
  relayQueueRows?: number;
  relayQueuePayloadMb?: number;
  relayStorageMb?: number;
  relayOldestQueueAt?: string | null;
  relayLastCheckedAt?: string | null;
  relayDbLimitMb?: number;
  relayStorageLimitMb?: number;
  relayDbSoftThreshold?: number;
  relayDbHardThreshold?: number;
  relayStorageSoftThreshold?: number;
  relayStorageHardThreshold?: number;
  pendingLocalChanges: number;
  recentLogs: SyncLogEntry[];
}

interface SyncLocalChangesSummary {
  total: number;
  totalSizeKb: number;
  safeToPush: boolean;
  recommendedBatchCount: number;
  maxBatchMb: number;
  categories: Array<{ key: string; label: string; count: number; sizeKb: number }>;
  changes: Array<{
    outboxId: number;
    entityType: string;
    entityId: string;
    operation: 'insert' | 'update' | 'delete';
    categoryKey: string;
    label: string;
    sizeKb: number;
  }>;
}

interface FullSyncRequestSummary {
  requestId: string;
  requestingDeviceId?: string;
  targetDeviceId?: string;
  requestedBy?: string | null;
  requesterDeviceId: string;
  requesterUserId: string | null;
  requestedAt: string;
  status: string;
  lastSuccessfulSyncAt: string | null;
  estimatedRecords?: number | null;
  estimatedSizeMb?: number | null;
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
  const [localChanges, setLocalChanges] = useState<SyncLocalChangesSummary | null>(null);
  const [viewChangesBusy, setViewChangesBusy] = useState(false);
  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<string[]>([]);
  const [selectedOutboxIds, setSelectedOutboxIds] = useState<number[]>([]);
  const [expandedCategoryKeys, setExpandedCategoryKeys] = useState<string[]>([]);
  const [showManualSyncPanel, setShowManualSyncPanel] = useState(false);
  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [remotePreview, setRemotePreview] = useState<{ count: number; totalSizeKb: number; message?: string } | null>(null);
  const [syncRelayConnected, setSyncRelayConnected] = useState(false);
  const [fullSyncBusy, setFullSyncBusy] = useState<'check' | 'request' | 'pull' | 'approve' | 'reject' | 'upload' | null>(null);
  const [fullSyncMessage, setFullSyncMessage] = useState('');
  const [fullSyncSession, setFullSyncSession] = useState<FullSyncSessionSnapshot | null>(null);
  const [pendingFullSyncRequest, setPendingFullSyncRequest] = useState<FullSyncRequestSummary | null>(null);
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

  useEffect(() => {
    if (!isAdmin || syncStatus?.mode !== 'online' || networkOnline || !window.api?.sync?.setMode) return;
    let cancelled = false;
    void window.api.sync
      .setMode(user.id, false)
      .then(() => {
        if (!cancelled) {
          setSyncMessage('Connection lost. Switched to Offline Mode.');
          setSyncRelayConnected(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSyncRelayConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, syncStatus?.mode, networkOnline, user.id]);

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
  const formatKb = (kb?: number | null) => `${Number(kb || 0).toFixed(1)} KB`;
  const formatSizeFromKb = (kb?: number | null) => {
    const safeKb = Number(kb || 0);
    if (safeKb < 1024) return `${safeKb.toFixed(1)} KB`;
    return `${(safeKb / 1024).toFixed(2)} MB`;
  };

  useEffect(() => {
    if (!localChanges) {
      setSelectedCategoryKeys([]);
      setSelectedOutboxIds([]);
      setExpandedCategoryKeys([]);
      return;
    }

    setSelectedCategoryKeys(localChanges.categories.map((category) => category.key));
    setSelectedOutboxIds([]);
    setExpandedCategoryKeys(localChanges.categories.map((category) => category.key));
  }, [localChanges]);

  const stagedChanges = useMemo(() => {
    if (!localChanges) return [] as SyncLocalChangesSummary['changes'];
    if (selectedOutboxIds.length > 0) {
      const selected = new Set(selectedOutboxIds);
      return localChanges.changes.filter((change) => selected.has(change.outboxId));
    }
    const selectedCategories = new Set(selectedCategoryKeys);
    return localChanges.changes.filter((change) => selectedCategories.has(change.categoryKey));
  }, [localChanges, selectedOutboxIds, selectedCategoryKeys]);

  const stagedTotalSizeKb = useMemo(
    () => Number(stagedChanges.reduce((total, change) => total + Number(change.sizeKb || 0), 0).toFixed(3)),
    [stagedChanges]
  );
  const stagedBatchCount = useMemo(() => {
    if (!localChanges || stagedTotalSizeKb <= 0) return 0;
    const bytes = stagedTotalSizeKb * 1024;
    const maxBatchBytes = localChanges.maxBatchMb * 1024 * 1024;
    return Math.max(1, Math.ceil(bytes / maxBatchBytes));
  }, [localChanges, stagedTotalSizeKb]);
  const stagedCategorySummary = useMemo(() => {
    const summary = new Map<string, { label: string; count: number }>();
    for (const change of stagedChanges) {
      const foundLabel = localChanges?.categories.find((category) => category.key === change.categoryKey)?.label || change.categoryKey;
      const current = summary.get(change.categoryKey) || { label: foundLabel, count: 0 };
      current.count += 1;
      summary.set(change.categoryKey, current);
    }
    return Array.from(summary.values());
  }, [stagedChanges, localChanges]);

  const loadFullSyncData = async () => {
    if (!window.api?.sync?.fullSyncSession) return;
    try {
      const session = await window.api.sync.fullSyncSession(user.id);
      setFullSyncSession(session);
    } catch {
      setFullSyncSession(null);
    }
  };

  const verifySyncRelayConnection = async (): Promise<boolean> => {
    if (!window.api?.sync?.previewPull) return false;
    try {
      const preview = await window.api.sync.previewPull(user.id);
      const connected = preview.status === 'ok' || preview.status === 'offline' || preview.status === 'full_sync_required';
      setSyncRelayConnected(connected);
      return connected;
    } catch {
      setSyncRelayConnected(false);
      return false;
    }
  };

  const handleSyncModeChange = async (online: boolean) => {
    if (!window.api?.sync?.setMode) return;
    if (online && !navigator.onLine) {
      setSyncMessage('Internet connection required to switch Online.');
      setSyncRelayConnected(false);
      return;
    }
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
        let nextMessage = online ? 'Online mode enabled. Manual Sync is ready.' : 'Offline mode enabled.';
        if (online) {
          const relayOk = await verifySyncRelayConnection();
          if (!relayOk) {
            await window.api.sync.setMode(user.id, false);
            setSyncMessage('Not Connected. Switched back to Offline Mode.');
            return;
          }
        } else {
          setSyncRelayConnected(false);
        }
        if (online && isAdmin && window.api?.sync?.autoPullEmployeeSubmissions) {
          const autoPull = await window.api.sync.autoPullEmployeeSubmissions(user.id);
          if (autoPull.status === 'synced' || autoPull.status === 'idle' || autoPull.status === 'conflict') {
            const pulled = Number(autoPull.pulledCount || 0);
            nextMessage += ` Auto-pulled ${pulled} employee submission(s).`;
          }
        } else if (
          online &&
          isEmployee &&
          window.api?.sync?.previewPull &&
          window.api?.sync?.pull &&
          result.configured &&
          !result.fullSyncRequired
        ) {
          const preview = await window.api.sync.previewPull(user.id);
          if (preview.status === 'ok' && preview.newRecords > 0) {
            const autoPull = await window.api.sync.pull(user.id, 'skip');
            const pulled = Number(autoPull.pulledCount || 0);
            nextMessage += ` Auto-pulled ${pulled} assigned update(s).`;
          } else if (preview.status === 'ok') {
            nextMessage += ` ${preview.message || 'Assigned data is already up to date.'}`;
          }
        }
        setSyncMessage(nextMessage);
      }
    } catch (error: any) {
      setSyncMessage(error?.message || 'Failed to update sync mode.');
    } finally {
      setSyncBusy(null);
    }
  };

  useEffect(() => {
    if (syncStatus?.mode !== 'online' || !syncStatus?.configured) {
      setSyncRelayConnected(false);
      return;
    }
    let cancelled = false;
    void verifySyncRelayConnection().then((connected) => {
      if (!cancelled) setSyncRelayConnected(connected);
    });
    return () => {
      cancelled = true;
    };
  }, [syncStatus?.mode, syncStatus?.configured, user.id]);

  const handleViewLocalChanges = async () => {
    if (!window.api?.sync?.viewLocalChanges) return;
    setViewChangesBusy(true);
    try {
      const summary = await window.api.sync.viewLocalChanges(user.id);
      setLocalChanges(summary);
      if (summary.total === 0) {
        setSyncMessage('No pending local changes.');
      } else {
        setSyncMessage(`Found ${summary.total} pending local change(s). Review before pushing.`);
      }
    } catch (error: any) {
      setSyncMessage(error?.message || 'Unable to read local changes.');
    } finally {
      setViewChangesBusy(false);
    }
  };

  const handleOpenManualSyncPanel = async () => {
    setShowManualSyncPanel(true);
    if (!localChanges) {
      await handleViewLocalChanges();
    }
  };

  const toggleCategoryStage = (categoryKey: string) => {
    setSelectedOutboxIds([]);
    setSelectedCategoryKeys((previous) =>
      previous.includes(categoryKey) ? previous.filter((key) => key !== categoryKey) : [...previous, categoryKey]
    );
  };

  const toggleOutboxStage = (outboxId: number) => {
    setSelectedOutboxIds((previous) =>
      previous.includes(outboxId) ? previous.filter((id) => id !== outboxId) : [...previous, outboxId]
    );
  };
  const toggleExpandedCategory = (categoryKey: string) => {
    setExpandedCategoryKeys((previous) =>
      previous.includes(categoryKey) ? previous.filter((key) => key !== categoryKey) : [...previous, categoryKey]
    );
  };

  const handleMarkAll = () => {
    if (!localChanges) return;
    setSelectedOutboxIds(localChanges.changes.map((change) => change.outboxId));
    setSelectedCategoryKeys(localChanges.categories.map((category) => category.key));
  };

  const handleUnmarkAll = () => {
    setSelectedOutboxIds([]);
    setSelectedCategoryKeys([]);
  };

  const handleRequestPushConfirm = () => {
    if (isAdmin && stagedChanges.length === 0) {
      setSyncMessage('No staged changes selected.');
      return;
    }
    setShowPushConfirm(true);
  };

  const handlePushChanges = async () => {
    if (!window.api?.sync?.push) return;
    setSyncBusy('push');
    setShowPushConfirm(false);
    try {
      const stageOptions =
        isAdmin && localChanges
          ? selectedOutboxIds.length > 0
            ? { outboxIds: selectedOutboxIds }
            : { categories: selectedCategoryKeys }
          : undefined;
      const result = await window.api.sync.push(user.id, stageOptions);
      if (result.status === 'synced') {
        setSyncMessage(
          `Pushed ${result.pushedCount} record(s) to sync queue in ${result.batchCount ?? 0} batch(es), ${formatSizeFromKb(
            result.totalSizeKb || 0
          )}.`
        );
        if (isAdmin) {
          await handleViewLocalChanges();
        }
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

  const handleCheckRemoteChanges = async () => {
    if (!window.api?.sync?.previewPull) return;
    setSyncBusy('pull');
    try {
      const preview = await window.api.sync.previewPull(user.id);
      if (preview.status !== 'ok') {
        setSyncMessage(preview.error || preview.message || 'Unable to check remote updates.');
        setRemotePreview(null);
        return;
      }

      if (preview.newRecords === 0) {
        setRemotePreview(null);
        setSyncMessage(preview.message || 'No remote updates available.');
        return;
      }

      setRemotePreview({
        count: preview.newRecords,
        totalSizeKb: Number(preview.totalSizeKb || 0),
        message: preview.message
      });
    } catch (error: any) {
      setRemotePreview(null);
      setSyncMessage(error?.message || 'Unable to check remote updates.');
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
        setSyncMessage(preview.message || 'No new remote records available.');
        setRemotePreview(null);
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
            ? `${result.conflictCount} conflict(s) detected in assigned updates.\n\nPress OK to Replace local data.\nPress Cancel to Skip conflicting records.`
            : `${result.conflictCount} conflict(s) detected.\n\nPress OK to Replace local data.\nPress Cancel to Skip conflicting records.`
        );
        if (overwrite) {
          result = await window.api.sync.pull(user.id, 'remote_wins');
        }
      }

      if (result.status === 'synced') {
        setSyncMessage(isEmployee ? `Pulled ${result.pulledCount} assigned update(s).` : `Pulled ${result.pulledCount} record(s).`);
        setRemotePreview(null);
      } else if (result.status === 'conflict') {
        setSyncMessage(`Pulled ${result.pulledCount} record(s). ${result.conflictCount} conflict(s) pending.`);
        setRemotePreview(null);
      } else if (result.status === 'idle') {
        setSyncMessage(result.message || 'No eligible remote changes to pull.');
        setRemotePreview(null);
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
      if (window.api?.sync?.previewPull) {
        const preview = await window.api.sync.previewPull(user.id);
        if (preview.status === 'ok') {
          const estimatedSize = formatSizeFromKb(preview.totalSizeKb || 0);
          const proceed = window.confirm(
            `Full Sync Required\nRecords: ${Number(preview.newRecords || 0).toLocaleString()}\nEstimated Size: ${estimatedSize}\n\nProceed?`
          );
          if (!proceed) {
            setFullSyncMessage('Full Sync request cancelled.');
            return;
          }
        }
      }

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

  const pullApprovedFullSyncBatches = async () => {
    if (!window.api?.sync?.fullSyncPullNext) return;

    let batchNumber = 0;
    while (batchNumber < 500) {
      const result = await window.api.sync.fullSyncPullNext(user.id);
      if (result.status === 'pulled') {
        batchNumber += 1;
        setFullSyncMessage(`Syncing batch ${batchNumber}...`);
        continue;
      }
      if (result.status === 'completed') {
        setFullSyncMessage('Full Sync completed successfully. Local inventory was rebuilt.');
        return;
      }
      if (result.status === 'waiting_chunk') {
        setFullSyncMessage('Full Sync approved. Waiting for the next batch from relay.');
        return;
      }
      if (result.status === 'pending') {
        setFullSyncMessage('Full sync request is still pending approval.');
        return;
      }
      if (result.status === 'idle') {
        setFullSyncMessage(result.error || 'No active full sync request for this device.');
        return;
      }
      setFullSyncMessage(result.error || 'Full sync failed while pulling batches.');
      return;
    }

    setFullSyncMessage('Full sync paused after 500 batches. Run Full Sync Check again to continue.');
  };

  const handleFullSyncCheck = async () => {
    if (!window.api?.sync?.fullSyncCheck) return;
    if (!navigator.onLine) {
      setFullSyncMessage('Internet connection required.');
      return;
    }
    if (!syncStatus?.configured) {
      setFullSyncMessage('Supabase is not configured.');
      return;
    }

    setFullSyncBusy('check');
    try {
      const result = await window.api.sync.fullSyncCheck(user.id);
      if (result.status === 'pending' && result.request) {
        setPendingFullSyncRequest(result.request);
        setFullSyncMessage('');
      } else if (result.status === 'none') {
        setPendingFullSyncRequest(null);
        setFullSyncMessage('No pending full sync request for this device.');
      } else {
        setPendingFullSyncRequest(null);
        setFullSyncMessage(result.error || 'Unable to check full sync request.');
      }
      await loadFullSyncData();
    } catch (error: any) {
      setPendingFullSyncRequest(null);
      setFullSyncMessage(error?.message || 'Unable to check full sync request.');
    } finally {
      setFullSyncBusy(null);
    }
  };

  const handleApprovePendingFullSync = async () => {
    if (!pendingFullSyncRequest || !window.api?.sync?.fullSyncAdminReview) return;
    setFullSyncBusy('approve');
    try {
      const result = await window.api.sync.fullSyncAdminReview(user.id, pendingFullSyncRequest.requestId, 'approve');
      if (result.status === 'approved') {
        setPendingFullSyncRequest(null);
        setFullSyncMessage('Full sync request approved. Starting batch sync...');
        await pullApprovedFullSyncBatches();
      } else {
        setFullSyncMessage(result.error || 'Failed to approve full sync request.');
      }
      await loadFullSyncData();
    } catch (error: any) {
      setFullSyncMessage(error?.message || 'Failed to approve full sync request.');
    } finally {
      setFullSyncBusy(null);
    }
  };

  const handleRejectPendingFullSync = async () => {
    if (!pendingFullSyncRequest || !window.api?.sync?.fullSyncAdminReview) return;
    setFullSyncBusy('reject');
    try {
      const result = await window.api.sync.fullSyncAdminReview(
        user.id,
        pendingFullSyncRequest.requestId,
        'reject',
        'Full sync request rejected.'
      );
      if (result.status === 'rejected') {
        setPendingFullSyncRequest(null);
        setFullSyncMessage('Full sync request rejected.');
      } else {
        setFullSyncMessage(result.error || 'Failed to reject full sync request.');
      }
      await loadFullSyncData();
    } catch (error: any) {
      setFullSyncMessage(error?.message || 'Failed to reject full sync request.');
    } finally {
      setFullSyncBusy(null);
    }
  };

  const databaseStatus = db.isOpen() ? 'Connected and operational' : 'Disconnected';
  const syncModeOnline = syncStatus?.mode === 'online';
  const fullSyncRequired = Boolean(syncStatus?.fullSyncRequired);
  const fullSyncEligible = syncStatus?.fullSyncEligible !== false;
  const syncConnectivity = syncModeOnline && networkOnline && syncStatus?.configured;
  const lastSyncAt =
    syncStatus?.lastPushAt && syncStatus?.lastPullAt
      ? (syncStatus.lastPushAt > syncStatus.lastPullAt ? syncStatus.lastPushAt : syncStatus.lastPullAt)
      : syncStatus?.lastPushAt || syncStatus?.lastPullAt || null;
  const sessionRequest = fullSyncSession?.request || null;

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
          <p className="text-gray-600">Sync is automatic for employee accounts.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 max-w-3xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sync Mode</p>
              <p className="font-medium text-gray-900">Automatic</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Connectivity</p>
              <p className={`font-medium ${networkOnline ? 'text-emerald-700' : 'text-gray-700'}`}>{networkOnline ? 'Online' : 'Offline'}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Last Pull</p>
              <p className="font-medium text-gray-900">{formatTimestamp(syncStatus?.lastPullAt)}</p>
            </div>
          </div>

          <p className="text-sm text-gray-700 border border-gray-200 rounded-lg p-3 bg-gray-50">
            Assigned updates are pulled automatically and return submissions are pushed automatically whenever internet is available.
          </p>

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

          {fullSyncRequired && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Full sync is required for this device. Contact a system administrator to run the approved full sync process.
            </p>
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
                    <div>
                      <p className="font-medium text-gray-900">Automatic Sync Engine</p>
                      <p className="text-sm text-gray-600">
                        Push and pull run automatically in the background when internet is available and the user is authenticated.
                      </p>
                    </div>

                    {!syncStatus?.configured && (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        Supabase is not configured. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) in the Electron process.
                      </p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sync Mode</p>
                        <p className="font-medium text-gray-900">Automatic</p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Connectivity</p>
                        <p className={`font-medium ${syncConnectivity ? 'text-emerald-700' : 'text-gray-700'}`}>
                          {syncConnectivity ? 'Online' : 'Offline'}
                        </p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Pending Local</p>
                        <p className="font-medium text-gray-900">{syncStatus?.pendingLocalChanges ?? 0}</p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Last Auto Sync</p>
                        <p className="font-medium text-gray-900">{formatTimestamp(syncStatus?.lastAutoSyncAt || lastSyncAt)}</p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Relay Queue</p>
                        <p className="font-medium text-gray-900">
                          {(syncStatus?.relayQueuePayloadMb ?? 0).toFixed(2)} MB
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Rows: {syncStatus?.relayQueueRows ?? 0}
                        </p>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Relay Storage</p>
                        <p className="font-medium text-gray-900">
                          {(syncStatus?.relayStorageMb ?? 0).toFixed(2)} MB
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Checked: {formatTimestamp(syncStatus?.relayLastCheckedAt)}
                        </p>
                      </div>
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

                    {(syncMessage ||
                      syncStatus?.fullSyncReason ||
                      syncStatus?.lastError ||
                      syncStatus?.lastWarning ||
                      (syncStatus?.lastConflictCount ?? 0) > 0) && (
                      <div className="space-y-2">
                        {syncMessage && <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-2">{syncMessage}</p>}
                        {syncStatus?.fullSyncReason && (
                          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{syncStatus.fullSyncReason}</p>
                        )}
                        {syncStatus?.lastWarning && (
                          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{syncStatus.lastWarning}</p>
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
                        <p className="font-medium text-gray-900">Controlled Full Sync (Admin Only)</p>
                        <p className="text-sm text-gray-700">
                          Full sync approval is for new admin-device onboarding and runs in safe batches.
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

                      {!fullSyncEligible && syncStatus?.fullSyncEligibilityReason && (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                          {syncStatus.fullSyncEligibilityReason}
                        </p>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          onClick={handleFullSyncCheck}
                          disabled={fullSyncBusy !== null || !syncStatus?.configured || !fullSyncEligible}
                          className="px-4 py-2 border border-amber-300 rounded-lg hover:bg-amber-100 transition disabled:opacity-60"
                        >
                          {fullSyncBusy === 'check' ? 'Checking...' : 'Full Sync Check'}
                        </button>
                      </div>

                      {sessionRequest && (
                        <div className="text-sm border border-amber-200 rounded-lg p-3 bg-white">
                          <p className="font-medium text-gray-900 mb-1">Current Full Sync Session</p>
                          <p className="text-gray-700 break-all">Request ID: {sessionRequest.requestId}</p>
                          <p className="text-gray-700">Status: {sessionRequest.status}</p>
                          <p className="text-gray-700">
                            Progress: {sessionRequest.ackedChunks}/{sessionRequest.totalChunks ?? '?'} batch(es)
                          </p>
                        </div>
                      )}
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

      {pendingFullSyncRequest && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h3 className="font-bold text-gray-900">Full Sync Request Found</h3>
            <p className="text-sm text-gray-700">
              Requested By: {pendingFullSyncRequest.requestedBy || pendingFullSyncRequest.requesterUserId || 'Unknown'}
            </p>
            <p className="text-sm text-gray-700">
              Estimated Records: {Number(pendingFullSyncRequest.estimatedRecords || 0).toLocaleString()}
            </p>
            <p className="text-sm text-gray-700">
              Estimated Size: {pendingFullSyncRequest.estimatedSizeMb != null ? `${pendingFullSyncRequest.estimatedSizeMb} MB` : formatBytes(pendingFullSyncRequest.estimatedDbSizeBytes)}
            </p>
            <p className="text-sm text-gray-700">Approve Full Sync?</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleRejectPendingFullSync}
                disabled={fullSyncBusy !== null}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
              >
                Reject
              </button>
              <button
                onClick={handleApprovePendingFullSync}
                disabled={fullSyncBusy !== null}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
