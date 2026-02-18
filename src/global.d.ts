import type { ActivityLog, Employee, Product, ReturnRecord, SystemSettings } from './lib/types';

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
  role?: 'system_admin' | 'employee';
  canPush?: boolean;
  canPull?: boolean;
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

interface SyncConflict {
  queueId: string;
  tableName: string;
  recordId: string;
  localVersion: number;
  remoteVersion: number;
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

interface FullSyncChunkSummary {
  chunkId: string;
  chunkIndex: number;
  chunkSizeBytes: number;
  checksumSha256: string;
}

interface AuthProvisioningSummary {
  processed: number;
  synced: number;
  failed: number;
  failures: Array<{ employeeId: string; email: string; reason: string }>;
}

interface AuthLoginResult {
  success: boolean;
  userId?: string;
  verifiedOnline?: boolean;
  verificationExpiresAt?: string | null;
  provisioning?: AuthProvisioningSummary;
  warning?: string;
  error?: string;
  requiresInternet?: boolean;
}

interface AuthCreateUserResult {
  success: boolean;
  employeeId?: string;
  error?: string;
  requiresInternet?: boolean;
}

declare global {
  interface Window {
    api?: {
      db: {
        initialize: () => Promise<void>;
        onChanged: (callback: (payload: { table: string; ids: string[] }) => void) => () => void;
        employees: {
          list: () => Promise<Employee[]>;
          get: (id: string) => Promise<Employee | undefined>;
          add: (record: Employee) => Promise<void>;
          update: (id: string, changes: Partial<Employee>) => Promise<void>;
          delete: (id: string) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<Employee | undefined>;
          count: () => Promise<number>;
        };
        products: {
          list: () => Promise<Product[]>;
          get: (id: string) => Promise<Product | undefined>;
          add: (record: Product) => Promise<void>;
          update: (id: string, changes: Partial<Product>) => Promise<void>;
          delete: (id: string) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<Product | undefined>;
        };
        returns: {
          list: () => Promise<ReturnRecord[]>;
          get: (id: string) => Promise<ReturnRecord | undefined>;
          add: (record: ReturnRecord) => Promise<void>;
          update: (id: string, changes: Partial<ReturnRecord>) => Promise<void>;
          delete: (id: string) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<ReturnRecord | undefined>;
        };
        activityLogs: {
          list: () => Promise<ActivityLog[]>;
          get: (id: string) => Promise<ActivityLog | undefined>;
          add: (record: ActivityLog) => Promise<void>;
        };
        settings: {
          get: (id: string) => Promise<SystemSettings | undefined>;
          put: (record: SystemSettings) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<SystemSettings | undefined>;
          list: () => Promise<SystemSettings[]>;
          add: (record: SystemSettings) => Promise<void>;
          update: (id: string, changes: Partial<SystemSettings>) => Promise<void>;
          delete: (id: string) => Promise<void>;
        };
      };
      auth: {
        login: (payload: { email: string; password: string; preferOnline: boolean }) => Promise<AuthLoginResult>;
        provisionPending: (adminUserId: string, adminAccessToken: string) => Promise<AuthProvisioningSummary>;
        createUser: (payload: {
          adminUserId: string;
          fullName: string;
          email: string;
          phone?: string;
          department?: string;
          role: 'system_admin' | 'employee';
          status: 'active' | 'inactive';
          password: string;
          location?: string;
          language?: string;
        }) => Promise<AuthCreateUserResult>;
        logout: (userId: string) => Promise<boolean>;
      };
      migration: {
        importLegacyDump: (dump: unknown) => Promise<void>;
      };
      sync: {
        trigger: (userId: string) => Promise<{ status: string; pushedCount: number; error?: string }>;
        getStatus: (userId: string) => Promise<SyncStatusSnapshot>;
        setMode: (userId: string, online: boolean) => Promise<SyncStatusSnapshot>;
        push: (
          userId: string,
          stage?: { categories?: string[]; outboxIds?: number[] }
        ) => Promise<{ status: string; pushedCount: number; totalSizeKb?: number; batchCount?: number; error?: string }>;
        viewLocalChanges: (userId: string) => Promise<SyncLocalChangesSummary>;
        autoPullEmployeeSubmissions: (
          userId: string
        ) => Promise<{ status: string; pulledCount?: number; conflictCount?: number; error?: string }>;
        previewPull: (
          userId: string
        ) => Promise<{ status: string; newRecords: number; conflictCount: number; totalSizeKb?: number; message?: string; error?: string }>;
        pull: (
          userId: string,
          conflictStrategy?: 'skip' | 'remote_wins'
        ) => Promise<{
          status: string;
          pulledCount: number;
          conflictCount: number;
          conflicts: SyncConflict[];
          message?: string;
          error?: string;
        }>;
        fullSyncRequest: (
          userId: string
        ) => Promise<{ status: string; request?: FullSyncRequestSummary; error?: string }>;
        fullSyncCheck: (
          userId: string
        ) => Promise<{ status: string; request?: FullSyncRequestSummary | null; error?: string }>;
        fullSyncSession: (
          userId: string
        ) => Promise<{ status: string; request?: FullSyncRequestSummary | null; nextChunk?: FullSyncChunkSummary | null; error?: string }>;
        fullSyncPullNext: (
          userId: string
        ) => Promise<{ status: string; request?: FullSyncRequestSummary; pulledChunkIndex?: number; backupPath?: string; error?: string }>;
        fullSyncAdminList: (
          userId: string
        ) => Promise<{ status: string; requests: FullSyncRequestSummary[]; error?: string }>;
        fullSyncAdminReview: (
          userId: string,
          requestId: string,
          decision: 'approve' | 'reject',
          reason?: string
        ) => Promise<{ status: string; request?: FullSyncRequestSummary; error?: string }>;
        fullSyncAdminUploadNext: (
          userId: string,
          requestId: string
        ) => Promise<{ status: string; request?: FullSyncRequestSummary; uploadedChunk?: FullSyncChunkSummary; error?: string }>;
      };
      update: {
        check: () => Promise<void>;
        install: () => Promise<void>;
        onDownloaded: (callback: () => void) => () => void;
        onError: (callback: (message: string) => void) => () => void;
      };
      system: {
        version: () => Promise<string>;
      };
    };
  }
}

export {};
