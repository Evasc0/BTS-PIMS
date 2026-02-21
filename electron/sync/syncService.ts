import type Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createHash, randomUUID } from 'crypto';
import { app } from 'electron';
import { dataStore } from '../db';
import { authService } from '../auth/authService';

const nowIso = (): string => new Date().toISOString();
const clamp01 = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const MAX_EVENT_LOG_ITEMS = 10;
const MAX_STORED_EVENTS = 200;
const SYNC_QUEUE_RETENTION_DAYS = Math.max(1, Number(process.env.SYNC_QUEUE_RETENTION_DAYS || 2));
const SYNC_MAX_OFFLINE_DAYS = Math.max(1, Number(process.env.SYNC_MAX_OFFLINE_DAYS || 7));
const SYNC_TARGET_STALE_DAYS = Math.max(1, Number(process.env.SYNC_TARGET_STALE_DAYS || 3));
const SYNC_DELETE_RETRY_ATTEMPTS = Math.max(1, Number(process.env.SYNC_DELETE_RETRY_ATTEMPTS || 3));
const SYNC_PUSH_MAX_BATCH_MB = Math.max(1, Number(process.env.SYNC_PUSH_MAX_BATCH_MB || 5));
const SYNC_PUSH_MAX_BATCH_BYTES = SYNC_PUSH_MAX_BATCH_MB * 1024 * 1024;
const SYNC_PUSH_MAX_BATCH_RECORDS = Math.min(500, Math.max(300, Number(process.env.SYNC_PUSH_BATCH_SIZE || 500)));
const FULL_SYNC_CHUNK_MB = Math.min(5, Math.max(1, Number(process.env.SYNC_FULL_CHUNK_MB || 5)));
const FULL_SYNC_CHUNK_SIZE_BYTES = FULL_SYNC_CHUNK_MB * 1024 * 1024;
const SYNC_RELAY_DB_LIMIT_MB = Math.max(100, Number(process.env.SYNC_RELAY_DB_LIMIT_MB || 500));
const SYNC_RELAY_STORAGE_LIMIT_MB = Math.max(100, Number(process.env.SYNC_RELAY_STORAGE_LIMIT_MB || 1024));
const SYNC_RELAY_DB_SOFT_THRESHOLD = clamp01(Number(process.env.SYNC_RELAY_DB_SOFT_THRESHOLD || 0.7), 0.7);
const SYNC_RELAY_DB_HARD_THRESHOLD = Math.max(
  SYNC_RELAY_DB_SOFT_THRESHOLD,
  clamp01(Number(process.env.SYNC_RELAY_DB_HARD_THRESHOLD || 0.85), 0.85)
);
const SYNC_RELAY_STORAGE_SOFT_THRESHOLD = clamp01(Number(process.env.SYNC_RELAY_STORAGE_SOFT_THRESHOLD || 0.7), 0.7);
const SYNC_RELAY_STORAGE_HARD_THRESHOLD = Math.max(
  SYNC_RELAY_STORAGE_SOFT_THRESHOLD,
  clamp01(Number(process.env.SYNC_RELAY_STORAGE_HARD_THRESHOLD || 0.85), 0.85)
);
const SYNC_RELAY_HARD_STOP_MIN_FREE_MB = Math.max(10, Number(process.env.SYNC_RELAY_HARD_STOP_MIN_FREE_MB || 25));
const SYNC_RETENTION_RPC_COOLDOWN_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.SYNC_RETENTION_RPC_COOLDOWN_MS || 4 * 60 * 60 * 1000)
);
const SYNC_ORPHAN_OBJECT_RETENTION_DAYS = Math.max(1, Number(process.env.SYNC_ORPHAN_OBJECT_RETENTION_DAYS || 2));
const SYNC_ORPHAN_OBJECT_CLEANUP_LIMIT = Math.max(100, Number(process.env.SYNC_ORPHAN_OBJECT_CLEANUP_LIMIT || 1000));
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RELAY_RECIPIENT_ALL = '__all__';

const getAdminQueueTable = (): string =>
  process.env.SUPABASE_ADMIN_QUEUE_TABLE || process.env.SUPABASE_SYNC_QUEUE_TABLE || 'admin_sync_queue';
const getEmployeeQueueTable = (): string => process.env.SUPABASE_EMPLOYEE_QUEUE_TABLE || 'employee_sync_queue';
const getProfileQueueTable = (): string => process.env.SUPABASE_PROFILE_SYNC_QUEUE_TABLE || 'profile_sync_queue';
const getAppUsersTable = (): string => process.env.SUPABASE_APP_USERS_TABLE || 'app_users';
const getSupabaseUrl = (): string => (process.env.SUPABASE_URL || '').replace(/\/+$/u, '');
const getSupabaseAnonKey = (): string => process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const getPullPageSize = (): number => Math.max(1, Number(process.env.SYNC_PULL_PAGE_SIZE || 200));
const getFullSyncRequestsTable = (): string => process.env.SUPABASE_FULL_SYNC_REQUESTS_TABLE || 'full_sync_requests';
const getFullSyncChunksTable = (): string => process.env.SUPABASE_FULL_SYNC_CHUNKS_TABLE || 'full_sync_chunks';
const getFullSyncStorageBucket = (): string => process.env.SUPABASE_FULL_SYNC_STORAGE_BUCKET || 'full-sync-temp';

const entityToTable: Record<string, string> = {
  employees: 'employees',
  products: 'products',
  returns: 'returns',
  activity_logs: 'activity_logs'
};

const entityAliases: Record<string, string> = {
  employees: 'employees',
  employee: 'employees',
  products: 'products',
  product: 'products',
  returns: 'returns',
  return: 'returns',
  activity_logs: 'activity_logs',
  activity_log: 'activity_logs',
  activitylogs: 'activity_logs',
  activitylog: 'activity_logs'
};

type ConflictStrategy = 'skip' | 'remote_wins';
type QueueOperation = 'insert' | 'update' | 'delete';
type SyncRole = 'system_admin' | 'employee';

interface SyncActor {
  userId: string;
  role: SyncRole;
}

interface PushStageOptions {
  categories?: string[];
  outboxIds?: number[];
}

interface SyncStateRow {
  id: string;
  device_id: string | null;
  last_auto_sync_at: string | null;
  last_full_sync_at: string | null;
  device_registered_at: string | null;
  online_mode: number;
  last_push_at: string | null;
  last_pull_at: string | null;
  last_successful_sync_at: string | null;
  last_push_count: number;
  last_pull_count: number;
  last_conflict_count: number;
  full_sync_required: number;
  full_sync_reason: string | null;
  last_status: string;
  last_error: string | null;
  last_warning: string | null;
  relay_queue_rows: number;
  relay_queue_payload_mb: number;
  relay_storage_mb: number;
  relay_oldest_queue_at: string | null;
  relay_last_checked_at: string | null;
  updated_at: string;
}

interface SyncEventRow {
  id: number;
  event_type: string;
  message: string;
  pushed_count: number;
  pulled_count: number;
  conflict_count: number;
  created_at: string;
}

interface OutboxRow {
  id: number;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
}

interface RemoteQueueRow {
  id: string;
  employee_id?: string;
  origin_device_id?: string | null;
  origin_user_id?: string | null;
  payload?: any;
  payload_size_kb?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  table_name?: string;
  operation?: string;
  record_id?: string;
  data?: any;
  timestamp?: string;
  recipient_key?: string | null;
}
interface ProfileImageQueueRow {
  id: string;
  employee_id: string;
  origin_device_id?: string | null;
  origin_user_id?: string | null;
  image_data?: string | null;
  image_format?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

interface AppUserPresenceRow {
  employee_id: string;
  role: string | null;
  account_status: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
}

interface RelayUsageStats {
  adminQueueRows: number;
  employeeQueueRows: number;
  totalQueueRows: number;
  queuePayloadMb: number;
  fullSyncChunkRows: number;
  fullSyncRequestRows: number;
  storageObjects: number;
  storageMb: number;
  oldestQueueAt: string | null;
}

interface ConflictRecord {
  queueId: string;
  tableName: string;
  recordId: string;
  localVersion: number;
  remoteVersion: number;
}

type FullSyncRequestStatus = 'pending' | 'approved' | 'rejected' | 'transferring' | 'completed' | 'cancelled';
type FullSyncChunkStatus = 'uploaded' | 'acked' | 'deleted' | 'failed';
type LocalChangeCategoryKey =
  | 'new_returns'
  | 'inventory_updates'
  | 'property_assignments'
  | 'employee_submissions'
  | 'other_changes';

interface LocalChangeSummaryItem {
  outboxId: number;
  entityType: string;
  entityId: string;
  operation: QueueOperation;
  categoryKey: LocalChangeCategoryKey;
  label: string;
  sizeKb: number;
}

interface FullSyncRequestRow {
  id: string;
  requesting_device_id: string | null;
  target_device_id: string | null;
  requested_by: string | null;
  estimated_records: number | null;
  estimated_size_mb: number | null;
  created_at: string | null;
  requester_device_id: string;
  requester_user_id: string | null;
  requested_at: string;
  status: FullSyncRequestStatus;
  last_successful_sync_at: string | null;
  estimated_db_size_bytes: number | null;
  approved_at: string | null;
  approved_by_user_id: string | null;
  rejected_at: string | null;
  rejected_by_user_id: string | null;
  rejection_reason: string | null;
  total_chunks: number | null;
  manifest_checksum: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_by_device_id: string | null;
  updated_at: string | null;
}

interface FullSyncChunkRow {
  id: string;
  request_id: string;
  chunk_index: number;
  chunk_size_bytes: number;
  checksum_sha256: string;
  storage_object: string;
  status: FullSyncChunkStatus;
  uploaded_at: string;
  acked_at: string | null;
  acked_by_device_id: string | null;
  storage_deleted_at: string | null;
}

interface LocalChunkManifestItem {
  chunkIndex: number;
  fileName: string;
  chunkSizeBytes: number;
  checksumSha256: string;
  storageObject: string;
}

interface LocalChunkManifest {
  requestId: string;
  generatedAt: string;
  maxChunkBytes: number;
  totalChunks: number;
  totalCompressedBytes: number;
  manifestChecksum: string;
  chunks: LocalChunkManifestItem[];
}

const isConfigured = (): boolean => Boolean(getSupabaseUrl() && getSupabaseAnonKey());

type SupabaseActorToken = { accessToken: string; expiresAtMs: number | null };
const actorSupabaseTokens = new Map<string, SupabaseActorToken>();
let scopedSupabaseAccessToken: string | null = null;
let scopedActorUserId: string | null = null;

const parseExpiryMs = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getActorAccessToken = (userId: string): string | null => {
  const row = actorSupabaseTokens.get(userId);
  if (!row) return null;
  if (row.expiresAtMs != null && row.expiresAtMs <= Date.now()) {
    actorSupabaseTokens.delete(userId);
    return null;
  }
  return row.accessToken;
};

export const setSyncActorAccessToken = (userId: string, accessToken: string, expiresAt?: string | null): void => {
  if (!userId || !accessToken) return;
  actorSupabaseTokens.set(userId, {
    accessToken,
    expiresAtMs: parseExpiryMs(expiresAt)
  });
};

export const clearSyncActorAccessToken = (userId: string): void => {
  if (!userId) return;
  actorSupabaseTokens.delete(userId);
};

const withActorToken = async <T>(actor: SyncActor, task: () => Promise<T>): Promise<T> => {
  const previousToken = scopedSupabaseAccessToken;
  const previousActor = scopedActorUserId;
  scopedSupabaseAccessToken = getActorAccessToken(actor.userId);
  scopedActorUserId = actor.userId;
  try {
    return await task();
  } finally {
    scopedSupabaseAccessToken = previousToken;
    scopedActorUserId = previousActor;
  }
};

const stateIdForActor = (actor: SyncActor): string => `sync:${actor.userId}`;

const canAdminSync = (actor: SyncActor): boolean => actor.role === 'system_admin';
const canEmployeePull = (actor: SyncActor): boolean => actor.role === 'employee';
const canPushLocalChanges = (actor: SyncActor): boolean => actor.role === 'system_admin' || actor.role === 'employee';
const canRequestFullSync = (actor: SyncActor): boolean => actor.role === 'system_admin';

const canPushEntityType = (actor: SyncActor, entityType: string): boolean => {
  if (canAdminSync(actor)) return entityType === 'employees' || entityType === 'products' || entityType === 'returns';
  if (actor.role !== 'employee') return false;
  return entityType === 'returns' || entityType === 'products' || entityType === 'employees';
};

const getPushableEntityTypes = (actor: SyncActor): Set<string> => {
  if (canAdminSync(actor)) return new Set(['employees', 'products', 'returns']);
  if (actor.role === 'employee') return new Set(['employees', 'products', 'returns']);
  return new Set<string>();
};

const normalizeEntityType = (value: string): string | null => {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '_');
  return entityAliases[key] || null;
};

const normalizeOperation = (value: string): QueueOperation => {
  const op = String(value || '').trim().toLowerCase();
  if (op === 'insert' || op === 'update' || op === 'delete') return op;
  return op === 'upsert' ? 'update' : 'update';
};

const readVersion = (value: unknown, fallback = 1): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};
const splitFullName = (fullName: string): { firstName: string; lastName: string } => {
  const normalized = String(fullName || '').trim();
  if (!normalized) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = normalized.split(/\s+/u);
  return {
    firstName: firstName || '',
    lastName: rest.join(' ')
  };
};

const parseTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const latestTimestamp = (...values: Array<string | null | undefined>): string | null => {
  let latest: string | null = null;
  let latestMs = -1;

  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed === null) continue;
    if (parsed > latestMs) {
      latestMs = parsed;
      latest = value || null;
    }
  }

  return latest;
};

const formatIsoUtc = (value: string | null): string => {
  if (!value) return 'unknown';
  const parsed = parseTimestamp(value);
  if (parsed === null) return value;
  return new Date(parsed).toISOString();
};
const sizeKbForJson = (value: unknown): number => {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
    return Number((bytes / 1024).toFixed(3));
  } catch {
    return 0;
  }
};
const sizeBytesForJson = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  } catch {
    return 0;
  }
};
const categoryLabelByKey: Record<LocalChangeCategoryKey, string> = {
  new_returns: 'New Returns',
  inventory_updates: 'Inventory Updates',
  property_assignments: 'Property Assignments',
  employee_submissions: 'Employee Submissions',
  other_changes: 'Other Changes'
};

const getQueueRetentionCutoffIso = (): string => new Date(Date.now() - SYNC_QUEUE_RETENTION_DAYS * DAY_IN_MS).toISOString();
const getOfflineCutoffMs = (): number => Date.now() - SYNC_MAX_OFFLINE_DAYS * DAY_IN_MS;

const buildFullSyncRequiredMessage = (lastSuccessfulAt: string | null): string =>
  `This device has been offline too long (more than ${SYNC_MAX_OFFLINE_DAYS} day${SYNC_MAX_OFFLINE_DAYS === 1 ? '' : 's'}). ` +
  `Last successful sync: ${formatIsoUtc(lastSuccessfulAt)}. To prevent data conflict, a full sync is required.`;

const buildStalePullMessage = (lastPullAt: string | null): string =>
  `This device has not pulled updates for more than ${SYNC_MAX_OFFLINE_DAYS} day${SYNC_MAX_OFFLINE_DAYS === 1 ? '' : 's'}. ` +
  `Last successful pull: ${formatIsoUtc(lastPullAt)}. To prevent missing expired queue records, a full sync is required.`;

const sleep = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));
const sha256Hex = (input: Buffer | string): string => createHash('sha256').update(input).digest('hex');
const encodeStorageObjectName = (value: string): string =>
  value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
const getFullSyncRootDir = (): string => path.join(app.getPath('userData'), 'full-sync');
const getFullSyncMasterDir = (requestId: string): string => path.join(getFullSyncRootDir(), 'master', requestId);
const getFullSyncRequesterDir = (requestId: string): string => path.join(getFullSyncRootDir(), 'requester', requestId);
const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};

const buildDeviceFingerprint = (): string => {
  const hostname = String(os.hostname() || '').trim().toLowerCase();
  const userHint = String(process.env.USERNAME || process.env.USER || '').trim().toLowerCase();
  const homeHint = path.basename(String(app.getPath('home') || '')).trim().toLowerCase();
  const userDataPath = String(app.getPath('userData') || '').trim().toLowerCase();
  const macs = Object.values(os.networkInterfaces())
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .map((item) => String(item?.mac || '').trim().toLowerCase())
    .filter((value) => value && value !== '00:00:00:00:00:00');
  const uniqueMacs = Array.from(new Set(macs)).sort();
  const raw = [
    process.platform,
    process.arch,
    hostname,
    userHint || homeHint,
    userDataPath,
    uniqueMacs.join(',')
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
};

let syncSchemaEnsured = false;
let lastRetentionCleanupAtMs = 0;

const getTableColumns = (db: Database.Database, tableName: string): Set<string> => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return new Set(rows.map((row) => String(row.name || '').trim()).filter(Boolean));
};

