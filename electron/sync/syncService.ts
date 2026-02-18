import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createHash, randomUUID } from 'crypto';
import { app } from 'electron';
import { dataStore } from '../db';
import { authService } from '../auth/authService';

const nowIso = (): string => new Date().toISOString();

const MAX_EVENT_LOG_ITEMS = 10;
const MAX_STORED_EVENTS = 200;
const SYNC_QUEUE_RETENTION_DAYS = Math.max(1, Number(process.env.SYNC_QUEUE_RETENTION_DAYS || 7));
const SYNC_MAX_OFFLINE_DAYS = Math.max(1, Number(process.env.SYNC_MAX_OFFLINE_DAYS || 7));
const SYNC_DELETE_RETRY_ATTEMPTS = Math.max(1, Number(process.env.SYNC_DELETE_RETRY_ATTEMPTS || 3));
const SYNC_PUSH_MAX_BATCH_MB = Math.max(1, Number(process.env.SYNC_PUSH_MAX_BATCH_MB || 5));
const SYNC_PUSH_MAX_BATCH_BYTES = SYNC_PUSH_MAX_BATCH_MB * 1024 * 1024;
const FULL_SYNC_CHUNK_MB = Math.min(200, Math.max(1, Number(process.env.SYNC_FULL_CHUNK_MB || 200)));
const FULL_SYNC_CHUNK_SIZE_BYTES = FULL_SYNC_CHUNK_MB * 1024 * 1024;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const getAdminQueueTable = (): string =>
  process.env.SUPABASE_ADMIN_QUEUE_TABLE || process.env.SUPABASE_SYNC_QUEUE_TABLE || 'admin_sync_queue';
const getEmployeeQueueTable = (): string => process.env.SUPABASE_EMPLOYEE_QUEUE_TABLE || 'employee_sync_queue';
const getAppUsersTable = (): string => process.env.SUPABASE_APP_USERS_TABLE || 'app_users';
const getSupabaseUrl = (): string => (process.env.SUPABASE_URL || '').replace(/\/+$/u, '');
const getSupabaseAnonKey = (): string => process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const getPushBatchSize = (): number => Math.max(1, Number(process.env.SYNC_PUSH_BATCH_SIZE || 100));
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
  table_name?: string;
  operation?: string;
  record_id?: string;
  data?: any;
  timestamp?: string;
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
  return entityType === 'returns' || entityType === 'products';
};

const getPushableEntityTypes = (actor: SyncActor): Set<string> => {
  if (canAdminSync(actor)) return new Set(['employees', 'products', 'returns']);
  if (actor.role === 'employee') return new Set(['products', 'returns']);
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

let syncSchemaEnsured = false;

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

  syncSchemaEnsured = true;
};

const getLocalDeviceId = (db: Database.Database): string => {
  ensureSyncSchema(db);
  const existing = db.prepare('SELECT device_id FROM sync_device WHERE id = 1').get() as { device_id?: string } | undefined;
  if (existing?.device_id) return existing.device_id;

  const next = randomUUID();
  const now = nowIso();
  db.prepare('INSERT OR REPLACE INTO sync_device (id, device_id, created_at, updated_at) VALUES (1, ?, ?, ?)').run(next, now, now);
  return next;
};