const ensureSyncSchema = (db: Database.Database): void => {
  if (syncSchemaEnsured) return;

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        device_id TEXT,
        last_auto_sync_at TEXT,
        last_full_sync_at TEXT,
        device_registered_at TEXT,
        online_mode INTEGER NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_successful_sync_at TEXT,
        last_push_count INTEGER NOT NULL DEFAULT 0,
        last_pull_count INTEGER NOT NULL DEFAULT 0,
        last_conflict_count INTEGER NOT NULL DEFAULT 0,
        full_sync_required INTEGER NOT NULL DEFAULT 0,
        full_sync_reason TEXT,
        last_status TEXT NOT NULL DEFAULT 'offline',
        last_error TEXT,
        last_warning TEXT,
        relay_queue_rows INTEGER NOT NULL DEFAULT 0,
        relay_queue_payload_mb REAL NOT NULL DEFAULT 0,
        relay_storage_mb REAL NOT NULL DEFAULT 0,
        relay_oldest_queue_at TEXT,
        relay_last_checked_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        pushed_count INTEGER NOT NULL DEFAULT 0,
        pulled_count INTEGER NOT NULL DEFAULT 0,
        conflict_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_device (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        device_id TEXT NOT NULL,
        fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_events_created_at ON sync_events(created_at DESC);
    `
  );

  const stateColumns = getTableColumns(db, 'sync_state');
  const hadLegacyModeColumn = stateColumns.has('mode');
  const ensureStateColumn = (name: string, definition: string) => {
    if (stateColumns.has(name)) return;
    db.exec(`ALTER TABLE sync_state ADD COLUMN ${name} ${definition}`);
    stateColumns.add(name);
  };

  ensureStateColumn('device_id', 'TEXT');
  ensureStateColumn('last_auto_sync_at', 'TEXT');
  ensureStateColumn('last_full_sync_at', 'TEXT');
  ensureStateColumn('device_registered_at', 'TEXT');
  ensureStateColumn('online_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureStateColumn('last_push_at', 'TEXT');
  ensureStateColumn('last_pull_at', 'TEXT');
  ensureStateColumn('last_successful_sync_at', 'TEXT');
  ensureStateColumn('last_push_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureStateColumn('last_pull_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureStateColumn('last_conflict_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureStateColumn('full_sync_required', 'INTEGER NOT NULL DEFAULT 0');
  ensureStateColumn('full_sync_reason', 'TEXT');
  ensureStateColumn('last_status', "TEXT NOT NULL DEFAULT 'offline'");
  ensureStateColumn('last_error', 'TEXT');
  ensureStateColumn('last_warning', 'TEXT');
  ensureStateColumn('relay_queue_rows', 'INTEGER NOT NULL DEFAULT 0');
  ensureStateColumn('relay_queue_payload_mb', 'REAL NOT NULL DEFAULT 0');
  ensureStateColumn('relay_storage_mb', 'REAL NOT NULL DEFAULT 0');
  ensureStateColumn('relay_oldest_queue_at', 'TEXT');
  ensureStateColumn('relay_last_checked_at', 'TEXT');
  ensureStateColumn('updated_at', "TEXT NOT NULL DEFAULT ''");

  if (hadLegacyModeColumn) {
    db.exec(
      `
        UPDATE sync_state
        SET online_mode = CASE
          WHEN lower(trim(coalesce(mode, ''))) IN ('online', '1', 'true') THEN 1
          ELSE online_mode
        END
      `
    );
  }

  db.prepare(
    `
      UPDATE sync_state
      SET
        device_id = CASE WHEN device_id IS NULL OR trim(device_id) = '' THEN NULL ELSE device_id END,
        last_auto_sync_at = CASE WHEN last_auto_sync_at IS NULL OR trim(last_auto_sync_at) = '' THEN NULL ELSE last_auto_sync_at END,
        last_full_sync_at = CASE WHEN last_full_sync_at IS NULL OR trim(last_full_sync_at) = '' THEN NULL ELSE last_full_sync_at END,
        device_registered_at = CASE
          WHEN device_registered_at IS NULL OR trim(device_registered_at) = '' THEN NULL
          ELSE device_registered_at
        END,
        online_mode = COALESCE(online_mode, 0),
        last_successful_sync_at = CASE
          WHEN last_successful_sync_at IS NULL OR trim(last_successful_sync_at) = '' THEN
            CASE
              WHEN last_push_at IS NOT NULL AND (last_pull_at IS NULL OR last_push_at >= last_pull_at) THEN last_push_at
              ELSE last_pull_at
            END
          ELSE last_successful_sync_at
        END,
        last_push_count = COALESCE(last_push_count, 0),
        last_pull_count = COALESCE(last_pull_count, 0),
        last_conflict_count = COALESCE(last_conflict_count, 0),
        full_sync_required = COALESCE(full_sync_required, 0),
        full_sync_reason = CASE
          WHEN COALESCE(full_sync_required, 0) = 1 THEN COALESCE(full_sync_reason, 'Full sync required.')
          ELSE NULL
        END,
        last_status = CASE WHEN last_status IS NULL OR trim(last_status) = '' THEN 'offline' ELSE last_status END,
        relay_queue_rows = COALESCE(relay_queue_rows, 0),
        relay_queue_payload_mb = COALESCE(relay_queue_payload_mb, 0),
        relay_storage_mb = COALESCE(relay_storage_mb, 0),
        relay_oldest_queue_at = CASE
          WHEN relay_oldest_queue_at IS NULL OR trim(relay_oldest_queue_at) = '' THEN NULL
          ELSE relay_oldest_queue_at
        END,
        relay_last_checked_at = CASE
          WHEN relay_last_checked_at IS NULL OR trim(relay_last_checked_at) = '' THEN NULL
          ELSE relay_last_checked_at
        END,
        updated_at = CASE WHEN updated_at IS NULL OR trim(updated_at) = '' THEN @now ELSE updated_at END
    `
  ).run({ now: nowIso() });

  const eventColumns = getTableColumns(db, 'sync_events');
  const ensureEventColumn = (name: string, definition: string) => {
    if (eventColumns.has(name)) return;
    db.exec(`ALTER TABLE sync_events ADD COLUMN ${name} ${definition}`);
    eventColumns.add(name);
  };

  ensureEventColumn('event_type', "TEXT NOT NULL DEFAULT ''");
  ensureEventColumn('message', "TEXT NOT NULL DEFAULT ''");
  ensureEventColumn('pushed_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureEventColumn('pulled_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureEventColumn('conflict_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureEventColumn('created_at', "TEXT NOT NULL DEFAULT ''");

  db.prepare(
    `
      UPDATE sync_events
      SET
        event_type = COALESCE(event_type, ''),
        message = COALESCE(message, ''),
        pushed_count = COALESCE(pushed_count, 0),
        pulled_count = COALESCE(pulled_count, 0),
        conflict_count = COALESCE(conflict_count, 0),
        created_at = CASE WHEN created_at IS NULL OR trim(created_at) = '' THEN @now ELSE created_at END
    `
  ).run({ now: nowIso() });

  const syncDeviceColumns = getTableColumns(db, 'sync_device');
  if (!syncDeviceColumns.has('fingerprint')) {
    db.exec('ALTER TABLE sync_device ADD COLUMN fingerprint TEXT');
  }

  syncSchemaEnsured = true;
};

const getLocalDeviceId = (db: Database.Database): string => {
  ensureSyncSchema(db);
  const runtimeFingerprint = buildDeviceFingerprint();
  const existing = db.prepare('SELECT device_id, fingerprint FROM sync_device WHERE id = 1').get() as
    | { device_id?: string; fingerprint?: string | null }
    | undefined;
  if (existing?.device_id) {
    const storedFingerprint = String(existing.fingerprint || '').trim();
    const now = nowIso();
    if (!storedFingerprint) {
      db.prepare('UPDATE sync_device SET fingerprint = ?, updated_at = ? WHERE id = 1').run(runtimeFingerprint, now);
      return existing.device_id;
    }
    if (storedFingerprint !== runtimeFingerprint) {
      const rotatedDeviceId = randomUUID();
      db
        .prepare('UPDATE sync_device SET device_id = ?, fingerprint = ?, updated_at = ? WHERE id = 1')
        .run(rotatedDeviceId, runtimeFingerprint, now);
      return rotatedDeviceId;
    }
    return existing.device_id;
  }

  const next = randomUUID();
  const now = nowIso();
  db
    .prepare('INSERT OR REPLACE INTO sync_device (id, device_id, fingerprint, created_at, updated_at) VALUES (1, ?, ?, ?, ?)')
    .run(next, runtimeFingerprint, now, now);
  return next;
};

const ensureSyncStateRow = (db: Database.Database, actor: SyncActor): void => {
  ensureSyncSchema(db);
  const deviceId = getLocalDeviceId(db);
  db.prepare(
    `
      INSERT OR IGNORE INTO sync_state (
        id, device_id, last_auto_sync_at, last_full_sync_at, device_registered_at,
        online_mode, last_push_at, last_pull_at, last_successful_sync_at, last_push_count, last_pull_count,
        last_conflict_count, full_sync_required, full_sync_reason, last_status, last_error, last_warning,
        relay_queue_rows, relay_queue_payload_mb, relay_storage_mb, relay_oldest_queue_at, relay_last_checked_at, updated_at
      ) VALUES (
        @id, @device_id, @last_auto_sync_at, @last_full_sync_at, @device_registered_at,
        @online_mode, @last_push_at, @last_pull_at, @last_successful_sync_at, @last_push_count, @last_pull_count,
        @last_conflict_count, @full_sync_required, @full_sync_reason, @last_status, @last_error, @last_warning,
        @relay_queue_rows, @relay_queue_payload_mb, @relay_storage_mb, @relay_oldest_queue_at, @relay_last_checked_at, @updated_at
      )
    `
  ).run({
    id: stateIdForActor(actor),
    device_id: deviceId,
    last_auto_sync_at: null,
    last_full_sync_at: null,
    device_registered_at: null,
    online_mode: 0,
    last_push_at: null,
    last_pull_at: null,
    last_successful_sync_at: null,
    last_push_count: 0,
    last_pull_count: 0,
    last_conflict_count: 0,
    full_sync_required: 0,
    full_sync_reason: null,
    last_status: 'offline',
    last_error: null,
    last_warning: null,
    relay_queue_rows: 0,
    relay_queue_payload_mb: 0,
    relay_storage_mb: 0,
    relay_oldest_queue_at: null,
    relay_last_checked_at: null,
    updated_at: nowIso()
  });

  db.prepare(
    `
      UPDATE sync_state
      SET device_id = @device_id
      WHERE id = @id
        AND (
          device_id IS NULL
          OR trim(device_id) = ''
          OR trim(device_id) <> trim(@device_id)
        )
    `
  ).run({
    id: stateIdForActor(actor),
    device_id: deviceId
  });
};

const readSyncState = (db: Database.Database, actor: SyncActor): SyncStateRow => {
  ensureSyncStateRow(db, actor);
  return db.prepare('SELECT * FROM sync_state WHERE id = ?').get(stateIdForActor(actor)) as SyncStateRow;
};

const writeSyncState = (db: Database.Database, actor: SyncActor, patch: Partial<SyncStateRow>): SyncStateRow => {
  const current = readSyncState(db, actor);
  const next: SyncStateRow = {
    ...current,
    ...patch,
    id: stateIdForActor(actor),
    updated_at: nowIso()
  };

  db.prepare(
    `
      UPDATE sync_state
      SET
        device_id = @device_id,
        last_auto_sync_at = @last_auto_sync_at,
        last_full_sync_at = @last_full_sync_at,
        device_registered_at = @device_registered_at,
        online_mode = @online_mode,
        last_push_at = @last_push_at,
        last_pull_at = @last_pull_at,
        last_successful_sync_at = @last_successful_sync_at,
        last_push_count = @last_push_count,
        last_pull_count = @last_pull_count,
        last_conflict_count = @last_conflict_count,
        full_sync_required = @full_sync_required,
        full_sync_reason = @full_sync_reason,
        last_status = @last_status,
        last_error = @last_error,
        last_warning = @last_warning,
        relay_queue_rows = @relay_queue_rows,
        relay_queue_payload_mb = @relay_queue_payload_mb,
        relay_storage_mb = @relay_storage_mb,
        relay_oldest_queue_at = @relay_oldest_queue_at,
        relay_last_checked_at = @relay_last_checked_at,
        updated_at = @updated_at
      WHERE id = @id
    `
  ).run(next);

  return next;
};

const getLastSuccessfulSyncAt = (state: SyncStateRow): string | null =>
  latestTimestamp(state.last_successful_sync_at, state.last_pull_at, state.last_push_at);

const getFullSyncRequiredReason = (state: SyncStateRow): string | null => {
  if (state.full_sync_required) {
    return state.full_sync_reason || buildFullSyncRequiredMessage(getLastSuccessfulSyncAt(state));
  }
  return null;
};

const markFullSyncRequired = (db: Database.Database, actor: SyncActor, state: SyncStateRow): SyncStateRow => {
  const reason = getFullSyncRequiredReason(state);
  if (!reason) return state;
  if (state.full_sync_required && state.full_sync_reason === reason && state.last_status === 'full_sync_required') {
    return state;
  }

  return writeSyncState(db, actor, {
    full_sync_required: 1,
    full_sync_reason: reason,
    last_status: 'full_sync_required',
    last_error: reason
  });
};

const isManualFullSyncEligible = (state: SyncStateRow): boolean => !state.device_registered_at || !state.last_full_sync_at;

const getManualFullSyncBlockReason = (state: SyncStateRow): string | null => {
  if (isManualFullSyncEligible(state)) return null;
  return (
    `Manual full sync is only allowed for new admin device onboarding. ` +
    `This device was registered at ${formatIsoUtc(state.device_registered_at)} and already completed full sync at ${formatIsoUtc(state.last_full_sync_at)}.`
  );
};

const logSyncEvent = (
  db: Database.Database,
  input: { eventType: string; message: string; pushedCount?: number; pulledCount?: number; conflictCount?: number }
): void => {
  ensureSyncSchema(db);
  db.prepare(
    `
      INSERT INTO sync_events (
        event_type, message, pushed_count, pulled_count, conflict_count, created_at
      ) VALUES (
        @event_type, @message, @pushed_count, @pulled_count, @conflict_count, @created_at
      )
    `
  ).run({
    event_type: input.eventType,
    message: input.message,
    pushed_count: input.pushedCount ?? 0,
    pulled_count: input.pulledCount ?? 0,
    conflict_count: input.conflictCount ?? 0,
    created_at: nowIso()
  });

  db.prepare(
    `
      DELETE FROM sync_events
      WHERE id NOT IN (
        SELECT id FROM sync_events ORDER BY id DESC LIMIT ?
      )
    `
  ).run(MAX_STORED_EVENTS);
};

const canActorPushOutboxRow = (
  actor: SyncActor,
  row: {
    entity_type: string;
    entity_id: string;
  }
): boolean => {
  if (actor.role !== 'employee') return true;
  if (row.entity_type !== 'employees') return true;
  return String(row.entity_id || '').trim() === String(actor.userId || '').trim();
};

const getPendingLocalChangeCount = (db: Database.Database, actor: SyncActor): number => {
  const pushableEntityTypes = getPushableEntityTypes(actor);
  if (!pushableEntityTypes.size) return 0;

  const pendingRows = db
    .prepare(
      `
        SELECT entity_type, entity_id
        FROM sync_outbox
        GROUP BY entity_type, entity_id
      `
    )
    .all() as Array<{ entity_type: string; entity_id: string }>;

  return pendingRows.reduce((count, row) => {
    if (!pushableEntityTypes.has(row.entity_type)) return count;
    if (!canActorPushOutboxRow(actor, row)) return count;
    return count + 1;
  }, 0);
};

const getRecentEvents = (db: Database.Database): SyncEventRow[] => {
  ensureSyncSchema(db);
  return db
    .prepare(
      `
        SELECT *
        FROM sync_events
        ORDER BY id DESC
        LIMIT ?
      `
    )
    .all(MAX_EVENT_LOG_ITEMS) as SyncEventRow[];
};

const getPendingOutboxRows = (db: Database.Database, actor: SyncActor): OutboxRow[] => {
  const pushableEntityTypes = getPushableEntityTypes(actor);
  if (!pushableEntityTypes.size) return [];

  const rows = db.prepare('SELECT * FROM sync_outbox ORDER BY id ASC').all() as OutboxRow[];
  const latestByEntity = new Map<string, OutboxRow>();

  for (const row of rows) {
    if (!pushableEntityTypes.has(row.entity_type)) continue;
    if (!canActorPushOutboxRow(actor, row)) continue;
    latestByEntity.set(`${row.entity_type}:${row.entity_id}`, row);
  }

  return Array.from(latestByEntity.values()).sort((a, b) => a.id - b.id);
};

const parseOutboxPayload = (row: OutboxRow): any => {
  try {
    return JSON.parse(row.payload || '{}');
  } catch {
    return {};
  }
};

const getLocalChangeCategory = (
  actor: SyncActor,
  entityType: string | null,
  operation: QueueOperation,
  payload: any
): LocalChangeCategoryKey => {
  if (entityType === 'returns' && operation === 'insert') {
    return actor.role === 'employee' ? 'employee_submissions' : 'new_returns';
  }

  if (entityType === 'products') {
    if (actor.role === 'employee') return 'employee_submissions';
    const assignmentChanged = Boolean(payload?._meta?.assignmentChanged);
    return assignmentChanged ? 'property_assignments' : 'inventory_updates';
  }

  if (entityType === 'returns' && actor.role === 'employee') {
    return 'employee_submissions';
  }
  if (entityType === 'employees' && actor.role === 'employee') {
    return 'employee_submissions';
  }

  return 'other_changes';
};

const buildLocalChangeLabel = (entityType: string | null, payload: any, recordId: string): string => {
  if (entityType === 'products') {
    const propertyNumber = payload?.propertyNumber || payload?.property_number || recordId;
    const article = payload?.article || '';
    return article ? `${propertyNumber} (${article})` : String(propertyNumber);
  }
  if (entityType === 'returns') {
    return String(payload?.rrspNumber || payload?.rrsp_number || recordId);
  }
  if (entityType === 'employees') {
    return String(payload?.email || payload?.fullName || payload?.full_name || recordId);
  }
  return String(recordId);
};

const buildLocalChangeSummary = (actor: SyncActor, rows: OutboxRow[]) => {
  const categories = new Map<LocalChangeCategoryKey, { count: number; sizeKb: number }>();
  const changes: LocalChangeSummaryItem[] = [];
  let totalSizeKb = 0;

  for (const row of rows) {
    const entityType = normalizeEntityType(row.entity_type);
    const operation = normalizeOperation(row.operation);
    const payload = parseOutboxPayload(row);
    const categoryKey = getLocalChangeCategory(actor, entityType, operation, payload);
    const sizeKb = sizeKbForJson(payload);
    totalSizeKb += sizeKb;

    const current = categories.get(categoryKey) || { count: 0, sizeKb: 0 };
    current.count += 1;
    current.sizeKb = Number((current.sizeKb + sizeKb).toFixed(3));
    categories.set(categoryKey, current);

    changes.push({
      outboxId: row.id,
      entityType: entityType || row.entity_type,
      entityId: row.entity_id,
      operation,
      categoryKey,
      label: buildLocalChangeLabel(entityType, payload, row.entity_id),
      sizeKb
    });
  }

  const totalBytes = Math.round(totalSizeKb * 1024);
  const recommendedBatchCountBySize = totalBytes === 0 ? 0 : Math.max(1, Math.ceil(totalBytes / SYNC_PUSH_MAX_BATCH_BYTES));
  const recommendedBatchCountByCount = rows.length === 0 ? 0 : Math.max(1, Math.ceil(rows.length / SYNC_PUSH_MAX_BATCH_RECORDS));
  const recommendedBatchCount = Math.max(recommendedBatchCountBySize, recommendedBatchCountByCount);

  return {
    total: rows.length,
    totalSizeKb: Number(totalSizeKb.toFixed(3)),
    safeToPush: true,
    recommendedBatchCount,
    maxBatchMb: SYNC_PUSH_MAX_BATCH_MB,
    categories: (Array.from(categories.entries()) as Array<[LocalChangeCategoryKey, { count: number; sizeKb: number }]>)
      .map(([key, value]) => ({
        key,
        label: categoryLabelByKey[key],
        count: value.count,
        sizeKb: Number(value.sizeKb.toFixed(3))
      }))
      .sort((a, b) => b.count - a.count),
    changes
  };
};

export function getLocalChanges(actor: SyncActor) {
  const db = dataStore.getDb();
  const rows = getPendingOutboxRows(db, actor);
  return buildLocalChangeSummary(actor, rows);
}

const pruneUnsupportedOutboxRows = (db: Database.Database): number => {
  const result = db.prepare("DELETE FROM sync_outbox WHERE entity_type = 'activity_logs'").run();
  return result.changes ?? 0;
};

const markOutboxAttemptError = (db: Database.Database, ids: number[], errorMessage: string): void => {
  if (!ids.length) return;
  const stmt = db.prepare(
    `
      UPDATE sync_outbox
      SET attempts = COALESCE(attempts, 0) + 1,
          last_error = @last_error,
          next_retry_at = NULL
      WHERE id = @id
    `
  );

  const tx = db.transaction(() => {
    for (const id of ids) {
      stmt.run({ id, last_error: errorMessage });
    }
  });

  tx();
};

const markEntitySynced = (db: Database.Database, entityType: string, entityId: string, syncedAt: string): void => {
  const table = entityToTable[entityType];
  if (!table) return;

  db.prepare(`UPDATE ${table} SET sync_status = 'synced', is_dirty = 0, last_synced_at = ? WHERE id = ?`).run(
    syncedAt,
    entityId
  );
};

const clearOutboxEntity = (db: Database.Database, entityType: string, entityId: string): void => {
  db.prepare('DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
};

const markEntityConflict = (db: Database.Database, entityType: string, entityId: string): void => {
  const table = entityToTable[entityType];
  if (!table) return;
  db.prepare(`UPDATE ${table} SET sync_status = 'conflict' WHERE id = ?`).run(entityId);
};

const getLocalRecordMeta = (
  db: Database.Database,
  entityType: string,
  recordId: string
): { exists: boolean; version: number; lastModified: string | null } => {
  const table = entityToTable[entityType];
  if (!table) return { exists: false, version: 0, lastModified: null };
  const row = db
    .prepare(`SELECT version, last_modified FROM ${table} WHERE id = ?`)
    .get(recordId) as { version?: number; last_modified?: string | null } | undefined;
  return {
    exists: Boolean(row),
    version: readVersion(row?.version, 0),
    lastModified: row?.last_modified ?? null
  };
};

const getLocalVersion = (db: Database.Database, entityType: string, recordId: string): number => {
  return getLocalRecordMeta(db, entityType, recordId).version;
};

const getLocalEmployeeMetaByIdentity = (
  db: Database.Database,
  remoteData: any
): { exists: boolean; version: number; lastModified: string | null } => {
  const supabaseUserId = String(remoteData?.supabaseUserId ?? remoteData?.supabase_user_id ?? '').trim();
  if (supabaseUserId) {
    const bySupabase = db
      .prepare('SELECT version, last_modified FROM employees WHERE supabase_user_id = ? LIMIT 1')
      .get(supabaseUserId) as { version?: number; last_modified?: string | null } | undefined;
    if (bySupabase) {
      return {
        exists: true,
        version: readVersion(bySupabase.version, 0),
        lastModified: bySupabase.last_modified ?? null
      };
    }
  }

  const email = String(remoteData?.email ?? '').trim().toLowerCase();
  if (email) {
    const byEmail = db
      .prepare('SELECT version, last_modified FROM employees WHERE lower(email) = ? LIMIT 1')
      .get(email) as { version?: number; last_modified?: string | null } | undefined;
    if (byEmail) {
      return {
        exists: true,
        version: readVersion(byEmail.version, 0),
        lastModified: byEmail.last_modified ?? null
      };
    }
  }

  return { exists: false, version: 0, lastModified: null };
};

const getLocalRecordMetaForRemote = (
  db: Database.Database,
  entityType: string,
  recordId: string,
  remoteData: any
): { exists: boolean; version: number; lastModified: string | null } => {
  const direct = getLocalRecordMeta(db, entityType, recordId);
  if (direct.exists) return direct;
  if (entityType !== 'employees') return direct;
  return getLocalEmployeeMetaByIdentity(db, remoteData);
};

const resolveLocalEmployeeRecordIdForRemote = (db: Database.Database, recordId: string, remoteData: any): string => {
  const direct = db.prepare('SELECT id FROM employees WHERE id = ? LIMIT 1').get(recordId) as { id?: string } | undefined;
  if (direct?.id) return String(direct.id);

  const supabaseUserId = String(remoteData?.supabaseUserId ?? remoteData?.supabase_user_id ?? '').trim();
  if (supabaseUserId) {
    const bySupabase = db
      .prepare('SELECT id FROM employees WHERE supabase_user_id = ? LIMIT 1')
      .get(supabaseUserId) as { id?: string } | undefined;
    if (bySupabase?.id) return String(bySupabase.id);
  }

  const email = String(remoteData?.email ?? '').trim().toLowerCase();
  if (email) {
    const byEmail = db
      .prepare('SELECT id FROM employees WHERE lower(email) = ? LIMIT 1')
      .get(email) as { id?: string } | undefined;
    if (byEmail?.id) return String(byEmail.id);
  }

  return recordId;
};

const normalizeActorRole = (value: unknown): SyncRole | null => {
  const role = String(value || '')
    .trim()
    .toLowerCase();
  if (role === 'system_admin' || role === 'admin') return 'system_admin';
  if (role === 'employee' || role === 'supervisor') return 'employee';
  return null;
};

const normalizeActorStatus = (value: unknown): 'active' | 'inactive' => {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  return status === 'inactive' ? 'inactive' : 'active';
};

const parseSupabaseError = (raw: string): { code?: string; message: string } => {
  const text = String(raw || '').trim();
  if (!text) return { message: '' };
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string; hint?: string };
    return {
      code: parsed?.code,
      message: parsed?.message || parsed?.hint || text
    };
  } catch {
    return { message: text };
  }
};

const ensureScopedAccessToken = async (): Promise<string> => {
  if (scopedSupabaseAccessToken) return scopedSupabaseAccessToken;
  if (!scopedActorUserId) {
    throw new Error('Supabase session is missing. Sign in online and retry.');
  }

  const refreshed = await authService.refreshSession(scopedActorUserId);
  if (!refreshed.success) {
    const failure = refreshed as { success: false; error: string };
    throw new Error(
      failure.error || 'Supabase session is missing or expired. Sign in online and retry sync.'
    );
  }

  setSyncActorAccessToken(scopedActorUserId, refreshed.accessToken, refreshed.expiresAt);
  scopedSupabaseAccessToken = refreshed.accessToken;
  return refreshed.accessToken;
};

const fetchActorAppUserRow = async (
  supabaseUserId: string
): Promise<{ role: string; account_status: string; employee_id: string | null } | null> => {
  const params = new URLSearchParams();
  params.set('select', 'user_id,employee_id,role,account_status');
  params.set('user_id', `eq.${supabaseUserId}`);
  params.set('limit', '1');
  const response = await supabaseRequest(`${getAppUsersTable()}?${params.toString()}`, { method: 'GET' });
  const rows = (await response.json()) as Array<{ employee_id?: string | null; role?: string | null; account_status?: string | null }>;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] || {};
  return {
    employee_id: row.employee_id ? String(row.employee_id).trim() : null,
    role: String(row.role || ''),
    account_status: String(row.account_status || 'active')
  };
};

const ensureActorQueuePermission = async (
  actor: SyncActor,
  supabaseUserId: string
): Promise<{ error: string | null; remoteEmployeeId: string | null }> => {
  const appUser = await fetchActorAppUserRow(supabaseUserId);
  if (!appUser) {
    return {
      error: `Supabase app user profile is missing for this account (${supabaseUserId}). Insert/update ${getAppUsersTable()} with an active ${actor.role} role, then retry push.`,
      remoteEmployeeId: null
    };
  }

  const remoteRole = normalizeActorRole(appUser.role);
  const remoteStatus = normalizeActorStatus(appUser.account_status);
  if (remoteStatus !== 'active') {
    return {
      error: 'Supabase app user is inactive. Activate account_status in app_users before pushing.',
      remoteEmployeeId: appUser.employee_id
    };
  }

  if (canAdminSync(actor) && remoteRole !== 'system_admin') {
    return {
      error: `Push denied: authenticated Supabase role is "${remoteRole || 'unknown'}", expected "system_admin".`,
      remoteEmployeeId: appUser.employee_id
    };
  }
  if (!canAdminSync(actor) && remoteRole !== 'employee') {
    return {
      error: `Push denied: authenticated Supabase role is "${remoteRole || 'unknown'}", expected "employee".`,
      remoteEmployeeId: appUser.employee_id
    };
  }
  if (!canAdminSync(actor) && !appUser.employee_id) {
    return {
      error: `Push denied: ${getAppUsersTable()}.employee_id is missing for this employee account.`,
      remoteEmployeeId: null
    };
  }
  return { error: null, remoteEmployeeId: appUser.employee_id };
};

const quoteInValues = (values: string[]): string =>
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => `"${value.replace(/"/gu, '""')}"`)
    .join(',');

const callRpcMaybe = async (fnName: string, payload: Record<string, unknown> = {}) => {
  return supabaseRequest(`rpc/${fnName}`, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload)
  });
};

const touchActorPresence = async (db: Database.Database, actor: SyncActor, originUserId?: string | null): Promise<void> => {
  if (!isConfigured()) return;
  const resolvedOriginUserId = originUserId || resolveOriginUserId(db, actor);
  if (!resolvedOriginUserId) return;
  const params = new URLSearchParams();
  params.set('user_id', `eq.${resolvedOriginUserId}`);
  const seenAt = nowIso();
  const deviceId = getLocalDeviceId(db);
  try {
    await supabaseRequest(`${getAppUsersTable()}?${params.toString()}`, {
      method: 'PATCH',
      body: JSON.stringify({
        last_seen_at: seenAt,
        last_seen_device_id: deviceId,
        updated_at: seenAt
      })
    });
  } catch {
    // Presence heartbeat is best-effort and should not block sync operations.
  }
};

const fetchEmployeePresenceMap = async (employeeIds: string[]): Promise<Map<string, AppUserPresenceRow>> => {
  const uniqueIds = Array.from(new Set(employeeIds.map((value) => String(value || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return new Map<string, AppUserPresenceRow>();
  const params = new URLSearchParams();
  params.set('select', 'employee_id,role,account_status,last_seen_at,updated_at');
  params.set('employee_id', `in.(${quoteInValues(uniqueIds)})`);
  params.set('limit', String(uniqueIds.length));
  const response = await supabaseRequest(`${getAppUsersTable()}?${params.toString()}`, { method: 'GET' });
  const rows = (await response.json()) as AppUserPresenceRow[];
  const map = new Map<string, AppUserPresenceRow>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const key = String(row?.employee_id || '').trim();
      if (!key) continue;
      map.set(key, row);
    }
  }
  return map;
};

const extractPresenceMs = (row: AppUserPresenceRow | undefined): number | null => {
  if (!row) return null;
  const lastSeenMs = parseTimestamp(row.last_seen_at);
  if (lastSeenMs != null) return lastSeenMs;
  return parseTimestamp(row.updated_at);
};

const getStaleRecipients = (presence: Map<string, AppUserPresenceRow>, employeeIds: string[]): Set<string> => {
  const staleCutoffMs = Date.now() - SYNC_TARGET_STALE_DAYS * DAY_IN_MS;
  const stale = new Set<string>();
  for (const employeeId of employeeIds) {
    const normalized = String(employeeId || '').trim();
    if (!normalized) continue;
    const row = presence.get(normalized);
    const seenMs = extractPresenceMs(row);
    const role = normalizeActorRole(String(row?.role || 'employee'));
    const status = normalizeActorStatus(String(row?.account_status || 'active'));
    if (status !== 'active' || role !== 'employee' || seenMs == null || seenMs < staleCutoffMs) {
      stale.add(normalized);
    }
  }
  return stale;
};

const hasRecentAdminPresence = async (): Promise<boolean | null> => {
  try {
    const response = await callRpcMaybe('sync_has_recent_admin_activity', {
      min_days: SYNC_TARGET_STALE_DAYS
    });
    const payload = await response.json();
    if (typeof payload === 'boolean') return payload;
    if (Array.isArray(payload) && payload.length > 0) {
      const first = payload[0] as Record<string, unknown>;
      if (typeof first?.sync_has_recent_admin_activity === 'boolean') {
        return Boolean(first.sync_has_recent_admin_activity);
      }
    }
    if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).sync_has_recent_admin_activity === 'boolean') {
      return Boolean((payload as Record<string, unknown>).sync_has_recent_admin_activity);
    }
    return null;
  } catch {
    return null;
  }
};

const supabaseRequest = async (pathAndQuery: string, init?: RequestInit): Promise<Response> => {
  if (!isConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
    );
  }

  const supabaseAnonKey = getSupabaseAnonKey();
  const supabaseUrl = getSupabaseUrl();
  const accessToken = await ensureScopedAccessToken();

  const headers: Record<string, string> = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`
  };

  if (init?.body) {
    headers['content-type'] = 'application/json';
    headers.Prefer = 'return=minimal';
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined)
    }
  });

  if (!response.ok) {
    const raw = (await response.text()) || `Supabase request failed with status ${response.status}`;
    const parsed = parseSupabaseError(raw);
    if (parsed.code === '42501' && pathAndQuery.startsWith(getAdminQueueTable())) {
      throw new Error(
        'RLS denied push to admin queue. Ensure app_users has this Supabase user as active system_admin, then retry.'
      );
    }
    if (parsed.code === '42501' && pathAndQuery.startsWith(getEmployeeQueueTable())) {
      throw new Error(
        'RLS denied sync to employee queue. Ensure app_users role/status is active and queue policies are applied.'
      );
    }
    throw new Error(parsed.message || raw);
  }

  return response;
};

const supabaseStorageRequest = async (pathAndQuery: string, init?: RequestInit): Promise<Response> => {
  if (!isConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
    );
  }

  const supabaseAnonKey = getSupabaseAnonKey();
  const supabaseUrl = getSupabaseUrl();
  const accessToken = await ensureScopedAccessToken();

  const response = await fetch(`${supabaseUrl}/storage/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers as Record<string, string> | undefined)
    }
  });

  if (!response.ok) {
    const raw = (await response.text()) || `Supabase storage request failed with status ${response.status}`;
    const parsed = parseSupabaseError(raw);
    throw new Error(parsed.message || raw);
  }

  return response;
};

const uploadStorageObject = async (objectName: string, content: Buffer): Promise<void> => {
  const bucket = encodeURIComponent(getFullSyncStorageBucket());
  const encodedObject = encodeStorageObjectName(objectName);
  await supabaseStorageRequest(`object/${bucket}/${encodedObject}`, {
    method: 'POST',
    headers: {
      'x-upsert': 'true',
      'content-type': 'application/octet-stream'
    },
    body: new Uint8Array(content)
  });
};

const downloadStorageObject = async (objectName: string): Promise<Buffer> => {
  const bucket = encodeURIComponent(getFullSyncStorageBucket());
  const encodedObject = encodeStorageObjectName(objectName);
  const response = await supabaseStorageRequest(`object/${bucket}/${encodedObject}`, { method: 'GET' });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const deleteStorageObject = async (objectName: string): Promise<void> => {
  const bucket = encodeURIComponent(getFullSyncStorageBucket());
  const encodedObject = encodeStorageObjectName(objectName);
  await supabaseStorageRequest(`object/${bucket}/${encodedObject}`, { method: 'DELETE' });
};

const pushQueueBatch = async (tableName: string, records: Array<Record<string, unknown>>): Promise<void> => {
  if (!records.length) return;
  const postUpsert = async (payloadRows: Array<Record<string, unknown>>) =>
    supabaseRequest(`${tableName}?on_conflict=recipient_key,table_name,record_id`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(payloadRows)
    });

  const stripLegacyColumns = (payloadRows: Array<Record<string, unknown>>) =>
    payloadRows.map((record) => {
      const { updated_at, recipient_key, ...rest } = record as Record<string, unknown>;
      void updated_at;
      void recipient_key;
      return rest;
    });

  try {
    await postUpsert(records);
    return;
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    const rlsCompatibilityRetry =
      message.includes('rls denied sync to employee queue') || message.includes('rls denied push to admin queue');
    if (rlsCompatibilityRetry) {
      await supabaseRequest(tableName, {
        method: 'POST',
        body: JSON.stringify(records)
      });
      return;
    }
    const needsLegacyRetry =
      message.includes('updated_at') ||
      message.includes('recipient_key') ||
      message.includes('on_conflict') ||
      message.includes('merge-duplicates');
    if (!needsLegacyRetry) throw error;
  }

  const legacyRecords = stripLegacyColumns(records);
  await supabaseRequest(tableName, {
    method: 'POST',
    body: JSON.stringify(legacyRecords)
  });
};

const EMPLOYEE_ID_NULL_FILTER = '__is_null__';

const fetchRemoteQueuePage = async (
  tableName: string,
  sinceTimestamp: string | null,
  employeeId: string | null,
  excludeOriginDeviceId: string | null,
  offset: number,
  limit: number
): Promise<RemoteQueueRow[]> => {
  const params = new URLSearchParams();
  const selectWithUpdatedAt =
    'id,employee_id,recipient_key,origin_device_id,origin_user_id,payload,payload_size_kb,created_at,updated_at,table_name,operation,record_id,data,timestamp';
  const selectLegacy =
    'id,employee_id,origin_device_id,origin_user_id,payload,payload_size_kb,created_at,table_name,operation,record_id,data,timestamp';
  params.set('select', selectWithUpdatedAt);
  params.set('order', 'created_at.asc,id.asc');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (sinceTimestamp) {
    params.set('created_at', `gt.${sinceTimestamp}`);
  }
  if (employeeId === EMPLOYEE_ID_NULL_FILTER) {
    params.set('recipient_key', `eq.${RELAY_RECIPIENT_ALL}`);
  } else if (employeeId) {
    params.set('employee_id', `eq.${employeeId}`);
  }
  if (excludeOriginDeviceId) {
    params.set('or', `(origin_device_id.is.null,origin_device_id.neq.${excludeOriginDeviceId})`);
  }

  let response: Response;
  try {
    response = await supabaseRequest(`${tableName}?${params.toString()}`, { method: 'GET' });
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    const missingUpdatedAt = message.includes('updated_at');
    const missingRecipientKey = message.includes('recipient_key');
    if (!missingUpdatedAt && !missingRecipientKey) throw error;
    if (missingUpdatedAt) {
      params.set('select', selectLegacy);
    }
    if (missingRecipientKey && employeeId === EMPLOYEE_ID_NULL_FILTER) {
      params.delete('recipient_key');
      params.set('employee_id', 'is.null');
    }
    response = await supabaseRequest(`${tableName}?${params.toString()}`, { method: 'GET' });
  }

  const rows = (await response.json()) as RemoteQueueRow[];
  return Array.isArray(rows) ? rows : [];
};

const fetchAllRemoteQueueRows = async (
  tableName: string,
  sinceTimestamp: string | null,
  employeeId: string | null = null,
  excludeOriginDeviceId: string | null = null
): Promise<RemoteQueueRow[]> => {
  const pullPageSize = getPullPageSize();
  const rows: RemoteQueueRow[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchRemoteQueuePage(tableName, sinceTimestamp, employeeId, excludeOriginDeviceId, offset, pullPageSize);
    rows.push(...page);
    if (page.length < pullPageSize) break;
    offset += pullPageSize;
  }

  return rows;
};

const readRemotePayload = (row: RemoteQueueRow): any => {
  if (row.payload && typeof row.payload === 'object') return row.payload;
  return null;
};

const readRemoteTableName = (row: RemoteQueueRow): string | null => {
  const payload = readRemotePayload(row);
  const value = payload?.table_name ?? row.table_name;
  return value ? String(value) : null;
};

const readRemoteOperation = (row: RemoteQueueRow): QueueOperation => {
  const payload = readRemotePayload(row);
  return normalizeOperation(payload?.operation ?? row.operation ?? 'update');
};

const readRemoteRecordId = (row: RemoteQueueRow): string => {
  const payload = readRemotePayload(row);
  return String(payload?.record_id ?? row.record_id ?? '');
};

const readRemoteData = (row: RemoteQueueRow): any => {
  const payload = readRemotePayload(row);
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }
  return row.data || {};
};

const readRemoteTimestamp = (row: RemoteQueueRow): string => {
  if (row.created_at) return row.created_at;
  if (row.updated_at) return row.updated_at;
  if (row.timestamp) return row.timestamp;
  return nowIso();
};

const readRemoteUpdatedAt = (row: RemoteQueueRow, remoteData: any): string => {
  const payload = readRemotePayload(row);
  const candidate =
    payload?.updated_at ??
    row.updated_at ??
    remoteData?.updatedAt ??
    remoteData?.lastModified ??
    remoteData?.createdAt ??
    row.created_at ??
    row.timestamp;
  if (!candidate) return nowIso();
  return String(candidate);
};

const deleteRemoteQueueRows = async (tableName: string, ids: string[], excludeOriginDeviceId: string | null = null): Promise<void> => {
  if (!ids.length) return;
  const pullPageSize = getPullPageSize();

  for (let index = 0; index < ids.length; index += pullPageSize) {
    const chunk = ids.slice(index, index + pullPageSize);
    const params = new URLSearchParams();
    params.set('id', `in.(${chunk.join(',')})`);
    if (excludeOriginDeviceId) {
      params.set('or', `(origin_device_id.is.null,origin_device_id.neq.${excludeOriginDeviceId})`);
    }
    await supabaseRequest(`${tableName}?${params.toString()}`, { method: 'DELETE' });
  }
};

const deleteRemoteQueueRowsWithRetry = async (
  tableName: string,
  ids: string[],
  excludeOriginDeviceId: string | null = null
): Promise<void> => {
  if (!ids.length) return;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= SYNC_DELETE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await deleteRemoteQueueRows(tableName, ids, excludeOriginDeviceId);
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt < SYNC_DELETE_RETRY_ATTEMPTS) {
        await sleep(300 * attempt);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Queue deletion failed';
  throw new Error(
    `Applied changes locally but failed to delete pulled queue records after ${SYNC_DELETE_RETRY_ATTEMPTS} attempt(s): ${message}`
  );
};

const pushProfileImageQueueRows = async (rows: Array<Record<string, unknown>>): Promise<void> => {
  if (!rows.length) return;
  await supabaseRequest(getProfileQueueTable(), {
    method: 'POST',
    headers: {
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
};

const fetchProfileImageQueueRows = async (
  actor: SyncActor,
  excludeOriginDeviceId: string | null
): Promise<ProfileImageQueueRow[]> => {
  const rows: ProfileImageQueueRow[] = [];
  const pageSize = getPullPageSize();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set('select', 'id,employee_id,origin_device_id,origin_user_id,image_data,image_format,updated_at,created_at');
    params.set('order', 'updated_at.asc,id.asc');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    if (!canAdminSync(actor)) {
      params.set('employee_id', `eq.${actor.userId}`);
    }
    if (excludeOriginDeviceId) {
      params.set('or', `(origin_device_id.is.null,origin_device_id.neq.${excludeOriginDeviceId})`);
    }
    const response = await supabaseRequest(`${getProfileQueueTable()}?${params.toString()}`, { method: 'GET' });
    const page = (await response.json()) as ProfileImageQueueRow[];
    if (!Array.isArray(page) || page.length === 0) {
      break;
    }
    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return rows;
};

const getProfileImageUpdatedAtCandidate = (value: unknown): string | null => {
  const candidate = String(value ?? '').trim();
  if (!candidate) return null;
  return candidate;
};

const getProfileImageFormat = (imageDataUrl: string | null, fallback: string | null = null): string | null => {
  const value = String(imageDataUrl || '').trim();
  if (!value.startsWith('data:')) return fallback;
  const marker = value.slice(5, value.indexOf(';') > 0 ? value.indexOf(';') : undefined);
  return marker || fallback;
};

const pullProfileImageRelayChanges = async (
  db: Database.Database,
  actor: SyncActor,
  currentDeviceId: string
): Promise<{ pulled: number; skipped: number }> => {
  const rows = await fetchProfileImageQueueRows(actor, currentDeviceId);
  if (!rows.length) return { pulled: 0, skipped: 0 };

  const rowIdsToDelete: string[] = [];
  let pulled = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const employeeId = String(row.employee_id || '').trim();
      if (!employeeId) continue;
      const local = db
        .prepare('SELECT profile_image_updated_at FROM employees WHERE id = ? LIMIT 1')
        .get(employeeId) as { profile_image_updated_at?: string | null } | undefined;
      if (!local) {
        skipped += 1;
        continue;
      }

      const remoteUpdatedAt =
        getProfileImageUpdatedAtCandidate(row.updated_at) ||
        getProfileImageUpdatedAtCandidate(row.created_at) ||
        nowIso();
      const localUpdatedAt = getProfileImageUpdatedAtCandidate(local.profile_image_updated_at);
      const remoteUpdatedMs = parseTimestamp(remoteUpdatedAt);
      const localUpdatedMs = parseTimestamp(localUpdatedAt);

      if (localUpdatedMs != null && remoteUpdatedMs != null && remoteUpdatedMs <= localUpdatedMs) {
        rowIdsToDelete.push(row.id);
        skipped += 1;
        continue;
      }

      const imageDataUrl = row.image_data == null ? null : String(row.image_data);
      const imageFormat = row.image_format ? String(row.image_format) : getProfileImageFormat(imageDataUrl, null);

      db.prepare(
        `
          UPDATE employees
          SET
            profile_image_data = @profile_image_data,
            profile_image_format = @profile_image_format,
            profile_image_updated_at = @profile_image_updated_at,
            last_modified = CASE
              WHEN last_modified IS NULL OR last_modified = '' OR last_modified < @last_modified
                THEN @last_modified
              ELSE last_modified
            END
          WHERE id = @id
        `
      ).run({
        id: employeeId,
        profile_image_data: imageDataUrl,
        profile_image_format: imageFormat,
        profile_image_updated_at: remoteUpdatedAt,
        last_modified: remoteUpdatedAt
      });

      rowIdsToDelete.push(row.id);
      pulled += 1;
    }
  });
  tx();

  if (rowIdsToDelete.length) {
    await deleteRemoteQueueRowsWithRetry(getProfileQueueTable(), rowIdsToDelete, currentDeviceId);
  }
  return { pulled, skipped };
};

const deleteQueueRowsOlderThan = async (tableName: string, cutoffIso: string): Promise<void> => {
  const params = new URLSearchParams();
  params.set('created_at', `lt.${cutoffIso}`);
  await supabaseRequest(`${tableName}?${params.toString()}`, { method: 'DELETE' });
};

const mbFromBytes = (value: number): number => Number((Math.max(0, value) / (1024 * 1024)).toFixed(3));

const parseRelayUsageStats = (input: any): RelayUsageStats | null => {
  if (!input || typeof input !== 'object') return null;
  const payload = Array.isArray(input) ? input[0] : input;
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  const adminQueueRows = Number(row.admin_queue_rows ?? row.adminQueueRows ?? 0);
  const employeeQueueRows = Number(row.employee_queue_rows ?? row.employeeQueueRows ?? 0);
  const totalQueueRows = Number(row.total_queue_rows ?? row.totalQueueRows ?? adminQueueRows + employeeQueueRows);
  const queuePayloadMb = Number(row.queue_payload_mb ?? row.queuePayloadMb ?? 0);
  const fullSyncChunkRows = Number(row.full_sync_chunk_rows ?? row.fullSyncChunkRows ?? 0);
  const fullSyncRequestRows = Number(row.full_sync_request_rows ?? row.fullSyncRequestRows ?? 0);
  const storageObjects = Number(row.storage_objects ?? row.storageObjects ?? 0);
  const storageMb = Number(row.storage_mb ?? row.storageMb ?? 0);
  const oldestQueueAtRaw = row.oldest_queue_at ?? row.oldestQueueAt ?? null;
  const oldestQueueAt = oldestQueueAtRaw ? String(oldestQueueAtRaw) : null;
  return {
    adminQueueRows: Number.isFinite(adminQueueRows) ? adminQueueRows : 0,
    employeeQueueRows: Number.isFinite(employeeQueueRows) ? employeeQueueRows : 0,
    totalQueueRows: Number.isFinite(totalQueueRows) ? totalQueueRows : 0,
    queuePayloadMb: Number.isFinite(queuePayloadMb) ? Number(queuePayloadMb.toFixed(3)) : 0,
    fullSyncChunkRows: Number.isFinite(fullSyncChunkRows) ? fullSyncChunkRows : 0,
    fullSyncRequestRows: Number.isFinite(fullSyncRequestRows) ? fullSyncRequestRows : 0,
    storageObjects: Number.isFinite(storageObjects) ? storageObjects : 0,
    storageMb: Number.isFinite(storageMb) ? Number(storageMb.toFixed(3)) : 0,
    oldestQueueAt
  };
};

const fetchRelayUsageStats = async (): Promise<RelayUsageStats | null> => {
  try {
    const response = await callRpcMaybe('sync_relay_usage_stats');
    const payload = await response.json();
    return parseRelayUsageStats(payload);
  } catch {
    return null;
  }
};

const evaluateRelayPressure = (
  stats: RelayUsageStats,
  projectedPushBytes: number
): { block: boolean; warning: string | null; projectedQueueMb: number } => {
  const projectedQueueMb = Number((stats.queuePayloadMb + mbFromBytes(projectedPushBytes)).toFixed(3));
  const queueSoftCap = SYNC_RELAY_DB_LIMIT_MB * SYNC_RELAY_DB_SOFT_THRESHOLD;
  const queueHardCap = SYNC_RELAY_DB_LIMIT_MB * SYNC_RELAY_DB_HARD_THRESHOLD;
  const storageSoftCap = SYNC_RELAY_STORAGE_LIMIT_MB * SYNC_RELAY_STORAGE_SOFT_THRESHOLD;
  const storageHardCap = SYNC_RELAY_STORAGE_LIMIT_MB * SYNC_RELAY_STORAGE_HARD_THRESHOLD;
  const queueFreeMb = SYNC_RELAY_DB_LIMIT_MB - projectedQueueMb;
  const storageFreeMb = SYNC_RELAY_STORAGE_LIMIT_MB - stats.storageMb;

  const queueHardExceeded = projectedQueueMb >= queueHardCap || queueFreeMb <= SYNC_RELAY_HARD_STOP_MIN_FREE_MB;
  const storageHardExceeded = stats.storageMb >= storageHardCap || storageFreeMb <= SYNC_RELAY_HARD_STOP_MIN_FREE_MB;
  if (queueHardExceeded || storageHardExceeded) {
    const reason = queueHardExceeded
      ? `relay DB projected to ${projectedQueueMb.toFixed(2)}MB (limit ${SYNC_RELAY_DB_LIMIT_MB}MB)`
      : `relay storage at ${stats.storageMb.toFixed(2)}MB (limit ${SYNC_RELAY_STORAGE_LIMIT_MB}MB)`;
    return {
      block: true,
      warning:
        `Push paused to protect Supabase free-tier quotas: ${reason}. ` +
        'Auto pull/cleanup will continue; push resumes after relay usage drops.',
      projectedQueueMb
    };
  }

  const queueSoftExceeded = projectedQueueMb >= queueSoftCap;
  const storageSoftExceeded = stats.storageMb >= storageSoftCap;
  if (queueSoftExceeded || storageSoftExceeded) {
    return {
      block: false,
      warning:
        `Relay usage warning: queue ${projectedQueueMb.toFixed(2)}MB/${SYNC_RELAY_DB_LIMIT_MB}MB, ` +
        `storage ${stats.storageMb.toFixed(2)}MB/${SYNC_RELAY_STORAGE_LIMIT_MB}MB.`,
      projectedQueueMb
    };
  }

  return { block: false, warning: null, projectedQueueMb };
};

const persistRelayUsageSnapshot = (
  db: Database.Database,
  actor: SyncActor,
  stats: RelayUsageStats,
  warning: string | null
): void => {
  writeSyncState(db, actor, {
    relay_queue_rows: stats.totalQueueRows,
    relay_queue_payload_mb: stats.queuePayloadMb,
    relay_storage_mb: stats.storageMb,
    relay_oldest_queue_at: stats.oldestQueueAt,
    relay_last_checked_at: nowIso(),
    last_warning: warning
  });
};