const ensureSyncStateRow = (db: Database.Database, actor: SyncActor): void => {
  ensureSyncSchema(db);
  db.prepare(
    `
      INSERT OR IGNORE INTO sync_state (
        id, online_mode, last_push_at, last_pull_at, last_successful_sync_at, last_push_count, last_pull_count,
        last_conflict_count, full_sync_required, full_sync_reason, last_status, last_error, updated_at
      ) VALUES (
        @id, @online_mode, @last_push_at, @last_pull_at, @last_successful_sync_at, @last_push_count, @last_pull_count,
        @last_conflict_count, @full_sync_required, @full_sync_reason, @last_status, @last_error, @updated_at
      )
    `
  ).run({
    id: stateIdForActor(actor),
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
    updated_at: nowIso()
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

  const lastPullMs = parseTimestamp(state.last_pull_at);
  if (lastPullMs !== null && lastPullMs <= getOfflineCutoffMs()) {
    return buildStalePullMessage(state.last_pull_at);
  }

  const lastSuccessfulSyncAt = getLastSuccessfulSyncAt(state);
  if (!lastSuccessfulSyncAt) return null;
  const lastSuccessfulMs = parseTimestamp(lastSuccessfulSyncAt);
  if (lastSuccessfulMs === null) return null;
  if (lastSuccessfulMs > getOfflineCutoffMs()) return null;

  return buildFullSyncRequiredMessage(lastSuccessfulSyncAt);
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

  return pendingRows.reduce((count, row) => (pushableEntityTypes.has(row.entity_type) ? count + 1 : count), 0);
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
  const recommendedBatchCount = totalBytes === 0 ? 0 : Math.max(1, Math.ceil(totalBytes / SYNC_PUSH_MAX_BATCH_BYTES));

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

const getLocalVersion = (db: Database.Database, entityType: string, recordId: string): number => {
  const table = entityToTable[entityType];
  if (!table) return 0;
  const row = db.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(recordId) as { version?: number } | undefined;
  return readVersion(row?.version, 0);
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

const fetchActorAppUserRow = async (supabaseUserId: string): Promise<{ role: string; account_status: string } | null> => {
  const params = new URLSearchParams();
  params.set('select', 'user_id,role,account_status');
  params.set('user_id', `eq.${supabaseUserId}`);
  params.set('limit', '1');
  const response = await supabaseRequest(`${getAppUsersTable()}?${params.toString()}`, { method: 'GET' });
  const rows = (await response.json()) as Array<{ role?: string | null; account_status?: string | null }>;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] || {};
  return {
    role: String(row.role || ''),
    account_status: String(row.account_status || 'active')
  };
};

const ensureActorQueuePermission = async (actor: SyncActor, supabaseUserId: string): Promise<string | null> => {
  const appUser = await fetchActorAppUserRow(supabaseUserId);
  if (!appUser) {
    return `Supabase app user profile is missing for this account (${supabaseUserId}). Insert/update ${getAppUsersTable()} with an active ${actor.role} role, then retry push.`;
  }

  const remoteRole = normalizeActorRole(appUser.role);
  const remoteStatus = normalizeActorStatus(appUser.account_status);
  if (remoteStatus !== 'active') {
    return 'Supabase app user is inactive. Activate account_status in app_users before pushing.';
  }

  if (canAdminSync(actor) && remoteRole !== 'system_admin') {
    return `Push denied: authenticated Supabase role is "${remoteRole || 'unknown'}", expected "system_admin".`;
  }
  if (!canAdminSync(actor) && remoteRole !== 'employee') {
    return `Push denied: authenticated Supabase role is "${remoteRole || 'unknown'}", expected "employee".`;
  }
  return null;
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
  await supabaseRequest(tableName, {
    method: 'POST',
    body: JSON.stringify(records)
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
  params.set(
    'select',
    'id,employee_id,origin_device_id,origin_user_id,payload,payload_size_kb,created_at,table_name,operation,record_id,data,timestamp'
  );
  params.set('order', 'created_at.asc,id.asc');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (sinceTimestamp) {
    params.set('created_at', `gt.${sinceTimestamp}`);
  }
  if (employeeId === EMPLOYEE_ID_NULL_FILTER) {
    params.set('employee_id', 'is.null');
  } else if (employeeId) {
    params.set('employee_id', `eq.${employeeId}`);
  }
  if (excludeOriginDeviceId) {
    params.set('or', `(origin_device_id.is.null,origin_device_id.neq.${excludeOriginDeviceId})`);
  }

  const response = await supabaseRequest(`${tableName}?${params.toString()}`, {
    method: 'GET'
  });

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
  if (row.timestamp) return row.timestamp;
  return nowIso();
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

const deleteQueueRowsOlderThan = async (tableName: string, cutoffIso: string): Promise<void> => {
  const params = new URLSearchParams();
  params.set('created_at', `lt.${cutoffIso}`);
  await supabaseRequest(`${tableName}?${params.toString()}`, { method: 'DELETE' });
};

const cleanupQueueRetention = async (actor: SyncActor): Promise<void> => {
  if (!canAdminSync(actor)) return;

  const cutoffIso = getQueueRetentionCutoffIso();
  await deleteQueueRowsOlderThan(getAdminQueueTable(), cutoffIso);
  await deleteQueueRowsOlderThan(getEmployeeQueueTable(), cutoffIso);
};

const getLocalDbSizeBytes = (db: Database.Database): number => {
  const pageCountRow = db.prepare('PRAGMA page_count').get() as { page_count?: number };
  const pageSizeRow = db.prepare('PRAGMA page_size').get() as { page_size?: number };
  const pageCount = Number(pageCountRow?.page_count || 0);
  const pageSize = Number(pageSizeRow?.page_size || 0);
  return pageCount * pageSize;
};

const readInventorySnapshot = (db: Database.Database) => {
  const employees = db.prepare('SELECT * FROM employees WHERE deleted_at IS NULL ORDER BY created_at ASC').all();
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
    'id,requester_device_id,requester_user_id,requested_at,status,last_successful_sync_at,estimated_db_size_bytes,approved_at,approved_by_user_id,rejected_at,rejected_by_user_id,rejection_reason,total_chunks,manifest_checksum,started_at,completed_at,completed_by_device_id,updated_at'
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

const fetchLatestActiveFullSyncRequestForDevice = async (deviceId: string): Promise<FullSyncRequestRow | null> => {
  const rows = await fetchFullSyncRequests((params) => {
    params.set('requester_device_id', `eq.${deviceId}`);
    params.set('status', 'in.(pending,approved,transferring)');
    params.set('order', 'requested_at.desc');
    params.set('limit', '1');
  });
  return rows[0] || null;
};

const fetchLatestFullSyncRequestForDevice = async (deviceId: string): Promise<FullSyncRequestRow | null> => {
  const rows = await fetchFullSyncRequests((params) => {
    params.set('requester_device_id', `eq.${deviceId}`);
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
          id, full_name, email, phone, department, role, status, password_hash, password_salt,
          supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
          last_verified_at, verification_expires_at, hashed_session_token,
          created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
          sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
        ) VALUES (
          @id, @full_name, @email, @phone, @department, @role, @status, @password_hash, @password_salt,
          @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
          @last_verified_at, @verification_expires_at, @hashed_session_token,
          @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
          'synced', 0, @last_modified, @last_synced_at, NULL, @version
        )
      `
    );

    for (const row of employees) {
      insertEmployee.run({
        id: row.id,
        full_name: row.full_name ?? row.fullName ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        department: row.department ?? '',
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
  return {
    requestId: request.id,
    requesterDeviceId: request.requester_device_id,
    requesterUserId: request.requester_user_id,
    requestedAt: request.requested_at,
    status: request.status,
    lastSuccessfulSyncAt: request.last_successful_sync_at,
    estimatedDbSizeBytes: request.estimated_db_size_bytes,
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
  const now = nowIso();
  db.prepare(
    `
      INSERT INTO employees (
        id, full_name, email, phone, department, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @full_name, @email, @phone, @department, @role, @status, @password_hash, @password_salt,
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
      ON CONFLICT(id) DO UPDATE SET
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        department = excluded.department,
        role = excluded.role,
        status = excluded.status,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
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
    id: payload.id,
    full_name: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    department: payload.department,
    role: payload.role,
    status: payload.status,
    password_hash: payload.passwordHash,
    password_salt: payload.passwordSalt,
    supabase_user_id: payload.supabaseUserId ?? null,
    auth_sync_status: payload.authSyncStatus ?? null,
    auth_last_error: null,
    pending_password_enc: null,
    provisioned_at: payload.provisionedAt ?? null,
    last_verified_at: null,
    verification_expires_at: null,
    hashed_session_token: null,
    created_at: payload.createdAt ?? now,
    location: payload.location ?? '',
    two_factor_enabled: toBoolInt(payload.twoFactorEnabled),
    email_notifications: toBoolInt(payload.emailNotifications),
    low_stock_alerts: toBoolInt(payload.lowStockAlerts),
    language: payload.language ?? 'English',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: payload.lastModified ?? now,
    last_synced_at: now,
    deleted_at: payload.deletedAt ?? null,
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
    rrsp_number: payload.rrspNumber,
    product_id: payload.productId,
    return_date: payload.returnDate,
    quantity: payload.quantity,
    condition: payload.condition,
    remarks: payload.remarks,
    returned_by_employee_id: payload.returnedByEmployeeId,
    returned_by_position: payload.returnedByPosition,
    received_date: payload.receivedDate,
    location: payload.location,
    created_at: payload.createdAt ?? now,
    status: payload.status,
    processed_by_employee_id: payload.processedByEmployeeId ?? null,
    processed_date: payload.processedDate ?? null,
    processing_notes: payload.processingNotes ?? null,
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: payload.lastModified ?? now,
    last_synced_at: now,
    deleted_at: payload.deletedAt ?? null,
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
        insertReceiver.run({
          return_id: payload.id,
          employee_id: entry.employeeId || payload.returnedByEmployeeId,
          receiver_name: entry.receiverName || '',
          position: entry.position,
          received_date: entry.receivedDate,
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
  const data = {
    ...payload,
    id: row.entity_id,
    version
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
const sanitizeQueueData = (input: any) => {
  if (!input || typeof input !== 'object') return input;
  const output = { ...input };
  delete output._meta;
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
  return output;
};

const buildEmployeeQueueRecords = (
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
  if (entry.entityType !== 'products') return [];

  const payload = entry.queueRecord.data || {};
  const currentAssigned = payload.assignedToEmployeeId ? String(payload.assignedToEmployeeId) : null;
  const previousAssigned = payload?._meta?.previousAssignedToEmployeeId
    ? String(payload._meta.previousAssignedToEmployeeId)
    : null;

  const recipients = new Set<string>();
  if (currentAssigned) recipients.add(currentAssigned);
  if (previousAssigned) recipients.add(previousAssigned);

  if (!recipients.size) return [];

  const data = sanitizeQueueData(payload);

  return Array.from(recipients).map((employeeId) => ({
    employee_id: employeeId,
    payload: {
      table_name: entry.entityType,
      operation: entry.queueRecord.operation,
      record_id: entry.entityId,
      data
    }
  }));
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

const buildRelayQueueRow = (
  payload: { table_name: string; operation: QueueOperation; record_id: string; data: any },
  originDeviceId: string,
  originUserId: string | null,
  employeeId: string | null
) => {
  const createdAt = nowIso();
  return {
    employee_id: employeeId,
    origin_device_id: originDeviceId,
    origin_user_id: originUserId,
    payload,
    payload_size_kb: sizeKbForJson(payload),
    created_at: createdAt,
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
  maxBytes: number
): Array<{ rows: T[]; bytes: number }> => {
  if (!records.length) return [];

  const batches: Array<{ rows: T[]; bytes: number }> = [];
  let currentRows: T[] = [];
  let currentBytes = 0;

  for (const row of records) {
    const rowBytes = Math.max(1, sizeBytesForJson(row));
    const rowExceeds = rowBytes > maxBytes;
    const wouldOverflow = currentRows.length > 0 && currentBytes + rowBytes > maxBytes;

    if (wouldOverflow) {
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
  lastSuccessfulSyncAt: getLastSuccessfulSyncAt(state),
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
    const prepared = filterPreparedEntriesByStage(pushablePrepared, stage, categoryByOutboxId);

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

    try {
      const permissionError = await ensureActorQueuePermission(actor, originUserId);
      if (permissionError) {
        writeSyncState(db, actor, { last_status: 'error', last_error: permissionError });
        logSyncEvent(db, { eventType: 'push', message: `Push blocked: ${permissionError}` });
        return { status: 'error', pushedCount: 0, error: permissionError };
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
          data: sanitizeQueueData(entry.queueRecord.data)
        }))
      : [];

    const targetedAdminPayloadRecords = canAdminSync(actor)
      ? prepared.flatMap((entry) => buildEmployeeQueueRecords(entry))
      : [];

    const employeePayloadRecords = !canAdminSync(actor)
      ? prepared.map((entry) => ({
          employee_id: actor.userId,
          payload: {
            table_name: entry.queueRecord.table_name,
            operation: entry.queueRecord.operation,
            record_id: entry.queueRecord.record_id,
            data: sanitizeQueueData(entry.queueRecord.data)
          }
        }))
      : [];

    const adminQueueRecords = adminPayloadRecords.map((payload) => buildRelayQueueRow(payload, originDeviceId, originUserId, null));
    const targetedAdminQueueRecords = targetedAdminPayloadRecords.map((item) =>
      buildRelayQueueRow(item.payload, originDeviceId, originUserId, item.employee_id || null)
    );
    const employeeQueueRecords = employeePayloadRecords.map((item) =>
      buildRelayQueueRow(item.payload, originDeviceId, originUserId, item.employee_id || null)
    );

    try {
      let uploadedBatchCount = 0;
      let uploadedBytes = 0;
      const pushBatches = async (tableName: string, records: Array<Record<string, unknown>>) => {
        const batches = chunkRecordsBySize(records, SYNC_PUSH_MAX_BATCH_BYTES);
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

      await pushBatches(getAdminQueueTable(), adminQueueRecords);
      await pushBatches(getAdminQueueTable(), targetedAdminQueueRecords);
      await pushBatches(getEmployeeQueueTable(), employeeQueueRecords);

      const syncedAt = nowIso();
      const tx = db.transaction(() => {
        for (const entry of prepared) {
          markEntitySynced(db, entry.entityType, entry.entityId, syncedAt);
          clearOutboxEntity(db, entry.entityType, entry.entityId);
        }

        writeSyncState(db, actor, {
          last_push_at: syncedAt,
          last_successful_sync_at: syncedAt,
          last_push_count: prepared.length,
          full_sync_required: 0,
          full_sync_reason: null,
          last_status: 'online',
          last_error: null
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
        const localVersion = getLocalVersion(db, entityType, readRemoteRecordId(row));
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
    writeSyncState(db, actor, {
      last_status: 'online',
      last_error: null,
      last_pull_count: 0,
      last_conflict_count: 0,
      last_successful_sync_at: nowIso(),
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
      const localVersion = getLocalVersion(db, entityType, recordId);

      if (localVersion > remoteVersion && conflictStrategy === 'skip') {
        conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
        markEntityConflict(db, entityType, recordId);
        continue;
      }

      const resolvedVersion =
        localVersion > remoteVersion && conflictStrategy === 'remote_wins' ? localVersion + 1 : remoteVersion;

      const payload = {
        ...(remoteData || {}),
        id: recordId,
        version: resolvedVersion
      };

      if (operation === 'delete') {
        applyRemoteDelete(db, entityType, recordId, payload.deletedAt || rowCreatedAt || nowIso(), resolvedVersion);
      } else {
        applyRemoteUpsert(db, entityType, payload, resolvedVersion);
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

  const updateTx = db.transaction(() => {
    writeSyncState(db, actor, {
      last_pull_at: shouldAdvanceCursor ? latestAppliedTimestamp : state.last_pull_at,
      last_successful_sync_at: nowIso(),
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
    writeSyncState(db, actor, {
      last_status: 'online',
      last_error: null,
      last_pull_count: 0,
      last_conflict_count: 0,
      last_successful_sync_at: nowIso(),
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
      if (entityType !== 'products') {
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
      const localVersion = getLocalVersion(db, entityType, recordId);

      if (localVersion > remoteVersion && conflictStrategy === 'skip') {
        conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
        markEntityConflict(db, entityType, recordId);
        continue;
      }

      const resolvedVersion =
        localVersion > remoteVersion && conflictStrategy === 'remote_wins' ? localVersion + 1 : remoteVersion;

      const payload = {
        ...(remoteData || {}),
        id: recordId,
        version: resolvedVersion
      };

      const assignedToEmployeeId = payload.assignedToEmployeeId ? String(payload.assignedToEmployeeId) : null;
      const shouldDeleteLocal =
        operation === 'delete' ||
        !assignedToEmployeeId ||
        assignedToEmployeeId !== actor.userId ||
        payload.assignmentStatus === 'returned';

      if (shouldDeleteLocal) {
        applyRemoteDelete(db, 'products', recordId, payload.deletedAt || rowCreatedAt || nowIso(), resolvedVersion);
      } else {
        applyRemoteProduct(db, payload, resolvedVersion);
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

  const updateTx = db.transaction(() => {
    writeSyncState(db, actor, {
      last_pull_at: shouldAdvanceCursor ? latestAppliedTimestamp : state.last_pull_at,
      last_successful_sync_at: nowIso(),
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
    return {
      status: 'idle' as const,
      pulledCount: 0,
      conflictCount: 0,
      conflicts: [] as ConflictRecord[]
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
      const localVersion = getLocalVersion(db, entityType, recordId);

      if (localVersion > remoteVersion && conflictStrategy === 'skip') {
        conflicts.push(createConflictRecord({ ...row, table_name: entityType, record_id: recordId }, entityType, localVersion, remoteVersion));
        markEntityConflict(db, entityType, recordId);
        continue;
      }

      const resolvedVersion =
        localVersion > remoteVersion && conflictStrategy === 'remote_wins' ? localVersion + 1 : remoteVersion;

      const payload = {
        ...(remoteData || {}),
        id: recordId,
        version: resolvedVersion
      };

      if (operation === 'delete') {
        applyRemoteDelete(db, entityType, recordId, payload.deletedAt || rowCreatedAt || nowIso(), resolvedVersion);
      } else {
        applyRemoteUpsert(db, entityType, payload, resolvedVersion);
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

  writeSyncState(db, actor, {
    last_successful_sync_at: nowIso(),
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

      if (canAdminSync(actor)) {
        return await pullAdminChanges(db, actor, state, conflictStrategy, currentDeviceId);
      }

      return await pullEmployeeAssignedChanges(db, actor, state, conflictStrategy, currentDeviceId);
    } catch (error: any) {
      const message = error?.message ?? 'Pull failed';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'pull', message: `Pull failed: ${message}` });

      return {
        status: 'error',
        pulledCount: 0,
        conflictCount: 0,
        conflicts: [] as ConflictRecord[],
        error: message
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
      return await pullEmployeeSubmissionsForAdmin(db, actor, 'remote_wins', currentDeviceId);
    } catch (error: any) {
      const message = error?.message ?? 'Failed to auto pull employee submissions.';
      writeSyncState(db, actor, { last_status: 'error', last_error: message });
      logSyncEvent(db, { eventType: 'auto_pull_employee_submissions', message: `Auto pull failed: ${message}` });
      return { status: 'error', pulledCount: 0, error: message };
    }
  });
}

export async function syncNow(actor: SyncActor) {
  return pushLocalChanges(actor);
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

      const request = await createFullSyncRequest({
        requester_device_id: deviceId,
        requester_user_id: actor.userId,
        requested_at: nowIso(),
        status: 'pending',
        last_successful_sync_at: getLastSuccessfulSyncAt(state),
        estimated_db_size_bytes: getLocalDbSizeBytes(db)
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