interface StorageListRow {
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const listStorageObjectsPage = async (offset: number, limit: number): Promise<StorageListRow[]> => {
  const bucket = encodeURIComponent(getFullSyncStorageBucket());
  const response = await supabaseStorageRequest(`object/list/${bucket}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      limit,
      offset,
      sortBy: {
        column: 'name',
        order: 'asc'
      }
    })
  });
  const rows = (await response.json()) as StorageListRow[];
  return Array.isArray(rows) ? rows : [];
};

const fetchProtectedFullSyncStorageObjects = async (): Promise<Set<string>> => {
  const protectedObjects = new Set<string>();
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams();
    params.set('select', 'storage_object,status');
    params.set('status', 'in.(uploaded,acked)');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const response = await supabaseRequest(`${getFullSyncChunksTable()}?${params.toString()}`, { method: 'GET' });
    const rows = (await response.json()) as Array<{ storage_object?: string | null }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const objectName = String(row?.storage_object || '').trim();
      if (objectName) protectedObjects.add(objectName);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return protectedObjects;
};

const cleanupOrphanFullSyncStorageObjects = async (): Promise<number> => {
  const protectedObjects = await fetchProtectedFullSyncStorageObjects();
  const cutoffMs = Date.now() - SYNC_ORPHAN_OBJECT_RETENTION_DAYS * DAY_IN_MS;
  const pageSize = 200;
  let offset = 0;
  let deletedCount = 0;

  while (deletedCount < SYNC_ORPHAN_OBJECT_CLEANUP_LIMIT) {
    const rows = await listStorageObjectsPage(offset, pageSize);
    if (!rows.length) break;
    for (const row of rows) {
      if (deletedCount >= SYNC_ORPHAN_OBJECT_CLEANUP_LIMIT) break;
      const objectName = String(row?.name || '').trim();
      if (!objectName || !objectName.startsWith('request_') || protectedObjects.has(objectName)) continue;
      const objectTimeMs = parseTimestamp(row.updated_at || row.created_at || null);
      if (objectTimeMs == null || objectTimeMs >= cutoffMs) continue;
      try {
        await deleteStorageObject(objectName);
        deletedCount += 1;
      } catch {
        // Best-effort cleanup; ignore objects that were already removed.
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return deletedCount;
};

const cleanupQueueRetention = async (actor: SyncActor): Promise<void> => {
  if (!isConfigured()) return;
  const nowMs = Date.now();
  if (nowMs - lastRetentionCleanupAtMs < SYNC_RETENTION_RPC_COOLDOWN_MS) return;
  lastRetentionCleanupAtMs = nowMs;

  try {
    await callRpcMaybe('cleanup_sync_queues');
  } catch {
    // Cleanup RPC might not exist yet in older Supabase schema.
  }

  try {
    await callRpcMaybe('cleanup_full_sync_requests');
  } catch {
    // Cleanup RPC might not exist yet in older Supabase schema.
  }

  if (canAdminSync(actor)) {
    try {
      await cleanupOrphanFullSyncStorageObjects();
    } catch {
      // Storage cleanup is best-effort and should not block sync.
    }
  }
};

const getLocalDbSizeBytes = (db: Database.Database): number => {
  const pageCountRow = db.prepare('PRAGMA page_count').get() as { page_count?: number };
  const pageSizeRow = db.prepare('PRAGMA page_size').get() as { page_size?: number };
  const pageCount = Number(pageCountRow?.page_count || 0);
  const pageSize = Number(pageSizeRow?.page_size || 0);
  return pageCount * pageSize;
};

const getLocalInventoryRecordCount = (db: Database.Database): number => {
  const employees = db
    .prepare('SELECT COUNT(*) AS count FROM employees WHERE deleted_at IS NULL')
    .get() as { count?: number } | undefined;
  const products = db
    .prepare('SELECT COUNT(*) AS count FROM products WHERE deleted_at IS NULL')
    .get() as { count?: number } | undefined;
  const returns = db
    .prepare('SELECT COUNT(*) AS count FROM returns WHERE deleted_at IS NULL')
    .get() as { count?: number } | undefined;
  return Number(employees?.count || 0) + Number(products?.count || 0) + Number(returns?.count || 0);
};

const readInventorySnapshot = (db: Database.Database) => {
  const employees = db
    .prepare('SELECT * FROM employees WHERE deleted_at IS NULL ORDER BY created_at ASC')
    .all()
    .map((row: any) => ({
      ...row,
      password_hash: 'remote_managed',
      password_salt: 'remote_managed',
      pending_password_enc: null,
      hashed_session_token: null,
      supabase_refresh_token_enc: null
    }));
  const products = db.prepare('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY rowid ASC').all();
  const returns = db.prepare('SELECT * FROM returns WHERE deleted_at IS NULL ORDER BY created_at ASC').all();
  const returnReceivers = db
    .prepare(
      'SELECT return_id, employee_id, receiver_name, position, received_date, location FROM return_receivers ORDER BY id ASC'
    )
    .all();

  return {
    exportedAt: nowIso(),
    schemaVersion: 1,
    employees,
    products,
    returns,
    returnReceivers
  };
};

const buildMasterChunkManifest = (db: Database.Database, requestId: string): LocalChunkManifest => {
  const masterDir = getFullSyncMasterDir(requestId);
  ensureDir(masterDir);

  const manifestPath = path.join(masterDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw) as LocalChunkManifest;
  }

  const payload = readInventorySnapshot(db);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));

  const chunks: LocalChunkManifestItem[] = [];
  for (let offset = 0, index = 0; offset < compressed.length; offset += FULL_SYNC_CHUNK_SIZE_BYTES, index += 1) {
    const chunk = compressed.subarray(offset, Math.min(offset + FULL_SYNC_CHUNK_SIZE_BYTES, compressed.length));
    const fileName = `chunk_${String(index).padStart(6, '0')}.bin`;
    fs.writeFileSync(path.join(masterDir, fileName), chunk);
    chunks.push({
      chunkIndex: index,
      fileName,
      chunkSizeBytes: chunk.length,
      checksumSha256: sha256Hex(chunk),
      storageObject: `request_${requestId}_chunk_${String(index).padStart(6, '0')}.bin`
    });
  }

  const manifest: LocalChunkManifest = {
    requestId,
    generatedAt: nowIso(),
    maxChunkBytes: FULL_SYNC_CHUNK_SIZE_BYTES,
    totalChunks: chunks.length,
    totalCompressedBytes: compressed.length,
    manifestChecksum: sha256Hex(compressed),
    chunks
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
};

const readMasterChunkData = (requestId: string, fileName: string): Buffer => {
  const chunkPath = path.join(getFullSyncMasterDir(requestId), fileName);
  if (!fs.existsSync(chunkPath)) {
    throw new Error(`Missing local full-sync chunk file: ${fileName}`);
  }
  return fs.readFileSync(chunkPath);
};

const cleanupMasterChunkCache = (requestId: string): void => {
  const dir = getFullSyncMasterDir(requestId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const parseRows = async <T>(response: Response): Promise<T[]> => {
  const rows = (await response.json()) as T[];
  return Array.isArray(rows) ? rows : [];
};

const fetchFullSyncRequests = async (
  queryBuilder: (params: URLSearchParams) => void
): Promise<FullSyncRequestRow[]> => {
  const params = new URLSearchParams();
  params.set(
    'select',
    'id,requesting_device_id,target_device_id,requested_by,estimated_records,estimated_size_mb,created_at,requester_device_id,requester_user_id,requested_at,status,last_successful_sync_at,estimated_db_size_bytes,approved_at,approved_by_user_id,rejected_at,rejected_by_user_id,rejection_reason,total_chunks,manifest_checksum,started_at,completed_at,completed_by_device_id,updated_at'
  );
  queryBuilder(params);
  const response = await supabaseRequest(`${getFullSyncRequestsTable()}?${params.toString()}`, { method: 'GET' });
  return parseRows<FullSyncRequestRow>(response);
};

const fetchFullSyncRequestById = async (requestId: string): Promise<FullSyncRequestRow | null> => {
  const rows = await fetchFullSyncRequests((params) => {
    params.set('id', `eq.${requestId}`);
    params.set('limit', '1');
  });
  return rows[0] || null;
};

const applyFullSyncDeviceFilter = (params: URLSearchParams, deviceId: string): void => {
  params.set(
    'or',
    `(target_device_id.eq.${deviceId},requesting_device_id.eq.${deviceId},requester_device_id.eq.${deviceId})`
  );
};

const fetchLatestActiveFullSyncRequestForDevice = async (deviceId: string): Promise<FullSyncRequestRow | null> => {
  const rows = await fetchFullSyncRequests((params) => {
    applyFullSyncDeviceFilter(params, deviceId);
    params.set('status', 'in.(pending,approved,transferring)');
    params.set('order', 'requested_at.desc');
    params.set('limit', '1');
  });
  return rows[0] || null;
};

const fetchLatestFullSyncRequestForDevice = async (deviceId: string): Promise<FullSyncRequestRow | null> => {
  const rows = await fetchFullSyncRequests((params) => {
    applyFullSyncDeviceFilter(params, deviceId);
    params.set('order', 'requested_at.desc');
    params.set('limit', '1');
  });
  return rows[0] || null;
};

const fetchPendingFullSyncRequestForTargetDevice = async (deviceId: string): Promise<FullSyncRequestRow | null> => {
  const rows = await fetchFullSyncRequests((params) => {
    applyFullSyncDeviceFilter(params, deviceId);
    params.set('status', 'eq.pending');
    params.set('order', 'requested_at.desc');
    params.set('limit', '1');
  });
  return rows[0] || null;
};

const createFullSyncRequest = async (input: Record<string, unknown>): Promise<FullSyncRequestRow> => {
  const response = await supabaseRequest(`${getFullSyncRequestsTable()}?select=*`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([input])
  });
  const rows = await parseRows<FullSyncRequestRow>(response);
  if (!rows[0]) {
    throw new Error('Failed to create full sync request.');
  }
  return rows[0];
};

const patchFullSyncRequest = async (requestId: string, patch: Record<string, unknown>): Promise<FullSyncRequestRow> => {
  const response = await supabaseRequest(`${getFullSyncRequestsTable()}?id=eq.${requestId}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: nowIso() })
  });
  const rows = await parseRows<FullSyncRequestRow>(response);
  if (!rows[0]) {
    throw new Error('Failed to update full sync request.');
  }
  return rows[0];
};

const fetchFullSyncChunks = async (
  requestId: string,
  whereBuilder?: (params: URLSearchParams) => void
): Promise<FullSyncChunkRow[]> => {
  const params = new URLSearchParams();
  params.set(
    'select',
    'id,request_id,chunk_index,chunk_size_bytes,checksum_sha256,storage_object,status,uploaded_at,acked_at,acked_by_device_id,storage_deleted_at'
  );
  params.set('request_id', `eq.${requestId}`);
  params.set('order', 'chunk_index.asc');
  if (whereBuilder) whereBuilder(params);
  const response = await supabaseRequest(`${getFullSyncChunksTable()}?${params.toString()}`, { method: 'GET' });
  return parseRows<FullSyncChunkRow>(response);
};

const upsertFullSyncChunk = async (row: Record<string, unknown>): Promise<FullSyncChunkRow> => {
  const response = await supabaseRequest(`${getFullSyncChunksTable()}?on_conflict=request_id,chunk_index&select=*`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify([row])
  });
  const rows = await parseRows<FullSyncChunkRow>(response);
  if (!rows[0]) {
    throw new Error('Failed to upsert full sync chunk metadata.');
  }
  return rows[0];
};

const patchFullSyncChunk = async (chunkId: string, patch: Record<string, unknown>): Promise<FullSyncChunkRow> => {
  const response = await supabaseRequest(`${getFullSyncChunksTable()}?id=eq.${chunkId}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  const rows = await parseRows<FullSyncChunkRow>(response);
  if (!rows[0]) {
    throw new Error('Failed to update full sync chunk metadata.');
  }
  return rows[0];
};

const clearRequesterChunkDir = (requestId: string): void => {
  const dir = getFullSyncRequesterDir(requestId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const backupLocalInventorySnapshot = (db: Database.Database): string => {
  const backupRoot = path.join(getFullSyncRootDir(), 'backups');
  ensureDir(backupRoot);
  const stamp = nowIso().replace(/[:.]/gu, '-');
  const backupPath = path.join(backupRoot, `inventory-backup-${stamp}.json.gz`);
  const payload = readInventorySnapshot(db);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  fs.writeFileSync(backupPath, compressed);
  return backupPath;
};

const readRequesterDataset = (requestId: string): any => {
  const dir = getFullSyncRequesterDir(requestId);
  if (!fs.existsSync(dir)) {
    throw new Error('No downloaded full-sync chunks were found.');
  }

  const partFiles = fs
    .readdirSync(dir)
    .filter((name) => /^chunk_\d+\.bin$/u.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (!partFiles.length) {
    throw new Error('No downloaded full-sync chunks were found.');
  }

  const buffers = partFiles.map((name) => fs.readFileSync(path.join(dir, name)));
  const compressed = Buffer.concat(buffers);
  const payload = zlib.gunzipSync(compressed).toString('utf8');
  return JSON.parse(payload);
};

const toNumberSafe = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rebuildLocalInventoryFromDataset = (db: Database.Database, dataset: any): void => {
  const employees = Array.isArray(dataset?.employees) ? dataset.employees : [];
  const products = Array.isArray(dataset?.products) ? dataset.products : [];
  const returns = Array.isArray(dataset?.returns) ? dataset.returns : [];
  const returnReceivers = Array.isArray(dataset?.returnReceivers) ? dataset.returnReceivers : [];

  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM return_receivers').run();
    db.prepare('DELETE FROM returns').run();
    db.prepare('DELETE FROM products').run();
    db.prepare('DELETE FROM employees').run();

    const insertEmployee = db.prepare(
      `
        INSERT INTO employees (
          id, first_name, last_name, full_name, email, phone, position, department, address, role, status, password_hash, password_salt,
          supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
          last_verified_at, verification_expires_at, hashed_session_token,
          created_at, location, profile_image_data, profile_image_format, profile_image_updated_at,
          two_factor_enabled, email_notifications, low_stock_alerts, language,
          sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
        ) VALUES (
          @id, @first_name, @last_name, @full_name, @email, @phone, @position, @department, @address, @role, @status, @password_hash, @password_salt,
          @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
          @last_verified_at, @verification_expires_at, @hashed_session_token,
          @created_at, @location, @profile_image_data, @profile_image_format, @profile_image_updated_at,
          @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
          'synced', 0, @last_modified, @last_synced_at, NULL, @version
        )
      `
    );

    for (const row of employees) {
      const fallbackSplit = splitFullName(row.full_name ?? row.fullName ?? '');
      insertEmployee.run({
        id: row.id,
        first_name: row.first_name ?? row.firstName ?? fallbackSplit.firstName,
        last_name: row.last_name ?? row.lastName ?? fallbackSplit.lastName,
        full_name: row.full_name ?? row.fullName ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        position: row.position ?? '',
        department: row.department ?? '',
        address: row.address ?? row.location ?? '',
        role: row.role ?? 'employee',
        status: row.status ?? 'active',
        password_hash: row.password_hash ?? row.passwordHash ?? '',
        password_salt: row.password_salt ?? row.passwordSalt ?? '',
        supabase_user_id: row.supabase_user_id ?? row.supabaseUserId ?? null,
        auth_sync_status: row.auth_sync_status ?? row.authSyncStatus ?? 'pending_upload',
        auth_last_error: row.auth_last_error ?? row.authLastError ?? null,
        pending_password_enc: row.pending_password_enc ?? row.pendingPasswordEncrypted ?? null,
        provisioned_at: row.provisioned_at ?? row.provisionedAt ?? null,
        last_verified_at: row.last_verified_at ?? row.lastVerifiedAt ?? null,
        verification_expires_at: row.verification_expires_at ?? row.verificationExpiresAt ?? null,
        hashed_session_token: row.hashed_session_token ?? row.hashedSessionToken ?? null,
        created_at: row.created_at ?? row.createdAt ?? now,
        location: row.location ?? '',
        profile_image_data: row.profile_image_data ?? row.profileImageDataUrl ?? null,
        profile_image_format: row.profile_image_format ?? row.profileImageFormat ?? null,
        profile_image_updated_at: row.profile_image_updated_at ?? row.profileImageUpdatedAt ?? null,
        two_factor_enabled: toBoolInt(row.two_factor_enabled ?? row.twoFactorEnabled),
        email_notifications: toBoolInt(row.email_notifications ?? row.emailNotifications),
        low_stock_alerts: toBoolInt(row.low_stock_alerts ?? row.lowStockAlerts),
        language: row.language ?? 'English',
        last_modified: row.last_modified ?? row.lastModified ?? now,
        last_synced_at: now,
        version: readVersion(row.version, 1)
      });
    }

    const insertProduct = db.prepare(
      `
        INSERT INTO products (
          id, value_category, article, date, description, par_control_number, property_number,
          unit, unit_value, balance_per_card, on_hand_per_count, total, remarks, location,
          assigned_to_employee_id, assigned_at, assignment_status, status,
          sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
        ) VALUES (
          @id, @value_category, @article, @date, @description, @par_control_number, @property_number,
          @unit, @unit_value, @balance_per_card, @on_hand_per_count, @total, @remarks, @location,
          @assigned_to_employee_id, @assigned_at, @assignment_status, @status,
          'synced', 0, @last_modified, @last_synced_at, NULL, @version
        )
      `
    );

    for (const row of products) {
      insertProduct.run({
        id: row.id,
        value_category: row.value_category ?? row.valueCategory ?? 'LV',
        article: row.article ?? '',
        date: row.date ?? '',
        description: row.description ?? '',
        par_control_number: row.par_control_number ?? row.parControlNumber ?? '',
        property_number: row.property_number ?? row.propertyNumber ?? '',
        unit: row.unit ?? '',
        unit_value: toNumberSafe(row.unit_value ?? row.unitValue, 0),
        balance_per_card: toNumberSafe(row.balance_per_card ?? row.balancePerCard, 0),
        on_hand_per_count: toNumberSafe(row.on_hand_per_count ?? row.onHandPerCount, 0),
        total: toNumberSafe(row.total, 0),
        remarks: row.remarks ?? '',
        location: row.location ?? '',
        assigned_to_employee_id: row.assigned_to_employee_id ?? row.assignedToEmployeeId ?? null,
        assigned_at: row.assigned_at ?? row.assignedAt ?? null,
        assignment_status: row.assignment_status ?? row.assignmentStatus ?? 'returned',
        status: row.status ?? 'available',
        last_modified: row.last_modified ?? row.lastModified ?? now,
        last_synced_at: now,
        version: readVersion(row.version, 1)
      });
    }

    const insertReturn = db.prepare(
      `
        INSERT INTO returns (
          id, rrsp_number, product_id, return_date, quantity, condition, remarks,
          returned_by_employee_id, returned_by_position, received_date, location,
          created_at, status, processed_by_employee_id, processed_date, processing_notes,
          sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
        ) VALUES (
          @id, @rrsp_number, @product_id, @return_date, @quantity, @condition, @remarks,
          @returned_by_employee_id, @returned_by_position, @received_date, @location,
          @created_at, @status, @processed_by_employee_id, @processed_date, @processing_notes,
          'synced', 0, @last_modified, @last_synced_at, NULL, @version
        )
      `
    );

    for (const row of returns) {
      insertReturn.run({
        id: row.id,
        rrsp_number: row.rrsp_number ?? row.rrspNumber ?? '',
        product_id: row.product_id ?? row.productId ?? '',
        return_date: row.return_date ?? row.returnDate ?? '',
        quantity: toNumberSafe(row.quantity, 1),
        condition: row.condition ?? 'functional',
        remarks: row.remarks ?? '',
        returned_by_employee_id: row.returned_by_employee_id ?? row.returnedByEmployeeId ?? '',
        returned_by_position: row.returned_by_position ?? row.returnedByPosition ?? 'employee',
        received_date: row.received_date ?? row.receivedDate ?? '',
        location: row.location ?? '',
        created_at: row.created_at ?? row.createdAt ?? now,
        status: row.status ?? 'pending',
        processed_by_employee_id: row.processed_by_employee_id ?? row.processedByEmployeeId ?? null,
        processed_date: row.processed_date ?? row.processedDate ?? null,
        processing_notes: row.processing_notes ?? row.processingNotes ?? null,
        last_modified: row.last_modified ?? row.lastModified ?? now,
        last_synced_at: now,
        version: readVersion(row.version, 1)
      });
    }

    const insertReceiver = db.prepare(
      `
        INSERT INTO return_receivers (return_id, employee_id, receiver_name, position, received_date, location)
        VALUES (@return_id, @employee_id, @receiver_name, @position, @received_date, @location)
      `
    );

    for (const row of returnReceivers) {
      insertReceiver.run({
        return_id: row.return_id ?? row.returnId ?? '',
        employee_id: row.employee_id ?? row.employeeId ?? '',
        receiver_name: row.receiver_name ?? row.receiverName ?? '',
        position: row.position ?? 'employee',
        received_date: row.received_date ?? row.receivedDate ?? '',
        location: row.location ?? ''
      });
    }

    db.prepare("DELETE FROM sync_outbox WHERE entity_type IN ('employees', 'products', 'returns', 'activity_logs')").run();
  });

  tx();
};

const summarizeFullSyncRequest = (request: FullSyncRequestRow, chunks: FullSyncChunkRow[] = []) => {
  const uploadedChunks = chunks.filter((chunk) => chunk.status === 'uploaded').length;
  const ackedChunks = chunks.filter((chunk) => chunk.status === 'acked' || chunk.status === 'deleted').length;
  const nextUploaded = chunks.find((chunk) => chunk.status === 'uploaded');
  const estimatedDbSizeBytes =
    request.estimated_db_size_bytes != null
      ? request.estimated_db_size_bytes
      : request.estimated_size_mb != null
        ? Math.round(Number(request.estimated_size_mb) * 1024 * 1024)
        : null;
  return {
    requestId: request.id,
    requestingDeviceId: request.requesting_device_id || request.requester_device_id,
    targetDeviceId: request.target_device_id || request.requester_device_id,
    requestedBy: request.requested_by || request.requester_user_id,
    requesterDeviceId: request.requester_device_id || request.requesting_device_id || request.target_device_id,
    requesterUserId: request.requested_by || request.requester_user_id,
    requestedAt: request.created_at || request.requested_at,
    status: request.status,
    lastSuccessfulSyncAt: request.last_successful_sync_at,
    estimatedRecords: request.estimated_records,
    estimatedSizeMb:
      request.estimated_size_mb != null
        ? Number(request.estimated_size_mb)
        : estimatedDbSizeBytes != null
          ? Number((estimatedDbSizeBytes / 1024 / 1024).toFixed(3))
          : null,
    estimatedDbSizeBytes,
    approvedAt: request.approved_at,
    approvedByUserId: request.approved_by_user_id,
    rejectedAt: request.rejected_at,
    rejectedByUserId: request.rejected_by_user_id,
    rejectionReason: request.rejection_reason,
    totalChunks: request.total_chunks,
    manifestChecksum: request.manifest_checksum,
    startedAt: request.started_at,
    completedAt: request.completed_at,
    completedByDeviceId: request.completed_by_device_id,
    uploadedChunks,
    ackedChunks,
    nextUploadedChunkIndex: nextUploaded ? nextUploaded.chunk_index : null,
    updatedAt: request.updated_at
  };
};

const toBoolInt = (value: unknown): number => (value ? 1 : 0);

const applyRemoteEmployee = (db: Database.Database, payload: any, version: number): void => {
  const incomingEmployeeId = String(payload?.id ?? '').trim();
  if (!incomingEmployeeId) return;
  const incomingSupabaseUserId = String(payload?.supabaseUserId ?? payload?.supabase_user_id ?? '').trim();
  const incomingEmail = String(payload?.email ?? '').trim().toLowerCase();
  const now = nowIso();

  const selectEmployeeById = db.prepare(
    `SELECT
        id, first_name, last_name, email, phone, department, position, role, status, address, location, password_hash, password_salt,
        supabase_user_id, auth_sync_status, provisioned_at, created_at, two_factor_enabled, email_notifications, low_stock_alerts, language,
        profile_image_data, profile_image_format, profile_image_updated_at, deleted_at
       FROM employees
       WHERE id = ?
       LIMIT 1`
  );
  const selectEmployeeBySupabase = db.prepare(
    `SELECT
        id, first_name, last_name, email, phone, department, position, role, status, address, location, password_hash, password_salt,
        supabase_user_id, auth_sync_status, provisioned_at, created_at, two_factor_enabled, email_notifications, low_stock_alerts, language,
        profile_image_data, profile_image_format, profile_image_updated_at, deleted_at
       FROM employees
       WHERE supabase_user_id = ?
       LIMIT 1`
  );
  const selectEmployeeByEmail = db.prepare(
    `SELECT
        id, first_name, last_name, email, phone, department, position, role, status, address, location, password_hash, password_salt,
        supabase_user_id, auth_sync_status, provisioned_at, created_at, two_factor_enabled, email_notifications, low_stock_alerts, language,
        profile_image_data, profile_image_format, profile_image_updated_at, deleted_at
       FROM employees
       WHERE lower(email) = ?
       LIMIT 1`
  );

  let existing = selectEmployeeById.get(incomingEmployeeId) as
    | {
        id?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
        department?: string | null;
        position?: string | null;
        role?: string | null;
        status?: string | null;
        address?: string | null;
        location?: string | null;
        password_hash?: string | null;
        password_salt?: string | null;
        supabase_user_id?: string | null;
        auth_sync_status?: string | null;
        provisioned_at?: string | null;
        created_at?: string | null;
        two_factor_enabled?: number | null;
        email_notifications?: number | null;
        low_stock_alerts?: number | null;
        language?: string | null;
        profile_image_data?: string | null;
        profile_image_format?: string | null;
        profile_image_updated_at?: string | null;
        deleted_at?: string | null;
      }
    | undefined;

  if (!existing && incomingSupabaseUserId) {
    existing = selectEmployeeBySupabase.get(incomingSupabaseUserId) as typeof existing;
  }
  if (!existing && incomingEmail) {
    existing = selectEmployeeByEmail.get(incomingEmail) as typeof existing;
  }

  const employeeId = String(existing?.id || incomingEmployeeId).trim() || incomingEmployeeId;

  const existingById = db
    .prepare(
      `SELECT
        first_name, last_name, email, phone, department, position, role, status, address, location, password_hash, password_salt,
        supabase_user_id, auth_sync_status, provisioned_at, created_at, two_factor_enabled, email_notifications, low_stock_alerts, language,
        profile_image_data, profile_image_format, profile_image_updated_at
       FROM employees
       WHERE id = ?
       LIMIT 1`
    )
    .get(employeeId) as
    | {
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
        department?: string | null;
        position?: string | null;
        role?: string | null;
        status?: string | null;
        address?: string | null;
        location?: string | null;
        password_hash?: string | null;
        password_salt?: string | null;
        supabase_user_id?: string | null;
        auth_sync_status?: string | null;
        provisioned_at?: string | null;
        created_at?: string | null;
        two_factor_enabled?: number | null;
        email_notifications?: number | null;
        low_stock_alerts?: number | null;
        language?: string | null;
        profile_image_data?: string | null;
        profile_image_format?: string | null;
        profile_image_updated_at?: string | null;
      }
    | undefined;
  existing = (existingById || existing) as typeof existing;
  const fullName = String(payload.fullName ?? payload.full_name ?? '').trim();
  const splitName = splitFullName(fullName);
  const firstName = String(payload.firstName ?? payload.first_name ?? '').trim() || splitName.firstName || existing?.first_name || '';
  const lastName = String(payload.lastName ?? payload.last_name ?? '').trim() || splitName.lastName || existing?.last_name || '';
  const resolvedFullName = fullName || [firstName, lastName].filter(Boolean).join(' ') || employeeId;
  const passwordHash =
    String(payload.passwordHash ?? payload.password_hash ?? '').trim() || String(existing?.password_hash ?? '').trim() || 'remote_managed';
  const passwordSalt =
    String(payload.passwordSalt ?? payload.password_salt ?? '').trim() || String(existing?.password_salt ?? '').trim() || 'remote_managed';
  const profileImageDataUrl =
    Object.prototype.hasOwnProperty.call(payload, 'profileImageDataUrl') ||
    Object.prototype.hasOwnProperty.call(payload, 'profile_image_data')
      ? payload.profileImageDataUrl ?? payload.profile_image_data ?? null
      : existing?.profile_image_data ?? null;
  const profileImageFormat =
    Object.prototype.hasOwnProperty.call(payload, 'profileImageFormat') ||
    Object.prototype.hasOwnProperty.call(payload, 'profile_image_format')
      ? payload.profileImageFormat ?? payload.profile_image_format ?? null
      : existing?.profile_image_format ?? null;
  const profileImageUpdatedAt =
    Object.prototype.hasOwnProperty.call(payload, 'profileImageUpdatedAt') ||
    Object.prototype.hasOwnProperty.call(payload, 'profile_image_updated_at')
      ? payload.profileImageUpdatedAt ?? payload.profile_image_updated_at ?? null
      : existing?.profile_image_updated_at ?? null;
  let resolvedEmail = incomingEmail || String(existing?.email ?? '').trim().toLowerCase();
  if (resolvedEmail) {
    const duplicateEmailOwner = db
      .prepare('SELECT id FROM employees WHERE lower(email) = ? AND id <> ? LIMIT 1')
      .get(resolvedEmail, employeeId) as { id?: string | null } | undefined;
    if (duplicateEmailOwner?.id) {
      resolvedEmail = String(existing?.email ?? '').trim().toLowerCase();
    }
  }

  db.prepare(
    `
      INSERT INTO employees (
        id, first_name, last_name, full_name, email, phone, position, department, address, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token,
        created_at, location, profile_image_data, profile_image_format, profile_image_updated_at,
        two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @first_name, @last_name, @full_name, @email, @phone, @position, @department, @address, @role, @status, COALESCE(@password_hash, 'remote_managed'), COALESCE(@password_salt, 'remote_managed'),
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token,
        @created_at, @location, @profile_image_data, @profile_image_format, @profile_image_updated_at,
        @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
      ON CONFLICT(id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        position = excluded.position,
        department = excluded.department,
        address = excluded.address,
        role = excluded.role,
        status = excluded.status,
        password_hash = COALESCE(excluded.password_hash, employees.password_hash, 'remote_managed'),
        password_salt = COALESCE(excluded.password_salt, employees.password_salt, 'remote_managed'),
        supabase_user_id = excluded.supabase_user_id,
        auth_sync_status = excluded.auth_sync_status,
        auth_last_error = excluded.auth_last_error,
        pending_password_enc = excluded.pending_password_enc,
        provisioned_at = excluded.provisioned_at,
        last_verified_at = excluded.last_verified_at,
        verification_expires_at = excluded.verification_expires_at,
        hashed_session_token = excluded.hashed_session_token,
        created_at = excluded.created_at,
        location = excluded.location,
        profile_image_data = excluded.profile_image_data,
        profile_image_format = excluded.profile_image_format,
        profile_image_updated_at = excluded.profile_image_updated_at,
        two_factor_enabled = excluded.two_factor_enabled,
        email_notifications = excluded.email_notifications,
        low_stock_alerts = excluded.low_stock_alerts,
        language = excluded.language,
        sync_status = excluded.sync_status,
        is_dirty = excluded.is_dirty,
        last_modified = excluded.last_modified,
        last_synced_at = excluded.last_synced_at,
        deleted_at = excluded.deleted_at,
        version = excluded.version
    `
  ).run({
    id: employeeId,
    first_name: firstName,
    last_name: lastName,
    full_name: resolvedFullName,
    email: resolvedEmail,
    phone: payload.phone ?? existing?.phone ?? '',
    position: payload.position ?? existing?.position ?? '',
    department: payload.department ?? existing?.department ?? '',
    address: payload.address ?? existing?.address ?? payload.location ?? existing?.location ?? '',
    role: payload.role ?? existing?.role ?? 'employee',
    status: payload.status ?? existing?.status ?? 'active',
    password_hash: passwordHash,
    password_salt: passwordSalt,
    supabase_user_id: payload.supabaseUserId ?? existing?.supabase_user_id ?? null,
    auth_sync_status: payload.authSyncStatus ?? existing?.auth_sync_status ?? null,
    auth_last_error: null,
    pending_password_enc: null,
    provisioned_at: payload.provisionedAt ?? existing?.provisioned_at ?? null,
    last_verified_at: null,
    verification_expires_at: null,
    hashed_session_token: null,
    created_at: payload.createdAt ?? existing?.created_at ?? now,
    location: payload.location ?? existing?.location ?? '',
    profile_image_data: profileImageDataUrl,
    profile_image_format: profileImageFormat,
    profile_image_updated_at: profileImageUpdatedAt,
    two_factor_enabled: toBoolInt(payload.twoFactorEnabled ?? payload.two_factor_enabled ?? existing?.two_factor_enabled),
    email_notifications: toBoolInt(payload.emailNotifications ?? payload.email_notifications ?? existing?.email_notifications),
    low_stock_alerts: toBoolInt(payload.lowStockAlerts ?? payload.low_stock_alerts ?? existing?.low_stock_alerts),
    language: payload.language ?? existing?.language ?? 'English',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: payload.lastModified ?? now,
    last_synced_at: now,
    deleted_at: payload.deletedAt ?? existing?.deleted_at ?? null,
    version
  });
};

const applyRemoteProduct = (db: Database.Database, payload: any, version: number): void => {
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO products (
        id, value_category, article, date, description, par_control_number, property_number,
        unit, unit_value, balance_per_card, on_hand_per_count, total, remarks, location,
        assigned_to_employee_id, assigned_at, assignment_status, status,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @value_category, @article, @date, @description, @par_control_number, @property_number,
        @unit, @unit_value, @balance_per_card, @on_hand_per_count, @total, @remarks, @location,
        @assigned_to_employee_id, @assigned_at, @assignment_status, @status,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
      ON CONFLICT(id) DO UPDATE SET
        value_category = excluded.value_category,
        article = excluded.article,
        date = excluded.date,
        description = excluded.description,
        par_control_number = excluded.par_control_number,
        property_number = excluded.property_number,
        unit = excluded.unit,
        unit_value = excluded.unit_value,
        balance_per_card = excluded.balance_per_card,
        on_hand_per_count = excluded.on_hand_per_count,
        total = excluded.total,
        remarks = excluded.remarks,
        location = excluded.location,
        assigned_to_employee_id = excluded.assigned_to_employee_id,
        assigned_at = excluded.assigned_at,
        assignment_status = excluded.assignment_status,
        status = excluded.status,
        sync_status = excluded.sync_status,
        is_dirty = excluded.is_dirty,
        last_modified = excluded.last_modified,
        last_synced_at = excluded.last_synced_at,
        deleted_at = excluded.deleted_at,
        version = excluded.version
    `
  ).run({
    id: payload.id,
    value_category: payload.valueCategory,
    article: payload.article,
    date: payload.date,
    description: payload.description,
    par_control_number: payload.parControlNumber,
    property_number: payload.propertyNumber,
    unit: payload.unit,
    unit_value: payload.unitValue,
    balance_per_card: payload.balancePerCard,
    on_hand_per_count: payload.onHandPerCount,
    total: payload.total,
    remarks: payload.remarks,
    location: payload.location ?? '',
    assigned_to_employee_id: payload.assignedToEmployeeId ?? null,
    assigned_at: payload.assignedToEmployeeId ? payload.assignedAt ?? payload.lastModified ?? now : null,
    assignment_status: payload.assignmentStatus ?? (payload.assignedToEmployeeId ? 'active' : 'returned'),
    status: payload.status,
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: payload.lastModified ?? now,
    last_synced_at: now,
    deleted_at: payload.deletedAt ?? null,
    version
  });
};

const applyRemoteReturn = (db: Database.Database, payload: any, version: number): void => {
  const now = nowIso();
  const sanitizeEmployeeId = (value: unknown): string | null => {
    const id = String(value ?? '').trim();
    if (!id) return null;
    return localEmployeeExists(db, id) ? id : null;
  };

  const returnedByEmployeeId =
    sanitizeEmployeeId(payload.returnedByEmployeeId ?? payload.returned_by_employee_id ?? null) ??
    sanitizeEmployeeId(
      (db.prepare('SELECT returned_by_employee_id FROM returns WHERE id = ? LIMIT 1').get(payload.id) as
        | { returned_by_employee_id?: string | null }
        | undefined)?.returned_by_employee_id
    );

  const returnedByCandidate = String(payload.returnedByEmployeeId ?? payload.returned_by_employee_id ?? '').trim();
  const returnedByPosition = String(payload.returnedByPosition ?? payload.returned_by_position ?? '').trim().toLowerCase();
  const shadowReturnedByEmployeeId =
    !returnedByEmployeeId && returnedByCandidate
      ? ensureShadowEmployeeReference(db, returnedByCandidate, returnedByPosition === 'system_admin' ? 'system_admin' : 'employee')
      : null;
  const resolvedReturnedByEmployeeId = returnedByEmployeeId ?? shadowReturnedByEmployeeId;

  if (!resolvedReturnedByEmployeeId) {
    throw new Error(`FOREIGN KEY constraint failed: missing returning employee for return ${String(payload.id || '')}`);
  }

  const processedByEmployeeId = sanitizeEmployeeId(payload.processedByEmployeeId ?? payload.processed_by_employee_id ?? null);

  db.prepare(
    `
      INSERT INTO returns (
        id, rrsp_number, product_id, return_date, quantity, condition, remarks,
        returned_by_employee_id, returned_by_position, received_date, location,
        created_at, status, processed_by_employee_id, processed_date, processing_notes,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @rrsp_number, @product_id, @return_date, @quantity, @condition, @remarks,
        @returned_by_employee_id, @returned_by_position, @received_date, @location,
        @created_at, @status, @processed_by_employee_id, @processed_date, @processing_notes,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
      ON CONFLICT(id) DO UPDATE SET
        rrsp_number = excluded.rrsp_number,
        product_id = excluded.product_id,
        return_date = excluded.return_date,
        quantity = excluded.quantity,
        condition = excluded.condition,
        remarks = excluded.remarks,
        returned_by_employee_id = excluded.returned_by_employee_id,
        returned_by_position = excluded.returned_by_position,
        received_date = excluded.received_date,
        location = excluded.location,
        created_at = excluded.created_at,
        status = excluded.status,
        processed_by_employee_id = excluded.processed_by_employee_id,
        processed_date = excluded.processed_date,
        processing_notes = excluded.processing_notes,
        sync_status = excluded.sync_status,
        is_dirty = excluded.is_dirty,
        last_modified = excluded.last_modified,
        last_synced_at = excluded.last_synced_at,
        deleted_at = excluded.deleted_at,
        version = excluded.version
    `
  ).run({
    id: payload.id,
    rrsp_number: payload.rrspNumber ?? payload.rrsp_number,
    product_id: payload.productId ?? payload.product_id,
    return_date: payload.returnDate ?? payload.return_date,
    quantity: payload.quantity,
    condition: payload.condition,
    remarks: payload.remarks,
    returned_by_employee_id: resolvedReturnedByEmployeeId,
    returned_by_position: payload.returnedByPosition ?? payload.returned_by_position,
    received_date: payload.receivedDate ?? payload.received_date,
    location: payload.location,
    created_at: payload.createdAt ?? payload.created_at ?? now,
    status: payload.status,
    processed_by_employee_id: processedByEmployeeId,
    processed_date: payload.processedDate ?? payload.processed_date ?? null,
    processing_notes: payload.processingNotes ?? payload.processing_notes ?? null,
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: payload.lastModified ?? payload.last_modified ?? now,
    last_synced_at: now,
    deleted_at: payload.deletedAt ?? payload.deleted_at ?? null,
    version
  });

  if (Array.isArray(payload.receivedByEntries)) {
    db.prepare('DELETE FROM return_receivers WHERE return_id = ?').run(payload.id);

    const insertReceiver = db.prepare(
      `
        INSERT INTO return_receivers (return_id, employee_id, receiver_name, position, received_date, location)
        VALUES (@return_id, @employee_id, @receiver_name, @position, @received_date, @location)
      `
    );

    const tx = db.transaction((entries: any[]) => {
      for (const entry of entries) {
        const receiverEmployeeId = sanitizeEmployeeId(entry.employeeId ?? entry.employee_id ?? resolvedReturnedByEmployeeId);
        insertReceiver.run({
          return_id: payload.id,
          employee_id: receiverEmployeeId,
          receiver_name: entry.receiverName || entry.receiver_name || '',
          position: entry.position,
          received_date: entry.receivedDate || entry.received_date,
          location: entry.location
        });
      }
    });

    tx(payload.receivedByEntries);
  }
};

const applyRemoteActivity = (db: Database.Database, payload: any, version: number): void => {
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO activity_logs (
        id, action, entity_type, entity_id, performed_by_employee_id, timestamp,
        details, status, ip_address, sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @action, @entity_type, @entity_id, @performed_by_employee_id, @timestamp,
        @details, @status, @ip_address, @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
      ON CONFLICT(id) DO UPDATE SET
        action = excluded.action,
        entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        performed_by_employee_id = excluded.performed_by_employee_id,
        timestamp = excluded.timestamp,
        details = excluded.details,
        status = excluded.status,
        ip_address = excluded.ip_address,
        sync_status = excluded.sync_status,
        is_dirty = excluded.is_dirty,
        last_modified = excluded.last_modified,
        last_synced_at = excluded.last_synced_at,
        deleted_at = excluded.deleted_at,
        version = excluded.version
    `
  ).run({
    id: payload.id,
    action: payload.action,
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    performed_by_employee_id: payload.performedByEmployeeId,
    timestamp: payload.timestamp,
    details: payload.details,
    status: payload.status,
    ip_address: payload.ipAddress ?? 'offline',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: payload.lastModified ?? now,
    last_synced_at: now,
    deleted_at: payload.deletedAt ?? null,
    version
  });
};

const applyRemoteDelete = (
  db: Database.Database,
  entityType: string,
  recordId: string,
  deletedAt: string,
  version: number
): void => {
  const table = entityToTable[entityType];
  if (!table) return;

  const now = nowIso();
  db.prepare(
    `
      UPDATE ${table}
      SET
        deleted_at = @deleted_at,
        sync_status = 'synced',
        is_dirty = 0,
        last_modified = @last_modified,
        last_synced_at = @last_synced_at,
        version = CASE WHEN version < @version THEN @version ELSE version END
      WHERE id = @id
    `
  ).run({
    id: recordId,
    deleted_at: deletedAt,
    last_modified: deletedAt || now,
    last_synced_at: now,
    version
  });
};

const localRowExistsById = (db: Database.Database, tableName: string, id: string | null | undefined): boolean => {
  const value = String(id || '').trim();
  if (!value) return false;
  const row = db.prepare(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`).get(value) as { id?: string } | undefined;
  return Boolean(row?.id);
};

const localEmployeeExists = (db: Database.Database, employeeId: string | null | undefined): boolean =>
  localRowExistsById(db, 'employees', employeeId);

const ensureShadowEmployeeReference = (
  db: Database.Database,
  employeeId: string | null | undefined,
  roleHint: SyncRole = 'employee'
): string | null => {
  const id = String(employeeId || '').trim();
  if (!id) return null;
  if (localEmployeeExists(db, id)) return id;

  const now = nowIso();
  const role: SyncRole = roleHint === 'system_admin' ? 'system_admin' : 'employee';
  const safeLocalPart = id.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 40) || 'unknown';
  const shadowEmail = `sync-shadow-${safeLocalPart}@local.invalid`;

  db.prepare(
    `
      INSERT OR IGNORE INTO employees (
        id, full_name, email, phone, department, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token, supabase_refresh_token_enc,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @full_name, @email, @phone, @department, @role, @status, @password_hash, @password_salt,
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token, @supabase_refresh_token_enc,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
    `
  ).run({
    id,
    full_name: `Remote Sync Reference (${id.slice(0, 8)})`,
    email: shadowEmail,
    phone: '',
    department: 'Sync',
    role,
    status: 'inactive',
    password_hash: 'sync_shadow',
    password_salt: 'sync_shadow',
    supabase_user_id: null,
    auth_sync_status: 'not_required',
    auth_last_error: null,
    pending_password_enc: null,
    provisioned_at: now,
    last_verified_at: null,
    verification_expires_at: null,
    hashed_session_token: null,
    supabase_refresh_token_enc: null,
    created_at: now,
    location: '',
    two_factor_enabled: 0,
    email_notifications: 0,
    low_stock_alerts: 0,
    language: 'English',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: now,
    last_synced_at: now,
    deleted_at: now,
    version: 1
  });

  return localEmployeeExists(db, id) ? id : null;
};

const normalizeEmployeeSubmissionPayloadForAdmin = (
  db: Database.Database,
  row: RemoteQueueRow,
  entityType: string,
  payload: any
): any => {
  const normalized = { ...(payload || {}) };
  const rowEmployeeId = String(row.employee_id || '').trim();

  if (entityType === 'products') {
    const assignedCandidate = normalized.assignedToEmployeeId ?? normalized.assigned_to_employee_id ?? null;
    const assignedEmployeeId = assignedCandidate ? String(assignedCandidate).trim() : '';
    if (assignedEmployeeId && !localEmployeeExists(db, assignedEmployeeId)) {
      const fallbackEmployeeId = rowEmployeeId && localEmployeeExists(db, rowEmployeeId) ? rowEmployeeId : '';
      normalized.assignedToEmployeeId = fallbackEmployeeId || null;
      if (!fallbackEmployeeId) {
        normalized.assignmentStatus = 'returned';
        normalized.assignedAt = null;
      }
    } else {
      normalized.assignedToEmployeeId = assignedEmployeeId || null;
    }
    return normalized;
  }

  if (entityType === 'returns') {
    const productCandidate = normalized.productId ?? normalized.product_id ?? null;
    normalized.productId = productCandidate ? String(productCandidate).trim() : null;

    const returnedByCandidate = normalized.returnedByEmployeeId ?? normalized.returned_by_employee_id ?? null;
    let returnedByEmployeeId = returnedByCandidate ? String(returnedByCandidate).trim() : '';
    if (!returnedByEmployeeId && rowEmployeeId) {
      returnedByEmployeeId = rowEmployeeId;
    }
    if (returnedByEmployeeId && !localEmployeeExists(db, returnedByEmployeeId) && rowEmployeeId && localEmployeeExists(db, rowEmployeeId)) {
      returnedByEmployeeId = rowEmployeeId;
    }
    normalized.returnedByEmployeeId = returnedByEmployeeId;
    return normalized;
  }

  return normalized;
};

const normalizeAdminQueuePayloadForEmployee = (
  db: Database.Database,
  row: RemoteQueueRow,
  entityType: string,
  payload: any,
  actorUserId: string
): any => {
  const normalized = { ...(payload || {}) };
  const rowEmployeeId = String(row.employee_id || '').trim();
  const actorEmployeeId = String(actorUserId || '').trim();

  if (entityType === 'products') {
    const assignedCandidate = normalized.assignedToEmployeeId ?? normalized.assigned_to_employee_id ?? null;
    normalized.assignedToEmployeeId = assignedCandidate ? String(assignedCandidate).trim() : null;
    return normalized;
  }

  if (entityType === 'returns') {
    const productCandidate = normalized.productId ?? normalized.product_id ?? null;
    normalized.productId = productCandidate ? String(productCandidate).trim() : null;

    const returnedCandidates = [
      normalized.returnedByEmployeeId ?? normalized.returned_by_employee_id ?? null,
      rowEmployeeId || null,
      actorEmployeeId || null
    ];

    let returnedByEmployeeId = '';
    for (const candidate of returnedCandidates) {
      const value = candidate ? String(candidate).trim() : '';
      if (value && localEmployeeExists(db, value)) {
        returnedByEmployeeId = value;
        break;
      }
    }
    normalized.returnedByEmployeeId = returnedByEmployeeId;

    const processedCandidate = normalized.processedByEmployeeId ?? normalized.processed_by_employee_id ?? null;
    const processedByEmployeeId = processedCandidate ? String(processedCandidate).trim() : '';
    normalized.processedByEmployeeId =
      processedByEmployeeId && localEmployeeExists(db, processedByEmployeeId) ? processedByEmployeeId : null;

    if (Array.isArray(normalized.receivedByEntries)) {
      normalized.receivedByEntries = normalized.receivedByEntries.map((entry: any) => {
        const employeeCandidate = entry?.employeeId ?? entry?.employee_id ?? null;
        const employeeId = employeeCandidate ? String(employeeCandidate).trim() : '';
        return {
          ...entry,
          employeeId: employeeId && localEmployeeExists(db, employeeId) ? employeeId : null
        };
      });
    }

    return normalized;
  }

  return normalized;
};

const applyRemoteUpsert = (db: Database.Database, entityType: string, payload: any, version: number): void => {
  switch (entityType) {
    case 'employees':
      applyRemoteEmployee(db, payload, version);
      break;
    case 'products':
      applyRemoteProduct(db, payload, version);
      break;
    case 'returns':
      applyRemoteReturn(db, payload, version);
      break;
    case 'activity_logs':
      applyRemoteActivity(db, payload, version);
      break;
    default:
      break;
  }
};

const createConflictRecord = (
  row: RemoteQueueRow,
  entityType: string,
  localVersion: number,
  remoteVersion: number
): ConflictRecord => ({
  queueId: row.id,
  tableName: entityType,
  recordId: readRemoteRecordId(row),
  localVersion,
  remoteVersion
});

const readLocalEmployeeForSync = (db: Database.Database, employeeId: string): Record<string, unknown> | null => {
  const row = db
    .prepare(
      `SELECT
        id, first_name, last_name, full_name, email, phone, position, department, address, role, status,
        password_hash, password_salt, supabase_user_id, auth_sync_status, provisioned_at,
        created_at, location, profile_image_data, profile_image_format, profile_image_updated_at,
        two_factor_enabled, email_notifications, low_stock_alerts, language, last_modified, deleted_at, version
       FROM employees
       WHERE id = ?
       LIMIT 1`
    )
    .get(employeeId) as
    | {
        id: string;
        first_name?: string | null;
        last_name?: string | null;
        full_name?: string | null;
        email?: string | null;
        phone?: string | null;
        position?: string | null;
        department?: string | null;
        address?: string | null;
        role?: string | null;
        status?: string | null;
        password_hash?: string | null;
        password_salt?: string | null;
        supabase_user_id?: string | null;
        auth_sync_status?: string | null;
        provisioned_at?: string | null;
        created_at?: string | null;
        location?: string | null;
        profile_image_data?: string | null;
        profile_image_format?: string | null;
        profile_image_updated_at?: string | null;
        two_factor_enabled?: number | null;
        email_notifications?: number | null;
        low_stock_alerts?: number | null;
        language?: string | null;
        last_modified?: string | null;
        deleted_at?: string | null;
        version?: number | null;
      }
    | undefined;
  if (!row) return null;

  const fallbackSplit = splitFullName(row.full_name ?? '');
  const now = nowIso();
  return {
    id: row.id,
    firstName: row.first_name ?? fallbackSplit.firstName,
    lastName: row.last_name ?? fallbackSplit.lastName,
    fullName: row.full_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    position: row.position ?? '',
    department: row.department ?? '',
    address: row.address ?? row.location ?? '',
    role: row.role ?? 'employee',
    status: row.status ?? 'active',
    passwordHash: row.password_hash ?? 'remote_managed',
    passwordSalt: row.password_salt ?? 'remote_managed',
    supabaseUserId: row.supabase_user_id ?? null,
    authSyncStatus: row.auth_sync_status ?? 'pending_upload',
    provisionedAt: row.provisioned_at ?? null,
    createdAt: row.created_at ?? now,
    location: row.location ?? '',
    profileImageDataUrl: row.profile_image_data ?? null,
    profileImageFormat: row.profile_image_format ?? null,
    profileImageUpdatedAt: row.profile_image_updated_at ?? null,
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    emailNotifications: Boolean(row.email_notifications),
    lowStockAlerts: Boolean(row.low_stock_alerts),
    language: row.language ?? 'English',
    lastModified: row.last_modified ?? now,
    deletedAt: row.deleted_at ?? null,
    version: readVersion(row.version, 1)
  };
};

const buildPushQueueRecord = (db: Database.Database, row: OutboxRow) => {
  const entityType = normalizeEntityType(row.entity_type);
  if (!entityType) return null;

  const operation = normalizeOperation(row.operation);
  const payload = (() => {
    try {
      return JSON.parse(row.payload || '{}');
    } catch {
      return {};
    }
  })();

  const version = readVersion(payload.version, getLocalVersion(db, entityType, row.entity_id) || 1);
  const localEmployeeSnapshot =
    entityType === 'employees' && operation !== 'delete' ? readLocalEmployeeForSync(db, row.entity_id) : null;
  const effectiveVersion =
    entityType === 'employees' && localEmployeeSnapshot
      ? readVersion(localEmployeeSnapshot.version, version)
      : version;
  const data = {
    ...payload,
    ...(localEmployeeSnapshot || {}),
    id: row.entity_id,
    version: effectiveVersion
  };

  return {
    localOutboxId: row.id,
    entityType,
    entityId: row.entity_id,
    queueRecord: {
      table_name: entityType,
      operation,
      record_id: row.entity_id,
      data
    }
  };
};
const sanitizeQueueData = (input: any, entityType?: string) => {
  if (!input || typeof input !== 'object') return input;
  const output = { ...input };
  const isEmployeePayload = entityType === 'employees';
  delete output._meta;
  if (!isEmployeePayload) {
    delete output.passwordHash;
    delete output.passwordSalt;
    delete output.password_hash;
    delete output.password_salt;
  }
  delete output.pendingPasswordPlain;
  delete output.pendingPasswordEncrypted;
  delete output.hashedSessionToken;
  delete output.lastVerifiedAt;
  delete output.verificationExpiresAt;
  delete output.authLastError;
  delete output.pending_password_enc;
  delete output.hashed_session_token;
  delete output.last_verified_at;
  delete output.verification_expires_at;
  delete output.auth_last_error;
  if (!isEmployeePayload) {
    delete output.profileImageDataUrl;
    delete output.profile_image_data;
    delete output.profileImageFormat;
    delete output.profile_image_format;
    delete output.profileImageUpdatedAt;
    delete output.profile_image_updated_at;
  }
  return output;
};

const buildEmployeeQueueRecords = (
  db: Database.Database,
  entry: {
    entityType: string;
    entityId: string;
    queueRecord: {
      operation: QueueOperation;
      data: any;
    };
  }
) : Array<{
  employee_id: string;
  payload: {
    table_name: string;
    operation: QueueOperation;
    record_id: string;
    data: any;
  };
}> => {
  const payload = entry.queueRecord.data || {};
  if (entry.entityType === 'products') {
    const currentAssigned = payload.assignedToEmployeeId ? String(payload.assignedToEmployeeId) : null;
    const previousAssigned = payload?._meta?.previousAssignedToEmployeeId
      ? String(payload._meta.previousAssignedToEmployeeId)
      : null;

    const recipients = new Set<string>();
    if (currentAssigned) recipients.add(currentAssigned);
    if (previousAssigned) recipients.add(previousAssigned);

    if (!recipients.size) return [];

    const data = sanitizeQueueData(payload, entry.entityType);

    return Array.from(recipients).map((employeeId) => ({
      employee_id: employeeId,
      payload: {
        table_name: entry.entityType,
        operation: entry.queueRecord.operation,
        record_id: entry.entityId,
        data
      }
    }));
  }

  if (entry.entityType === 'returns') {
    const returnedByEmployeeId = payload.returnedByEmployeeId || payload.returned_by_employee_id;
    const returnedByPosition = String(payload.returnedByPosition || payload.returned_by_position || '').trim().toLowerCase();
    if (!returnedByEmployeeId || returnedByPosition !== 'employee') return [];

    const data = sanitizeQueueData(payload, entry.entityType);
    return [
      {
        employee_id: String(returnedByEmployeeId),
        payload: {
          table_name: entry.entityType,
          operation: entry.queueRecord.operation,
          record_id: entry.entityId,
          data
        }
      }
    ];
  }

  if (entry.entityType === 'employees') {
    const employeeId = String(payload.id || entry.entityId || '').trim();
    if (!employeeId) return [];
    const recipients = new Set<string>([employeeId]);

    const normalizedRole = String(payload.role || '').trim().toLowerCase();
    if (normalizedRole === 'system_admin' || normalizedRole === 'admin') {
      const activeEmployeeRows = db
        .prepare("SELECT id FROM employees WHERE deleted_at IS NULL AND status = 'active'")
        .all() as Array<{ id?: string }>;
      for (const row of activeEmployeeRows) {
        const id = String(row.id || '').trim();
        if (!id) continue;
        recipients.add(id);
      }
    }

    const data = sanitizeQueueData(payload, entry.entityType);
    return Array.from(recipients).map((recipientId) => ({
      employee_id: recipientId,
      payload: {
        table_name: entry.entityType,
        operation: entry.queueRecord.operation,
        record_id: entry.entityId,
        data
      }
    }));
  }

  return [];
};

const isUuidLike = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

const tryReadScopedAuthUid = (): string | null => {
  if (!scopedSupabaseAccessToken) return null;
  const parts = scopedSupabaseAccessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    const sub = typeof payload?.sub === 'string' ? payload.sub : '';
    return isUuidLike(sub) ? sub : null;
  } catch {
    return null;
  }
};

const resolveOriginUserId = (db: Database.Database, actor: SyncActor): string | null => {
  const tokenUserId = tryReadScopedAuthUid();
  if (tokenUserId) return tokenUserId;
  const row = db
    .prepare('SELECT supabase_user_id FROM employees WHERE id = ?')
    .get(actor.userId) as { supabase_user_id?: string | null } | undefined;
  if (row?.supabase_user_id && isUuidLike(row.supabase_user_id)) return row.supabase_user_id;
  return isUuidLike(actor.userId) ? actor.userId : null;
};

const buildRecipientKey = (employeeId: string | null): string => {
  const normalized = String(employeeId || '').trim();
  return normalized || RELAY_RECIPIENT_ALL;
};

const buildRelayQueueRow = (
  payload: { table_name: string; operation: QueueOperation; record_id: string; data: any },
  originDeviceId: string,
  originUserId: string | null,
  employeeId: string | null
) => {
  const createdAt = nowIso();
  const updatedAt = String(
    payload.data?.updatedAt || payload.data?.lastModified || payload.data?.createdAt || payload.data?.timestamp || createdAt
  );
  const queuePayload = {
    ...payload,
    created_at: createdAt,
    updated_at: updatedAt
  };
  return {
    employee_id: employeeId,
    recipient_key: buildRecipientKey(employeeId),
    origin_device_id: originDeviceId,
    origin_user_id: originUserId,
    payload: queuePayload,
    payload_size_kb: sizeKbForJson(queuePayload),
    created_at: createdAt,
    updated_at: updatedAt,
    // backward-compatibility columns
    table_name: payload.table_name,
    operation: payload.operation,
    record_id: payload.record_id,
    data: payload.data,
    timestamp: createdAt
  };
};

const chunkRecordsBySize = <T extends Record<string, unknown>>(
  records: T[],
  maxBytes: number,
  maxRecords: number
): Array<{ rows: T[]; bytes: number }> => {
  if (!records.length) return [];

  const batches: Array<{ rows: T[]; bytes: number }> = [];
  let currentRows: T[] = [];
  let currentBytes = 0;

  for (const row of records) {
    const rowBytes = Math.max(1, sizeBytesForJson(row));
    const rowExceeds = rowBytes > maxBytes;
    const wouldOverflow = currentRows.length > 0 && currentBytes + rowBytes > maxBytes;
    const wouldExceedRecordCount = currentRows.length >= maxRecords;

    if (wouldOverflow || wouldExceedRecordCount) {
      batches.push({ rows: currentRows, bytes: currentBytes });
      currentRows = [];
      currentBytes = 0;
    }

    currentRows.push(row);
    currentBytes += rowBytes;

    if (rowExceeds) {
      batches.push({ rows: currentRows, bytes: currentBytes });
      currentRows = [];
      currentBytes = 0;
    }
  }

  if (currentRows.length > 0) {
    batches.push({ rows: currentRows, bytes: currentBytes });
  }

  return batches;
};

const mapStatus = (actor: SyncActor, state: SyncStateRow, db: Database.Database) => ({
  fullSyncRequired: Boolean(state.full_sync_required),
  fullSyncReason: state.full_sync_reason,
  fullSyncEligible: canRequestFullSync(actor) ? isManualFullSyncEligible(state) : false,
  fullSyncEligibilityReason: canRequestFullSync(actor) ? getManualFullSyncBlockReason(state) : null,
  lastSuccessfulSyncAt: getLastSuccessfulSyncAt(state),
  deviceId: state.device_id,
  lastAutoSyncAt: state.last_auto_sync_at,
  lastFullSyncAt: state.last_full_sync_at,
  deviceRegisteredAt: state.device_registered_at,
  retentionDays: SYNC_QUEUE_RETENTION_DAYS,
  maxOfflineDays: SYNC_MAX_OFFLINE_DAYS,
  role: actor.role,
  canPush: !state.full_sync_required && canPushLocalChanges(actor),
  canPull: !state.full_sync_required && (canAdminSync(actor) || canEmployeePull(actor)),
  mode: state.online_mode ? 'online' : 'offline',
  configured: isConfigured(),
  lastPushAt: state.last_push_at,
  lastPullAt: state.last_pull_at,
  lastPushCount: state.last_push_count,
  lastPullCount: state.last_pull_count,
  lastConflictCount: state.last_conflict_count,
  lastStatus: state.last_status,
  lastError: state.last_error,
  lastWarning: state.last_warning,
  relayQueueRows: state.relay_queue_rows,
  relayQueuePayloadMb: state.relay_queue_payload_mb,
  relayStorageMb: state.relay_storage_mb,
  relayOldestQueueAt: state.relay_oldest_queue_at,
  relayLastCheckedAt: state.relay_last_checked_at,
  relayDbLimitMb: SYNC_RELAY_DB_LIMIT_MB,
  relayStorageLimitMb: SYNC_RELAY_STORAGE_LIMIT_MB,
  relayDbSoftThreshold: SYNC_RELAY_DB_SOFT_THRESHOLD,
  relayDbHardThreshold: SYNC_RELAY_DB_HARD_THRESHOLD,
  relayStorageSoftThreshold: SYNC_RELAY_STORAGE_SOFT_THRESHOLD,
  relayStorageHardThreshold: SYNC_RELAY_STORAGE_HARD_THRESHOLD,
  pendingLocalChanges: canPushLocalChanges(actor) ? getPendingLocalChangeCount(db, actor) : 0,
  recentLogs: getRecentEvents(db).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    message: event.message,
    pushedCount: event.pushed_count,
    pulledCount: event.pulled_count,
    conflictCount: event.conflict_count,
    createdAt: event.created_at
  }))
});

const getSyncPermissionError = (actor: SyncActor): string | null => {
  if (canAdminSync(actor) || canEmployeePull(actor)) return null;
  return 'Sync controls are available to system admins and employees only.';
};

const filterPreparedEntriesByStage = <T extends { localOutboxId: number }>(
  entries: T[],
  stage: PushStageOptions | undefined,
  categoryByOutboxId: Map<number, LocalChangeCategoryKey>
) => {
  if (!stage) return entries;

  const selectedIds = new Set((stage.outboxIds || []).map((value) => Number(value)).filter((value) => Number.isFinite(value)));
  if (selectedIds.size > 0) {
    return entries.filter((entry) => selectedIds.has(entry.localOutboxId));
  }

  const selectedCategories = new Set((stage.categories || []).map((value) => String(value || '').trim()).filter(Boolean));
  if (Array.isArray(stage.categories)) {
    if (selectedCategories.size === 0) return [];
    return entries.filter((entry) => selectedCategories.has(categoryByOutboxId.get(entry.localOutboxId) || ''));
  }

  return entries;
};

export function getSyncStatus(actor: SyncActor) {
  const db = dataStore.getDb();
  const state = markFullSyncRequired(db, actor, readSyncState(db, actor));
  return mapStatus(actor, state, db);
}

export function setOnlineMode(actor: SyncActor, online: boolean) {
  const permissionError = getSyncPermissionError(actor);
  const db = dataStore.getDb();
  if (permissionError) {
    writeSyncState(db, actor, { last_status: 'error', last_error: permissionError });
    return { ...mapStatus(actor, readSyncState(db, actor), db), error: permissionError };
  }

  const current = readSyncState(db, actor);
  const fullSyncState = markFullSyncRequired(db, actor, current);
  const reason = getFullSyncRequiredReason(fullSyncState);

  const state = writeSyncState(db, actor, {
    online_mode: online ? 1 : 0,
    last_status: online ? (reason ? 'full_sync_required' : 'online') : 'offline',
    last_error: online ? reason : null,
    full_sync_required: online && reason ? 1 : fullSyncState.full_sync_required,
    full_sync_reason: online && reason ? reason : fullSyncState.full_sync_reason
  });

  logSyncEvent(db, {
    eventType: 'mode',
    message: reason && online
      ? `${actor.role} switched sync mode to Online but full sync is required before push/pull`
      : `${actor.role} switched sync mode to ${online ? 'Online' : 'Offline'}`
  });

  return reason && online ? { ...mapStatus(actor, state, db), error: reason } : mapStatus(actor, state, db);
}

export async function pushLocalChanges(actor: SyncActor, stage?: PushStageOptions) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    const state = markFullSyncRequired(db, actor, readSyncState(db, actor));

    if (!canPushLocalChanges(actor)) {
      return { status: 'forbidden', pushedCount: 0, error: 'Only system admin and employee accounts can push local changes.' };
    }

    const fullSyncReason = getFullSyncRequiredReason(state);
    if (fullSyncReason) {
      writeSyncState(db, actor, {
        full_sync_required: 1,
        full_sync_reason: fullSyncReason,
        last_status: 'full_sync_required',
        last_error: fullSyncReason
      });
      return { status: 'full_sync_required', pushedCount: 0, error: fullSyncReason };
    }

    if (!state.online_mode) {
      return { status: 'offline', pushedCount: 0, error: 'Sync is offline. Enable Online mode to push changes.' };
    }

    if (!isConfigured()) {
      const message = 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'push', message });
      return { status: 'error', pushedCount: 0, error: message };
    }

    const prunedRows = pruneUnsupportedOutboxRows(db);
    if (prunedRows > 0) {
      logSyncEvent(db, {
        eventType: 'push',
        message: `Removed ${prunedRows} unsupported sync item(s) from local outbox (activity logs remain local only).`
      });
    }

    try {
      await cleanupQueueRetention(actor);
    } catch (error: any) {
      const message = error?.message ?? 'Failed to run queue retention cleanup.';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'push', message: `Push blocked: ${message}` });
      return { status: 'error', pushedCount: 0, error: message };
    }

    const pendingRows = getPendingOutboxRows(db, actor);
    if (!pendingRows.length) {
      writeSyncState(db, actor, { last_status: 'online', last_error: null, last_push_count: 0 });
      return { status: 'idle', pushedCount: 0 };
    }

    const localSummary = buildLocalChangeSummary(actor, pendingRows);
    const categoryByOutboxId = new Map<number, LocalChangeCategoryKey>(
      localSummary.changes.map((item) => [item.outboxId, item.categoryKey])
    );

    const preparedAll = pendingRows.map((row) => buildPushQueueRecord(db, row)).filter(Boolean) as Array<{
      localOutboxId: number;
      entityType: string;
      entityId: string;
      queueRecord: {
        table_name: string;
        operation: QueueOperation;
        record_id: string;
        data: any;
      };
    }>;

    const pushablePrepared = preparedAll.filter((entry) => canPushEntityType(actor, entry.entityType));
    const actorScopedPrepared = pushablePrepared.filter(
      (entry) => actor.role !== 'employee' || entry.entityType !== 'employees' || entry.entityId === actor.userId
    );
    const prepared = filterPreparedEntriesByStage(actorScopedPrepared, stage, categoryByOutboxId);

    if (!prepared.length) {
      return { status: 'idle', pushedCount: 0 };
    }

    const originDeviceId = getLocalDeviceId(db);
    const originUserId = resolveOriginUserId(db, actor);
    if (!originUserId) {
      const message = 'Unable to resolve authenticated Supabase user id for sync payload (origin_user_id).';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'push', message: `Push blocked: ${message}` });
      return { status: 'error', pushedCount: 0, error: message };
    }

    let remoteEmployeeIdForPush: string | null = null;
    try {
      const permission = await ensureActorQueuePermission(actor, originUserId);
      remoteEmployeeIdForPush = permission.remoteEmployeeId;
      if (permission.error) {
        writeSyncState(db, actor, { last_status: 'error', last_error: permission.error });
        logSyncEvent(db, { eventType: 'push', message: `Push blocked: ${permission.error}` });
        return { status: 'error', pushedCount: 0, error: permission.error };
      }
    } catch (error: any) {
      const message = error?.message || 'Unable to verify Supabase app user role for push.';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'push', message: `Push blocked: ${message}` });
      return { status: 'error', pushedCount: 0, error: message };
    }

    const adminPayloadRecords = canAdminSync(actor)
      ? prepared.map((entry) => ({
          table_name: entry.queueRecord.table_name,
          operation: entry.queueRecord.operation,
          record_id: entry.queueRecord.record_id,
          data: sanitizeQueueData(entry.queueRecord.data, entry.entityType)
        }))
      : [];

    let targetedAdminPayloadRecords = canAdminSync(actor)
      ? prepared.flatMap((entry) => buildEmployeeQueueRecords(db, entry))
      : [];

    if (canAdminSync(actor) && targetedAdminPayloadRecords.length) {
      const targetEmployeeIds = Array.from(
        new Set(targetedAdminPayloadRecords.map((item) => String(item.employee_id || '').trim()).filter(Boolean))
      );
      if (targetEmployeeIds.length) {
        try {
          const presence = await fetchEmployeePresenceMap(targetEmployeeIds);
          const staleTargets = getStaleRecipients(presence, targetEmployeeIds);
          if (staleTargets.size > 0) {
            targetedAdminPayloadRecords = targetedAdminPayloadRecords.filter(
              (item) => !staleTargets.has(String(item.employee_id || '').trim())
            );
            logSyncEvent(db, {
              eventType: 'push',
              message:
                `Skipped ${staleTargets.size} stale employee target(s) with no recent activity ` +
                `(>${SYNC_TARGET_STALE_DAYS} days).`
            });
          }
        } catch {
          // Best-effort stale target filtering. Continue push flow if presence lookup fails.
        }
      }
    }

    const employeeTargetId = !canAdminSync(actor) ? String(remoteEmployeeIdForPush || actor.userId).trim() : null;
    const employeePayloadRecords = !canAdminSync(actor)
      ? prepared.map((entry) => ({
          employee_id: employeeTargetId || actor.userId,
          payload: {
            table_name: entry.queueRecord.table_name,
            operation: entry.queueRecord.operation,
            record_id: entry.queueRecord.record_id,
            data: sanitizeQueueData(entry.queueRecord.data, entry.entityType)
          }
        }))
      : [];

    const profileImageRelayRows = prepared
      .filter((entry) => entry.entityType === 'employees' && entry.queueRecord.operation !== 'delete')
      .map((entry) => {
        const data = entry.queueRecord.data || {};
        const hasImageData =
          Object.prototype.hasOwnProperty.call(data, 'profileImageDataUrl') ||
          Object.prototype.hasOwnProperty.call(data, 'profile_image_data');
        const hasImageUpdatedAt =
          Object.prototype.hasOwnProperty.call(data, 'profileImageUpdatedAt') ||
          Object.prototype.hasOwnProperty.call(data, 'profile_image_updated_at');
        if (!hasImageData && !hasImageUpdatedAt) return null;
        const imageData = hasImageData ? data.profileImageDataUrl ?? data.profile_image_data ?? null : null;
        const updatedAtRaw = data.profileImageUpdatedAt ?? data.profile_image_updated_at ?? null;
        const updatedAt = String(updatedAtRaw ?? data.updatedAt ?? data.lastModified ?? nowIso());
        const imageUpdatedMs = parseTimestamp(updatedAtRaw);
        const rowLastModifiedMs = parseTimestamp(data.lastModified ?? data.updatedAt ?? null);
        if (imageUpdatedMs == null) return null;
        if (rowLastModifiedMs != null && imageUpdatedMs + 1000 < rowLastModifiedMs) {
          return null;
        }
        return {
          employee_id: entry.entityId,
          origin_device_id: originDeviceId,
          origin_user_id: originUserId,
          image_data: imageData,
          image_format: getProfileImageFormat(imageData, data.profileImageFormat ?? data.profile_image_format ?? null),
          created_at: nowIso(),
          updated_at: updatedAt
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    if (!canAdminSync(actor) && employeePayloadRecords.length) {
      const freshAdminAvailable = await hasRecentAdminPresence();
      if (freshAdminAvailable === false) {
        const message =
          `Push deferred: no active system-admin sync activity detected in the last ${SYNC_TARGET_STALE_DAYS} day` +
          `${SYNC_TARGET_STALE_DAYS === 1 ? '' : 's'}. Local changes remain queued.`;
        writeSyncState(db, actor, {
          last_status: 'deferred',
          last_error: null,
          last_warning: message
        });
        logSyncEvent(db, { eventType: 'push', message });
        return { status: 'deferred', pushedCount: 0, error: message };
      }
    }

    const adminQueueRecords = adminPayloadRecords.map((payload) => buildRelayQueueRow(payload, originDeviceId, originUserId, null));
    const targetedAdminQueueRecords = targetedAdminPayloadRecords.map((item) =>
      buildRelayQueueRow(item.payload, originDeviceId, originUserId, item.employee_id || null)
    );
    const employeeQueueRecords = employeePayloadRecords.map((item) =>
      buildRelayQueueRow(item.payload, originDeviceId, originUserId, item.employee_id || null)
    );

    const projectedPushBytes =
      adminQueueRecords.reduce((sum, row) => sum + sizeBytesForJson(row), 0) +
      targetedAdminQueueRecords.reduce((sum, row) => sum + sizeBytesForJson(row), 0) +
      employeeQueueRecords.reduce((sum, row) => sum + sizeBytesForJson(row), 0) +
      profileImageRelayRows.reduce((sum, row) => sum + sizeBytesForJson(row), 0);

    let relayWarning: string | null = null;
    const relayUsage = await fetchRelayUsageStats();
    if (relayUsage) {
      const pressure = evaluateRelayPressure(relayUsage, projectedPushBytes);
      relayWarning = pressure.warning;
      persistRelayUsageSnapshot(db, actor, relayUsage, relayWarning);
      if (relayWarning) {
        logSyncEvent(db, { eventType: 'relay_usage', message: relayWarning });
      }
      if (pressure.block) {
        writeSyncState(db, actor, {
          last_status: 'throttled',
          last_error: null,
          last_warning: relayWarning
        });
        return {
          status: 'deferred',
          pushedCount: 0,
          totalSizeKb: Number((projectedPushBytes / 1024).toFixed(3)),
          batchCount: 0,
          error: relayWarning || 'Push deferred due to relay quota protection.'
        };
      }
    }

    try {
      let uploadedBatchCount = 0;
      let uploadedBytes = 0;
      const pushBatches = async (tableName: string, records: Array<Record<string, unknown>>) => {
        const batches = chunkRecordsBySize(records, SYNC_PUSH_MAX_BATCH_BYTES, SYNC_PUSH_MAX_BATCH_RECORDS);
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          await pushQueueBatch(tableName, batch.rows);
          uploadedBatchCount += 1;
          uploadedBytes += batch.bytes;
          logSyncEvent(db, {
            eventType: 'push_batch',
            message: `Uploading batch ${batchIndex + 1}/${batches.length} to ${tableName} (${(batch.bytes / 1024 / 1024).toFixed(2)} MB)`
          });
        }
      };
      const pushProfileImageBatches = async (records: Array<Record<string, unknown>>) => {
        const batches = chunkRecordsBySize(records, SYNC_PUSH_MAX_BATCH_BYTES, SYNC_PUSH_MAX_BATCH_RECORDS);
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          await pushProfileImageQueueRows(batch.rows);
          uploadedBatchCount += 1;
          uploadedBytes += batch.bytes;
          logSyncEvent(db, {
            eventType: 'push_batch',
            message:
              `Uploading profile-image batch ${batchIndex + 1}/${batches.length} ` +
              `to ${getProfileQueueTable()} (${(batch.bytes / 1024 / 1024).toFixed(2)} MB)`
          });
        }
      };

      await pushBatches(getAdminQueueTable(), adminQueueRecords);
      await pushBatches(getAdminQueueTable(), targetedAdminQueueRecords);
      await pushBatches(getEmployeeQueueTable(), employeeQueueRecords);
      await pushProfileImageBatches(profileImageRelayRows);

      const syncedAt = nowIso();
      const tx = db.transaction(() => {
        for (const entry of prepared) {
          markEntitySynced(db, entry.entityType, entry.entityId, syncedAt);
          clearOutboxEntity(db, entry.entityType, entry.entityId);
        }

        writeSyncState(db, actor, {
          last_push_at: syncedAt,
          last_successful_sync_at: syncedAt,
          last_auto_sync_at: syncedAt,
          device_registered_at: state.device_registered_at || syncedAt,
          last_push_count: prepared.length,
          full_sync_required: 0,
          full_sync_reason: null,
          last_status: 'online',
          last_error: null,
          last_warning: relayWarning
        });

        logSyncEvent(db, {
          eventType: 'push',
          message: canAdminSync(actor)
            ? `System admin pushed ${prepared.length} staged change(s), ${uploadedBatchCount} batch(es), ${(uploadedBytes / 1024).toFixed(1)} KB`
            : `Employee pushed ${prepared.length} submission(s) in ${uploadedBatchCount} batch(es)`,
          pushedCount: prepared.length
        });
      });

      tx();
      await touchActorPresence(db, actor, originUserId);

      return {
        status: 'synced',
        pushedCount: prepared.length,
        totalSizeKb: Number((uploadedBytes / 1024).toFixed(3)),
        batchCount: uploadedBatchCount,
        employeeQueueCount: canAdminSync(actor) ? targetedAdminQueueRecords.length : employeeQueueRecords.length
      };
    } catch (error: any) {
      const message = error?.message ?? 'Push failed';
      markOutboxAttemptError(
        db,
        prepared.map((entry) => entry.localOutboxId),
        message
      );

      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'push', message: `Push failed: ${message}` });

      return { status: 'error', pushedCount: 0, error: message };
    }
  });
}

export async function previewRemoteChanges(actor: SyncActor) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    const state = markFullSyncRequired(db, actor, readSyncState(db, actor));

    const permissionError = getSyncPermissionError(actor);
    if (permissionError) {
      return { status: 'forbidden', newRecords: 0, conflictCount: 0, error: permissionError };
    }

    const fullSyncReason = getFullSyncRequiredReason(state);
    if (fullSyncReason) {
      writeSyncState(db, actor, {
        full_sync_required: 1,
        full_sync_reason: fullSyncReason,
        last_status: 'full_sync_required',
        last_error: fullSyncReason
      });
      return { status: 'full_sync_required', newRecords: 0, conflictCount: 0, error: fullSyncReason };
    }

    if (!state.online_mode) {
      return { status: 'offline', newRecords: 0, conflictCount: 0 };
    }

    if (!isConfigured()) {
      const message = 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).';
      return { status: 'error', newRecords: 0, conflictCount: 0, error: message };
    }

    try {
      const currentDeviceId = getLocalDeviceId(db);
      const rows = canAdminSync(actor)
        ? await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, EMPLOYEE_ID_NULL_FILTER, currentDeviceId)
        : await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, actor.userId, currentDeviceId);
      let conflicts = 0;
      let totalSizeKb = 0;

      for (const row of rows) {
        const entityType = normalizeEntityType(readRemoteTableName(row) || '');
        if (!entityType || entityType === 'activity_logs') continue;
        const remoteData = readRemoteData(row);
        totalSizeKb += Number(row.payload_size_kb ?? sizeKbForJson(remoteData));
        const remoteVersion = readVersion(remoteData?.version, 1);
        const localMeta = getLocalRecordMeta(db, entityType, readRemoteRecordId(row));
        const localVersion = localMeta.version;
        const remoteUpdatedMs = parseTimestamp(readRemoteUpdatedAt(row, remoteData));
        const localUpdatedMs = parseTimestamp(localMeta.lastModified);
        if (localMeta.exists && remoteUpdatedMs != null && localUpdatedMs != null && remoteUpdatedMs <= localUpdatedMs) {
          conflicts += 1;
          continue;
        }
        if (localVersion > remoteVersion) conflicts += 1;
      }

      let previewMessage: string | undefined;
      if (rows.length === 0) {
        const allVisibleRows = canAdminSync(actor)
          ? await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, EMPLOYEE_ID_NULL_FILTER)
          : await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, actor.userId);
        previewMessage = allVisibleRows.length > 0 ? 'Data already exists locally.' : 'No new remote records available.';
      }

      writeSyncState(db, actor, {
        last_status: 'online',
        last_error: null,
        last_successful_sync_at: nowIso()
      });

      return {
        status: 'ok',
        newRecords: rows.length,
        conflictCount: conflicts,
        totalSizeKb: Number(totalSizeKb.toFixed(3)),
        message: previewMessage
      };
    } catch (error: any) {
      return {
        status: 'error',
        newRecords: 0,
        conflictCount: 0,
        error: error?.message ?? 'Preview failed'
      };
    }
  });
}

const pullAdminChanges = async (
  db: Database.Database,
  actor: SyncActor,
  state: SyncStateRow,
  conflictStrategy: ConflictStrategy,
  currentDeviceId: string
) => {
  const rows = await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, EMPLOYEE_ID_NULL_FILTER, currentDeviceId);
  if (!rows.length) {
    const allVisibleRows = await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, EMPLOYEE_ID_NULL_FILTER);
    const message = allVisibleRows.length ? 'Data already exists locally.' : 'No new remote records available.';
    const syncedAt = nowIso();
    writeSyncState(db, actor, {
      last_status: 'online',
      last_error: null,
      last_pull_count: 0,
      last_conflict_count: 0,
      last_successful_sync_at: syncedAt,
      last_auto_sync_at: syncedAt,
      device_registered_at: state.device_registered_at || syncedAt,
      full_sync_required: 0,
      full_sync_reason: null
    });
    return {
      status: 'idle',
      pulledCount: 0,
      conflictCount: 0,
      conflicts: [] as ConflictRecord[],
      message
    };
  }

  const conflicts: ConflictRecord[] = [];
  const remoteIdsToDelete: string[] = [];
  let pulledCount = 0;
  let latestAppliedTimestamp: string | null = null;

  const applyTx = db.transaction(() => {
    for (const row of rows) {
      const entityType = normalizeEntityType(readRemoteTableName(row) || '');
      const rowCreatedAt = readRemoteTimestamp(row);
      if (!entityType || entityType === 'activity_logs') {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      const operation = readRemoteOperation(row);
      const recordId = readRemoteRecordId(row);
      if (!recordId) {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) latestAppliedTimestamp = rowCreatedAt;
        continue;
      }
      const remoteData = readRemoteData(row);
      const remoteVersion = readVersion(remoteData?.version, 1);
      const localMeta = getLocalRecordMetaForRemote(db, entityType, recordId, remoteData);
      const localVersion = localMeta.version;
      const remoteUpdatedAt = readRemoteUpdatedAt(row, remoteData);
      const remoteUpdatedMs = parseTimestamp(remoteUpdatedAt);
      const localUpdatedMs = parseTimestamp(localMeta.lastModified);

      if (localMeta.exists && remoteUpdatedMs != null && localUpdatedMs != null && remoteUpdatedMs <= localUpdatedMs) {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      if (localVersion > remoteVersion && conflictStrategy === 'skip') {
        // Admin-local version is newer than employee submission: keep local truth and clear stale remote row.
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      const resolvedVersion =
        localVersion > remoteVersion && conflictStrategy === 'remote_wins' ? localVersion + 1 : remoteVersion;

      const payload = {
        ...(remoteData || {}),
        id: recordId,
        version: resolvedVersion
      };

      try {
        if (operation === 'delete') {
          const deleteRecordId =
            entityType === 'employees'
              ? resolveLocalEmployeeRecordIdForRemote(db, recordId, payload)
              : recordId;
          applyRemoteDelete(db, entityType, deleteRecordId, payload.deletedAt || rowCreatedAt || nowIso(), resolvedVersion);
        } else {
          applyRemoteUpsert(db, entityType, payload, resolvedVersion);
        }
      } catch (error: any) {
        const message = String(error?.message || '');
        if (message.toLowerCase().includes('foreign key constraint failed')) {
          conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
          logSyncEvent(db, {
            eventType: 'pull',
            message: `Deferred admin queue record ${row.id} (${entityType}:${recordId}) due to missing local dependency.`
          });
          continue;
        }
        throw error;
      }

      remoteIdsToDelete.push(row.id);
      pulledCount += 1;

      if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
        latestAppliedTimestamp = rowCreatedAt;
      }
    }
  });

  applyTx();

  if (remoteIdsToDelete.length) {
    await deleteRemoteQueueRowsWithRetry(getAdminQueueTable(), remoteIdsToDelete, currentDeviceId);
  }

  const shouldAdvanceCursor = conflicts.length === 0 && Boolean(latestAppliedTimestamp);
  const syncedAt = nowIso();

  const updateTx = db.transaction(() => {
    writeSyncState(db, actor, {
      last_pull_at: shouldAdvanceCursor ? latestAppliedTimestamp : state.last_pull_at,
      last_successful_sync_at: syncedAt,
      last_auto_sync_at: syncedAt,
      device_registered_at: state.device_registered_at || syncedAt,
      last_pull_count: pulledCount,
      last_conflict_count: conflicts.length,
      full_sync_required: 0,
      full_sync_reason: null,
      last_status: conflicts.length ? 'conflict' : 'online',
      last_error: null
    });

    const summary = conflicts.length
      ? `System admin pulled ${pulledCount} global change(s) with ${conflicts.length} conflict(s)`
      : `System admin pulled ${pulledCount} global change(s)`;

    logSyncEvent(db, {
      eventType: 'pull',
      message: summary,
      pulledCount,
      conflictCount: conflicts.length
    });
  });

  updateTx();

  return {
    status: conflicts.length ? 'conflict' : 'synced',
    pulledCount,
    conflictCount: conflicts.length,
    conflicts
  };
};

const pullEmployeeAssignedChanges = async (
  db: Database.Database,
  actor: SyncActor,
  state: SyncStateRow,
  conflictStrategy: ConflictStrategy,
  currentDeviceId: string
) => {
  const rows = await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, actor.userId, currentDeviceId);
  if (!rows.length) {
    const allVisibleRows = await fetchAllRemoteQueueRows(getAdminQueueTable(), state.last_pull_at, actor.userId);
    const message = allVisibleRows.length ? 'Data already exists locally.' : 'No new remote records available.';
    const syncedAt = nowIso();
    writeSyncState(db, actor, {
      last_status: 'online',
      last_error: null,
      last_pull_count: 0,
      last_conflict_count: 0,
      last_successful_sync_at: syncedAt,
      last_auto_sync_at: syncedAt,
      device_registered_at: state.device_registered_at || syncedAt,
      full_sync_required: 0,
      full_sync_reason: null
    });
    return {
      status: 'idle',
      pulledCount: 0,
      conflictCount: 0,
      conflicts: [] as ConflictRecord[],
      message
    };
  }

  const conflicts: ConflictRecord[] = [];
  const remoteIdsToDelete: string[] = [];
  let pulledCount = 0;
  let latestAppliedTimestamp: string | null = null;
  const rowsOrdered = [...rows].sort((left, right) => {
    const leftEntity = normalizeEntityType(readRemoteTableName(left) || '');
    const rightEntity = normalizeEntityType(readRemoteTableName(right) || '');
    const priority = (entity: string | null): number => {
      if (entity === 'products') return 0;
      if (entity === 'returns') return 1;
      return 2;
    };
    const byPriority = priority(leftEntity) - priority(rightEntity);
    if (byPriority !== 0) return byPriority;
    const leftCreated = Date.parse(readRemoteTimestamp(left));
    const rightCreated = Date.parse(readRemoteTimestamp(right));
    if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  const applyTx = db.transaction(() => {
    for (const row of rowsOrdered) {
      const entityType = normalizeEntityType(readRemoteTableName(row) || '');
      const rowCreatedAt = readRemoteTimestamp(row);
      if (entityType !== 'products' && entityType !== 'returns' && entityType !== 'employees') {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      const operation = readRemoteOperation(row);
      const recordId = readRemoteRecordId(row);
      if (!recordId) {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) latestAppliedTimestamp = rowCreatedAt;
        continue;
      }
      const remoteData = readRemoteData(row);
      const remoteVersion = readVersion(remoteData?.version, 1);
      const localMeta = getLocalRecordMetaForRemote(db, entityType, recordId, remoteData);
      const localVersion = localMeta.version;
      const remoteUpdatedAt = readRemoteUpdatedAt(row, remoteData);
      const remoteUpdatedMs = parseTimestamp(remoteUpdatedAt);
      const localUpdatedMs = parseTimestamp(localMeta.lastModified);

      if (localMeta.exists && remoteUpdatedMs != null && localUpdatedMs != null && remoteUpdatedMs <= localUpdatedMs) {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      if (localVersion > remoteVersion && conflictStrategy === 'skip') {
        conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
        markEntityConflict(db, entityType, recordId);
        continue;
      }

      const resolvedVersion =
        localVersion > remoteVersion && conflictStrategy === 'remote_wins' ? localVersion + 1 : remoteVersion;

      const payload = {
        ...normalizeAdminQueuePayloadForEmployee(db, row, entityType, remoteData || {}, actor.userId),
        id: recordId,
        version: resolvedVersion
      };

      try {
        if (entityType === 'products') {
          const assignedToCandidate = payload.assignedToEmployeeId ?? payload.assigned_to_employee_id ?? null;
          const assignedToEmployeeId = assignedToCandidate ? String(assignedToCandidate).trim() : null;
          const assignmentStatus = String(payload.assignmentStatus ?? payload.assignment_status ?? '').toLowerCase();
          const deletedAt = payload.deletedAt ?? payload.deleted_at ?? rowCreatedAt ?? nowIso();
          const shouldDeleteLocal =
            operation === 'delete' || !assignedToEmployeeId || assignedToEmployeeId !== actor.userId || assignmentStatus === 'returned';

          if (shouldDeleteLocal) {
            applyRemoteDelete(db, 'products', recordId, deletedAt, resolvedVersion);
          } else {
            applyRemoteProduct(db, payload, resolvedVersion);
          }
        } else if (entityType === 'returns') {
          if (operation === 'delete') {
            const deletedAt = payload.deletedAt ?? payload.deleted_at ?? rowCreatedAt ?? nowIso();
            applyRemoteDelete(db, 'returns', recordId, deletedAt, resolvedVersion);
          } else {
            const returnedByEmployeeId = String(payload.returnedByEmployeeId || '').trim();
            if (!returnedByEmployeeId) {
              conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
              markEntityConflict(db, entityType, recordId);
              logSyncEvent(db, {
                eventType: 'pull',
                message: `Deferred admin return ${row.id} (${entityType}:${recordId}) because returning employee is unavailable locally.`
              });
              continue;
            }
            applyRemoteReturn(db, payload, resolvedVersion);
          }
        } else {
          if (operation === 'delete') {
            const deletedAt = payload.deletedAt ?? payload.deleted_at ?? rowCreatedAt ?? nowIso();
            const deleteEmployeeId = resolveLocalEmployeeRecordIdForRemote(db, recordId, payload);
            applyRemoteDelete(db, 'employees', deleteEmployeeId, deletedAt, resolvedVersion);
          } else {
            applyRemoteEmployee(db, payload, resolvedVersion);
          }
        }
      } catch (error: any) {
        const message = String(error?.message || '');
        if (message.toLowerCase().includes('foreign key constraint failed')) {
          conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
          markEntityConflict(db, entityType, recordId);
          logSyncEvent(db, {
            eventType: 'pull',
            message: `Deferred admin queue record ${row.id} (${entityType}:${recordId}) due to missing local dependency.`
          });
          continue;
        }
        throw error;
      }

      remoteIdsToDelete.push(row.id);
      pulledCount += 1;

      if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
        latestAppliedTimestamp = rowCreatedAt;
      }
    }
  });

  applyTx();

  if (remoteIdsToDelete.length) {
    await deleteRemoteQueueRowsWithRetry(getAdminQueueTable(), remoteIdsToDelete, currentDeviceId);
  }

  const shouldAdvanceCursor = conflicts.length === 0 && Boolean(latestAppliedTimestamp);
  const syncedAt = nowIso();

  const updateTx = db.transaction(() => {
    writeSyncState(db, actor, {
      last_pull_at: shouldAdvanceCursor ? latestAppliedTimestamp : state.last_pull_at,
      last_successful_sync_at: syncedAt,
      last_auto_sync_at: syncedAt,
      device_registered_at: state.device_registered_at || syncedAt,
      last_pull_count: pulledCount,
      last_conflict_count: conflicts.length,
      full_sync_required: 0,
      full_sync_reason: null,
      last_status: conflicts.length ? 'conflict' : 'online',
      last_error: null
    });

    const summary = conflicts.length
      ? `Employee pulled ${pulledCount} assigned update(s) with ${conflicts.length} conflict(s)`
      : `Employee pulled ${pulledCount} assigned update(s)`;

    logSyncEvent(db, {
      eventType: 'pull',
      message: summary,
      pulledCount,
      conflictCount: conflicts.length
    });
  });

  updateTx();

  return {
    status: conflicts.length ? 'conflict' : 'synced',
    pulledCount,
    conflictCount: conflicts.length,
    conflicts
  };
};

const pullEmployeeSubmissionsForAdmin = async (
  db: Database.Database,
  actor: SyncActor,
  conflictStrategy: ConflictStrategy,
  currentDeviceId: string
) => {
  const rows = await fetchAllRemoteQueueRows(getEmployeeQueueTable(), null, null, currentDeviceId);
  if (!rows.length) {
    const syncedAt = nowIso();
    const currentState = readSyncState(db, actor);
    writeSyncState(db, actor, {
      last_successful_sync_at: syncedAt,
      last_auto_sync_at: syncedAt,
      device_registered_at: currentState.device_registered_at || syncedAt,
      last_status: 'online',
      last_error: null
    });
    return {
      status: 'idle' as const,
      pulledCount: 0,
      conflictCount: 0,
      conflicts: [] as ConflictRecord[]
    };
  }

  const rowsOrdered = [...rows].sort((left, right) => {
    const leftEntity = normalizeEntityType(readRemoteTableName(left) || '');
    const rightEntity = normalizeEntityType(readRemoteTableName(right) || '');
    const priority = (entity: string | null): number => {
      if (entity === 'products') return 0;
      if (entity === 'returns') return 1;
      return 2;
    };
    const byPriority = priority(leftEntity) - priority(rightEntity);
    if (byPriority !== 0) return byPriority;
    const leftCreated = Date.parse(readRemoteTimestamp(left));
    const rightCreated = Date.parse(readRemoteTimestamp(right));
    if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  const conflicts: ConflictRecord[] = [];
  const remoteIdsToDelete: string[] = [];
  let pulledCount = 0;
  let latestAppliedTimestamp: string | null = null;

  const applyTx = db.transaction(() => {
    for (const row of rowsOrdered) {
      const entityType = normalizeEntityType(readRemoteTableName(row) || '');
      const rowCreatedAt = readRemoteTimestamp(row);
      if (!entityType || entityType === 'activity_logs') {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      const operation = readRemoteOperation(row);
      const recordId = readRemoteRecordId(row);
      if (!recordId) {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) latestAppliedTimestamp = rowCreatedAt;
        continue;
      }
      const remoteData = readRemoteData(row);
      const remoteVersion = readVersion(remoteData?.version, 1);
      const localMeta = getLocalRecordMetaForRemote(db, entityType, recordId, remoteData);
      const localVersion = localMeta.version;
      const remoteUpdatedAt = readRemoteUpdatedAt(row, remoteData);
      const remoteUpdatedMs = parseTimestamp(remoteUpdatedAt);
      const localUpdatedMs = parseTimestamp(localMeta.lastModified);

      if (localMeta.exists && remoteUpdatedMs != null && localUpdatedMs != null && remoteUpdatedMs <= localUpdatedMs) {
        remoteIdsToDelete.push(row.id);
        if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
          latestAppliedTimestamp = rowCreatedAt;
        }
        continue;
      }

      if (localVersion > remoteVersion && conflictStrategy === 'skip') {
        conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
        markEntityConflict(db, entityType, recordId);
        continue;
      }

      const resolvedVersion =
        localVersion > remoteVersion && conflictStrategy === 'remote_wins' ? localVersion + 1 : remoteVersion;

      const payload = {
        ...normalizeEmployeeSubmissionPayloadForAdmin(db, row, entityType, remoteData || {}),
        id: recordId,
        version: resolvedVersion
      };

      try {
        if (operation === 'delete') {
          const deleteRecordId =
            entityType === 'employees'
              ? resolveLocalEmployeeRecordIdForRemote(db, recordId, payload)
              : recordId;
          applyRemoteDelete(db, entityType, deleteRecordId, payload.deletedAt || rowCreatedAt || nowIso(), resolvedVersion);
        } else {
          applyRemoteUpsert(db, entityType, payload, resolvedVersion);
        }
      } catch (error: any) {
        const message = String(error?.message || '');
        if (message.toLowerCase().includes('foreign key constraint failed')) {
          conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
          logSyncEvent(db, {
            eventType: 'auto_pull_employee_submissions',
            message: `Deferred employee submission ${row.id} (${entityType}:${recordId}) due to missing local dependency.`
          });
          continue;
        }
        throw error;
      }

      remoteIdsToDelete.push(row.id);
      pulledCount += 1;
      if (!latestAppliedTimestamp || rowCreatedAt > latestAppliedTimestamp) {
        latestAppliedTimestamp = rowCreatedAt;
      }
    }
  });

  applyTx();

  if (remoteIdsToDelete.length) {
    await deleteRemoteQueueRowsWithRetry(getEmployeeQueueTable(), remoteIdsToDelete, currentDeviceId);
  }

  const syncedAt = nowIso();
  const currentState = readSyncState(db, actor);
  writeSyncState(db, actor, {
    last_successful_sync_at: syncedAt,
    last_auto_sync_at: syncedAt,
    device_registered_at: currentState.device_registered_at || syncedAt,
    full_sync_required: 0,
    full_sync_reason: null,
    last_status: conflicts.length ? 'conflict' : 'online',
    last_error: null
  });

  logSyncEvent(db, {
    eventType: 'auto_pull_employee_submissions',
    message: conflicts.length
      ? `System admin auto-pulled ${pulledCount} employee submission(s) with ${conflicts.length} conflict(s)`
      : `System admin auto-pulled ${pulledCount} employee submission(s)`,
    pulledCount,
    conflictCount: conflicts.length
  });

  return {
    status: conflicts.length ? ('conflict' as const) : ('synced' as const),
    pulledCount,
    conflictCount: conflicts.length,
    conflicts
  };
};

export async function pullRemoteChanges(actor: SyncActor, conflictStrategy: ConflictStrategy = 'skip') {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    const state = markFullSyncRequired(db, actor, readSyncState(db, actor));

    const permissionError = getSyncPermissionError(actor);
    if (permissionError) {
      return {
        status: 'forbidden',
        pulledCount: 0,
        conflictCount: 0,
        conflicts: [] as ConflictRecord[],
        error: permissionError
      };
    }

    const fullSyncReason = getFullSyncRequiredReason(state);
    if (fullSyncReason) {
      writeSyncState(db, actor, {
        full_sync_required: 1,
        full_sync_reason: fullSyncReason,
        last_status: 'full_sync_required',
        last_error: fullSyncReason
      });
      return {
        status: 'full_sync_required',
        pulledCount: 0,
        conflictCount: 0,
        conflicts: [] as ConflictRecord[],
        error: fullSyncReason
      };
    }

    if (!state.online_mode) {
      return {
        status: 'offline',
        pulledCount: 0,
        conflictCount: 0,
        conflicts: [] as ConflictRecord[],
        error: 'Sync is offline. Enable Online mode to pull changes.'
      };
    }

    if (!isConfigured()) {
      const message = 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      return {
        status: 'error',
        pulledCount: 0,
        conflictCount: 0,
        conflicts: [] as ConflictRecord[],
        error: message
      };
    }

    try {
      await cleanupQueueRetention(actor);
      const currentDeviceId = getLocalDeviceId(db);
      const result = canAdminSync(actor)
        ? await pullAdminChanges(db, actor, state, conflictStrategy, currentDeviceId)
        : await pullEmployeeAssignedChanges(db, actor, state, conflictStrategy, currentDeviceId);
      let profileImageResult: { pulled: number; skipped: number } = { pulled: 0, skipped: 0 };

      if (result.status === 'synced' || result.status === 'idle' || result.status === 'conflict') {
        profileImageResult = await pullProfileImageRelayChanges(db, actor, currentDeviceId);
        if (profileImageResult.pulled > 0) {
          logSyncEvent(db, {
            eventType: 'pull',
            message: `${actor.role} pulled ${profileImageResult.pulled} profile image update(s).`
          });
        }
        await touchActorPresence(db, actor);
        const relayUsage = await fetchRelayUsageStats();
        if (relayUsage) {
          persistRelayUsageSnapshot(db, actor, relayUsage, readSyncState(db, actor).last_warning);
        }
      }

      return {
        ...result,
        profileImagePulled: profileImageResult.pulled,
        profileImageSkipped: profileImageResult.skipped
      };
    } catch (error: any) {
      const message = error?.message ?? 'Pull failed';
      let profileImageResult: { pulled: number; skipped: number } = { pulled: 0, skipped: 0 };
      try {
        const currentDeviceId = getLocalDeviceId(db);
        profileImageResult = await pullProfileImageRelayChanges(db, actor, currentDeviceId);
      } catch {
        // Best effort only: keep original pull error if profile relay pull also fails.
      }
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'pull', message: `Pull failed: ${message}` });

      return {
        status: 'error',
        pulledCount: 0,
        conflictCount: 0,
        conflicts: [] as ConflictRecord[],
        error: message,
        profileImagePulled: profileImageResult.pulled,
        profileImageSkipped: profileImageResult.skipped
      };
    }
  });
}

export async function autoPullEmployeeSubmissions(actor: SyncActor) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    const state = markFullSyncRequired(db, actor, readSyncState(db, actor));

    if (!canAdminSync(actor)) {
      return { status: 'forbidden', pulledCount: 0, error: 'Only system admin accounts can pull employee submissions.' };
    }

    const fullSyncReason = getFullSyncRequiredReason(state);
    if (fullSyncReason) {
      writeSyncState(db, actor, {
        full_sync_required: 1,
        full_sync_reason: fullSyncReason,
        last_status: 'full_sync_required',
        last_error: fullSyncReason
      });
      return { status: 'full_sync_required', pulledCount: 0, error: fullSyncReason };
    }

    if (!state.online_mode) {
      return { status: 'offline', pulledCount: 0, error: 'Sync is offline. Enable Online mode to pull employee submissions.' };
    }

    if (!isConfigured()) {
      const message = 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      return { status: 'error', pulledCount: 0, error: message };
    }

    try {
      await cleanupQueueRetention(actor);
      const currentDeviceId = getLocalDeviceId(db);
      const result = await pullEmployeeSubmissionsForAdmin(db, actor, 'skip', currentDeviceId);
      let profileImageResult: { pulled: number; skipped: number } = { pulled: 0, skipped: 0 };
      if (result.status === 'synced' || result.status === 'idle' || result.status === 'conflict') {
        profileImageResult = await pullProfileImageRelayChanges(db, actor, currentDeviceId);
        if (profileImageResult.pulled > 0) {
          logSyncEvent(db, {
            eventType: 'auto_pull_employee_submissions',
            message: `System admin pulled ${profileImageResult.pulled} employee profile image update(s).`
          });
        }
        await touchActorPresence(db, actor);
        const relayUsage = await fetchRelayUsageStats();
        if (relayUsage) {
          persistRelayUsageSnapshot(db, actor, relayUsage, readSyncState(db, actor).last_warning);
        }
      }
      return {
        ...result,
        profileImagePulled: profileImageResult.pulled,
        profileImageSkipped: profileImageResult.skipped
      };
    } catch (error: any) {
      const message = error?.message ?? 'Failed to auto pull employee submissions.';
      let profileImageResult: { pulled: number; skipped: number } = { pulled: 0, skipped: 0 };
      try {
        const currentDeviceId = getLocalDeviceId(db);
        profileImageResult = await pullProfileImageRelayChanges(db, actor, currentDeviceId);
      } catch {
        // Best effort only: keep original pull error if profile relay pull also fails.
      }
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'auto_pull_employee_submissions', message: `Auto pull failed: ${message}` });
      return {
        status: 'error',
        pulledCount: 0,
        error: message,
        profileImagePulled: profileImageResult.pulled,
        profileImageSkipped: profileImageResult.skipped
      };
    }
  });
}

export async function syncNow(actor: SyncActor) {
  return pushLocalChanges(actor);
}

export async function checkPendingFullSyncRequest(actor: SyncActor) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();

    if (!canAdminSync(actor)) {
      return { status: 'forbidden', error: 'Only system admin accounts can check full sync requests.' };
    }

    if (!isConfigured()) {
      return {
        status: 'error',
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    try {
      const deviceId = getLocalDeviceId(db);
      const request = await fetchPendingFullSyncRequestForTargetDevice(deviceId);
      if (!request) {
        return { status: 'none', request: null };
      }

      return {
        status: 'pending',
        request: summarizeFullSyncRequest(request)
      };
    } catch (error: any) {
      return { status: 'error', error: error?.message ?? 'Failed to check full sync request.' };
    }
  });
}

export async function requestFullSync(actor: SyncActor) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    const state = markFullSyncRequired(db, actor, readSyncState(db, actor));

    if (!canRequestFullSync(actor)) {
      return { status: 'forbidden', error: 'Only system admin accounts can request full sync.' };
    }

    if (!state.online_mode) {
      return { status: 'offline', error: 'Sync is offline. Enable Online mode before requesting full sync.' };
    }

    if (!isConfigured()) {
      return {
        status: 'error',
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    const deviceId = getLocalDeviceId(db);
    const fullSyncReason = getFullSyncRequiredReason(state) || 'Manual full sync request was submitted.';

    try {
      const existing = await fetchLatestActiveFullSyncRequestForDevice(deviceId);
      if (existing) {
        return {
          status: 'exists',
          request: summarizeFullSyncRequest(existing)
        };
      }

      const eligibilityError = getManualFullSyncBlockReason(state);
      if (eligibilityError) {
        writeSyncState(db, actor, {
          last_status: 'full_sync_not_allowed',
          last_error: eligibilityError
        });
        return { status: 'not_allowed', error: eligibilityError };
      }

      const estimatedDbSizeBytes = getLocalDbSizeBytes(db);
      const estimatedRecords = getLocalInventoryRecordCount(db);
      const requestedAt = nowIso();
      const request = await createFullSyncRequest({
        requesting_device_id: deviceId,
        target_device_id: deviceId,
        requested_by: actor.userId,
        estimated_records: estimatedRecords,
        estimated_size_mb: Number((estimatedDbSizeBytes / 1024 / 1024).toFixed(3)),
        created_at: requestedAt,
        requester_device_id: deviceId,
        requester_user_id: actor.userId,
        requested_at: requestedAt,
        status: 'pending',
        last_successful_sync_at: getLastSuccessfulSyncAt(state),
        estimated_db_size_bytes: estimatedDbSizeBytes
      });

      writeSyncState(db, actor, {
        full_sync_required: 1,
        full_sync_reason: fullSyncReason,
        last_status: 'full_sync_pending',
        last_error: fullSyncReason
      });

      logSyncEvent(db, {
        eventType: 'full_sync_request',
        message: `${actor.role} requested full sync (${request.id}) and is waiting for master approval.`
      });

      return {
        status: 'requested',
        request: summarizeFullSyncRequest(request)
      };
    } catch (error: any) {
      const message = error?.message ?? 'Failed to create full sync request.';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      return { status: 'error', error: message };
    }
  });
}

export async function getFullSyncSession(actor: SyncActor) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    if (!isConfigured()) {
      return {
        status: 'error',
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    try {
      const deviceId = getLocalDeviceId(db);
      const request = await fetchLatestFullSyncRequestForDevice(deviceId);
      if (!request) {
        return { status: 'idle', request: null, nextChunk: null };
      }

      const chunks =
        request.status === 'approved' || request.status === 'transferring' || request.status === 'completed'
          ? await fetchFullSyncChunks(request.id)
          : [];
      const nextChunk = chunks.find((chunk) => chunk.status === 'uploaded') || null;

      return {
        status: 'ok',
        request: summarizeFullSyncRequest(request, chunks),
        nextChunk: nextChunk
          ? {
              chunkId: nextChunk.id,
              chunkIndex: nextChunk.chunk_index,
              chunkSizeBytes: nextChunk.chunk_size_bytes,
              checksumSha256: nextChunk.checksum_sha256
            }
          : null
      };
    } catch (error: any) {
      return {
        status: 'error',
        error: error?.message ?? 'Failed to load full sync session.'
      };
    }
  });
}

export async function listFullSyncRequests(actor: SyncActor) {
  return withActorToken(actor, async () => {
    if (!canAdminSync(actor)) {
      return { status: 'forbidden', requests: [] as any[], error: 'Only system admin accounts can manage full sync requests.' };
    }

    if (!isConfigured()) {
      return {
        status: 'error',
        requests: [] as any[],
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    try {
      const requests = await fetchFullSyncRequests((params) => {
        params.set('status', 'in.(pending,approved,transferring)');
        params.set('order', 'requested_at.desc');
        params.set('limit', '50');
      });

      const requestSummaries = await Promise.all(
        requests.map(async (request) => {
          const chunks = await fetchFullSyncChunks(request.id);
          return summarizeFullSyncRequest(request, chunks);
        })
      );

      return {
        status: 'ok',
        requests: requestSummaries
      };
    } catch (error: any) {
      return { status: 'error', requests: [] as any[], error: error?.message ?? 'Failed to list full sync requests.' };
    }
  });
}

export async function reviewFullSyncRequest(
  actor: SyncActor,
  requestId: string,
  decision: 'approve' | 'reject',
  reason?: string
) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();

    if (!canAdminSync(actor)) {
      return { status: 'forbidden', error: 'Only system admin accounts can approve/reject full sync requests.' };
    }

    if (!isConfigured()) {
      return {
        status: 'error',
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    try {
      const request = await fetchFullSyncRequestById(requestId);
      if (!request) {
        return { status: 'not_found', error: 'Full sync request was not found.' };
      }

      let updated: FullSyncRequestRow;
      if (decision === 'approve') {
        updated = await patchFullSyncRequest(requestId, {
          status: 'approved',
          approved_at: nowIso(),
          approved_by_user_id: actor.userId,
          rejected_at: null,
          rejected_by_user_id: null,
          rejection_reason: null
        });

        cleanupMasterChunkCache(requestId);
        logSyncEvent(db, {
          eventType: 'full_sync_review',
          message: `System admin approved full sync request ${requestId}.`
        });
      } else {
        updated = await patchFullSyncRequest(requestId, {
          status: 'rejected',
          rejected_at: nowIso(),
          rejected_by_user_id: actor.userId,
          rejection_reason: reason || 'Rejected by master device'
        });

        logSyncEvent(db, {
          eventType: 'full_sync_review',
          message: `System admin rejected full sync request ${requestId}.`
        });
      }

      return {
        status: decision === 'approve' ? 'approved' : 'rejected',
        request: summarizeFullSyncRequest(updated)
      };
    } catch (error: any) {
      return { status: 'error', error: error?.message ?? 'Failed to review full sync request.' };
    }
  });
}

export async function uploadNextFullSyncChunk(actor: SyncActor, requestId: string) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();

    if (!canAdminSync(actor)) {
      return { status: 'forbidden', error: 'Only system admin accounts can upload full sync chunks.' };
    }

    if (!isConfigured()) {
      return {
        status: 'error',
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    try {
      const request = await fetchFullSyncRequestById(requestId);
      if (!request) {
        return { status: 'not_found', error: 'Full sync request was not found.' };
      }

      if (!(request.status === 'approved' || request.status === 'transferring')) {
        return { status: 'invalid_state', error: `Request is in ${request.status} state.` };
      }

      const chunksBefore = await fetchFullSyncChunks(requestId);
      const pendingUploaded = chunksBefore.find((chunk) => chunk.status === 'uploaded');
      if (pendingUploaded) {
        return {
          status: 'waiting_for_ack',
          request: summarizeFullSyncRequest(request, chunksBefore),
          nextChunkIndex: pendingUploaded.chunk_index
        };
      }

      const chunksToCleanup = chunksBefore.filter((chunk) => chunk.status === 'acked' && !chunk.storage_deleted_at);
      for (const chunk of chunksToCleanup) {
        try {
          await deleteStorageObject(chunk.storage_object);
        } catch {
          // Ignore missing-object cleanup errors so transfer can continue.
        }
        await patchFullSyncChunk(chunk.id, { status: 'deleted', storage_deleted_at: nowIso() });
      }

      const manifest = buildMasterChunkManifest(db, requestId);
      const chunksAfterCleanup = await fetchFullSyncChunks(requestId);
      const uploadedIndexSet = new Set<number>(
        chunksAfterCleanup
          .filter((chunk) => chunk.status === 'uploaded' || chunk.status === 'acked' || chunk.status === 'deleted')
          .map((chunk) => chunk.chunk_index)
      );
      const next = manifest.chunks.find((chunk) => !uploadedIndexSet.has(chunk.chunkIndex));

      await patchFullSyncRequest(requestId, {
        status: 'transferring',
        total_chunks: manifest.totalChunks,
        manifest_checksum: manifest.manifestChecksum,
        started_at: request.started_at || nowIso()
      });

      if (!next) {
        const refreshedRequest = (await fetchFullSyncRequestById(requestId)) || request;
        return {
          status: 'awaiting_finalize',
          request: summarizeFullSyncRequest(refreshedRequest, chunksAfterCleanup)
        };
      }

      const buffer = readMasterChunkData(requestId, next.fileName);
      if (buffer.length > FULL_SYNC_CHUNK_SIZE_BYTES) {
        throw new Error(`Chunk ${next.chunkIndex} exceeds the ${FULL_SYNC_CHUNK_MB}MB limit.`);
      }

      await uploadStorageObject(next.storageObject, buffer);
      await upsertFullSyncChunk({
        request_id: requestId,
        chunk_index: next.chunkIndex,
        chunk_size_bytes: next.chunkSizeBytes,
        checksum_sha256: next.checksumSha256,
        storage_object: next.storageObject,
        status: 'uploaded',
        uploaded_at: nowIso(),
        acked_at: null,
        acked_by_device_id: null,
        storage_deleted_at: null
      });

      const requestAfterUpload = (await fetchFullSyncRequestById(requestId)) || request;
      const chunksAfterUpload = await fetchFullSyncChunks(requestId);
      return {
        status: 'uploaded',
        request: summarizeFullSyncRequest(requestAfterUpload, chunksAfterUpload),
        uploadedChunk: {
          chunkIndex: next.chunkIndex,
          chunkSizeBytes: next.chunkSizeBytes,
          checksumSha256: next.checksumSha256
        }
      };
    } catch (error: any) {
      const message = error?.message ?? 'Failed to upload full sync chunk.';
      logSyncEvent(db, { eventType: 'full_sync_upload', message: `Full sync chunk upload failed: ${message}` });
      return { status: 'error', error: message };
    }
  });
}

export async function pullNextFullSyncChunk(actor: SyncActor) {
  return withActorToken(actor, async () => {
    const db = dataStore.getDb();
    const state = readSyncState(db, actor);

    if (!canRequestFullSync(actor)) {
      return { status: 'forbidden', error: 'Only system admin accounts can pull full sync chunks.' };
    }

    if (!state.online_mode) {
      return { status: 'offline', error: 'Sync is offline. Enable Online mode to pull full sync chunks.' };
    }

    if (!isConfigured()) {
      return {
        status: 'error',
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    try {
      const deviceId = getLocalDeviceId(db);
      const request = await fetchLatestActiveFullSyncRequestForDevice(deviceId);
      if (!request) {
        const eligibilityError = getManualFullSyncBlockReason(state);
        if (eligibilityError) {
          return { status: 'not_allowed', error: eligibilityError };
        }
        return { status: 'idle', error: 'No active full sync request for this device.' };
      }

      if (request.status === 'pending') {
        return { status: 'pending', request: summarizeFullSyncRequest(request), error: 'Waiting for master approval.' };
      }

      if (!(request.status === 'approved' || request.status === 'transferring')) {
        return {
          status: 'invalid_state',
          request: summarizeFullSyncRequest(request),
          error: `Request is in ${request.status} state.`
        };
      }

      const chunks = await fetchFullSyncChunks(request.id);
      const nextChunk = chunks.find((chunk) => chunk.status === 'uploaded');
      if (!nextChunk) {
        return {
          status: 'waiting_chunk',
          request: summarizeFullSyncRequest(request, chunks),
          error: 'Waiting for next chunk from master.'
        };
      }

      const payload = await downloadStorageObject(nextChunk.storage_object);
      if (payload.length !== nextChunk.chunk_size_bytes) {
        await patchFullSyncChunk(nextChunk.id, { status: 'failed' });
        throw new Error(
          `Chunk ${nextChunk.chunk_index} size mismatch. Expected ${nextChunk.chunk_size_bytes}, got ${payload.length}.`
        );
      }

      const digest = sha256Hex(payload);
      if (digest !== nextChunk.checksum_sha256) {
        await patchFullSyncChunk(nextChunk.id, { status: 'failed' });
        throw new Error(`Chunk ${nextChunk.chunk_index} checksum mismatch. Re-upload required.`);
      }

      const requesterDir = getFullSyncRequesterDir(request.id);
      ensureDir(requesterDir);
      const chunkFile = path.join(requesterDir, `chunk_${String(nextChunk.chunk_index).padStart(6, '0')}.bin`);
      fs.writeFileSync(chunkFile, payload);

      await patchFullSyncChunk(nextChunk.id, {
        status: 'acked',
        acked_at: nowIso(),
        acked_by_device_id: deviceId
      });

      try {
        await deleteStorageObject(nextChunk.storage_object);
        await patchFullSyncChunk(nextChunk.id, {
          status: 'deleted',
          storage_deleted_at: nowIso()
        });
      } catch {
        // If requester cannot delete object, master-side upload flow will clean it before next upload.
      }

      const chunksAfterAck = await fetchFullSyncChunks(request.id);
      const requestAfterAck = await fetchFullSyncRequestById(request.id);
      const ackedCount = chunksAfterAck.filter((chunk) => chunk.status === 'acked' || chunk.status === 'deleted').length;
      const totalChunks = requestAfterAck?.total_chunks ?? request.total_chunks ?? null;

      if (totalChunks && ackedCount >= totalChunks) {
        const backupPath = backupLocalInventorySnapshot(db);
        const dataset = readRequesterDataset(request.id);
        rebuildLocalInventoryFromDataset(db, dataset);
        clearRequesterChunkDir(request.id);

        await patchFullSyncRequest(request.id, {
          status: 'completed',
          completed_at: nowIso(),
          completed_by_device_id: deviceId
        });

        const syncedAt = nowIso();
        writeSyncState(db, actor, {
          full_sync_required: 0,
          full_sync_reason: null,
          last_successful_sync_at: syncedAt,
          last_pull_at: syncedAt,
          last_auto_sync_at: syncedAt,
          last_full_sync_at: syncedAt,
          device_registered_at: syncedAt,
          last_status: 'online',
          last_error: null
        });

        logSyncEvent(db, {
          eventType: 'full_sync_apply',
          message: `Full sync completed from request ${request.id}. Inventory rebuilt from ${totalChunks} chunk(s).`
        });

        const completedRequest = (await fetchFullSyncRequestById(request.id)) || request;
        return {
          status: 'completed',
          request: summarizeFullSyncRequest(completedRequest, chunksAfterAck),
          backupPath,
          pulledChunkIndex: nextChunk.chunk_index
        };
      }

      await patchFullSyncRequest(request.id, { status: 'transferring', started_at: request.started_at || nowIso() });
      const transferringRequest = (await fetchFullSyncRequestById(request.id)) || request;

      return {
        status: 'pulled',
        request: summarizeFullSyncRequest(transferringRequest, chunksAfterAck),
        pulledChunkIndex: nextChunk.chunk_index
      };
    } catch (error: any) {
      const message = error?.message ?? 'Failed to pull next full sync chunk.';
      return { status: 'error', error: message };
    }
  });
}
