import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type { ActivityLog, Employee, Product, ReturnRecord, ReturnReceiverEntry, SystemSettings } from '../shared/types';
import { runMigrations } from './migrate';
import { seedIfNeeded } from './seed';
import { importLegacyDump } from './migrateLegacy';
import { encryptLocalSecret } from '../auth/localSecrets';

export type DbChangePayload = { table: string; ids: string[] };

let dbInstance: Database.Database | null = null;
let coreSchemaEnsured = false;

const nowIso = (): string => new Date().toISOString();

const toInt = (value: boolean | number): number => (value ? 1 : 0);
const fromInt = (value: number): boolean => Boolean(value);

const getTableColumns = (db: Database.Database, tableName: string): Set<string> => {
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
    return new Set(rows.map((row) => String(row.name || '').trim()).filter(Boolean));
  } catch {
    return new Set<string>();
  }
};

const ensureTableColumn = (
  db: Database.Database,
  tableName: string,
  columns: Set<string>,
  columnName: string,
  definition: string
) => {
  if (!columns.size || columns.has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  columns.add(columnName);
};

const ensureCoreSchema = (db: Database.Database): void => {
  if (coreSchemaEnsured) return;

  const employeesColumns = getTableColumns(db, 'employees');
  ensureTableColumn(db, 'employees', employeesColumns, 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureTableColumn(db, 'employees', employeesColumns, 'supabase_user_id', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'auth_sync_status', "TEXT NOT NULL DEFAULT 'pending_upload'");
  ensureTableColumn(db, 'employees', employeesColumns, 'auth_last_error', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'pending_password_enc', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'provisioned_at', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'last_verified_at', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'verification_expires_at', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'hashed_session_token', 'TEXT');
  ensureTableColumn(db, 'employees', employeesColumns, 'supabase_refresh_token_enc', 'TEXT');

  db.exec(
    "UPDATE employees SET auth_sync_status = COALESCE(NULLIF(auth_sync_status, ''), 'pending_upload') WHERE 1 = 1"
  );
  db.exec(
    `
      UPDATE employees
      SET role = CASE
        WHEN lower(trim(role)) = 'admin' THEN 'system_admin'
        WHEN lower(trim(role)) = 'supervisor' THEN 'employee'
        ELSE role
      END
      WHERE role IS NOT NULL
    `
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_employees_auth_sync_status ON employees(auth_sync_status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_employees_supabase_user_id ON employees(supabase_user_id)');

  const productsColumns = getTableColumns(db, 'products');
  ensureTableColumn(db, 'products', productsColumns, 'version', 'INTEGER NOT NULL DEFAULT 1');
  ensureTableColumn(db, 'products', productsColumns, 'assigned_at', 'TEXT');
  ensureTableColumn(db, 'products', productsColumns, 'assignment_status', "TEXT NOT NULL DEFAULT 'returned'");

  if (productsColumns.has('assignment_status') && productsColumns.has('assigned_to_employee_id')) {
    db.exec(`
      UPDATE products
      SET
        assignment_status = CASE
          WHEN assigned_to_employee_id IS NULL OR assigned_to_employee_id = '' THEN 'returned'
          ELSE 'active'
        END,
        assigned_at = CASE
          WHEN assigned_to_employee_id IS NULL OR assigned_to_employee_id = '' THEN NULL
          WHEN assigned_at IS NULL OR assigned_at = '' THEN last_modified
          ELSE assigned_at
        END
      WHERE 1 = 1
    `);
  }

  const returnsColumns = getTableColumns(db, 'returns');
  ensureTableColumn(db, 'returns', returnsColumns, 'version', 'INTEGER NOT NULL DEFAULT 1');

  const activityColumns = getTableColumns(db, 'activity_logs');
  ensureTableColumn(db, 'activity_logs', activityColumns, 'version', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(
    "UPDATE activity_logs SET sync_status = 'local_only', is_dirty = 0, last_synced_at = COALESCE(last_synced_at, last_modified)"
  );

  db.exec('CREATE INDEX IF NOT EXISTS idx_products_assigned_status ON products(assigned_to_employee_id, assignment_status)');
  db.exec("DELETE FROM sync_outbox WHERE entity_type = 'activity_logs'");

  coreSchemaEnsured = true;
};

const ensureDb = (): Database.Database => {
  if (dbInstance) return dbInstance;
  const dbPath = path.join(app.getPath('userData'), 'bts-inventory.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  ensureCoreSchema(db);
  seedIfNeeded(db);
  dbInstance = db;
  return db;
};

const enqueueOutbox = (db: Database.Database, entityType: string, entityId: string, operation: string, payload: unknown) => {
  db.prepare(
    `
      INSERT INTO sync_outbox (
        entity_type, entity_id, operation, payload, created_at, attempts, last_error, next_retry_at
      ) VALUES (
        @entity_type, @entity_id, @operation, @payload, @created_at, @attempts, @last_error, @next_retry_at
      )
    `
  ).run({
    entity_type: entityType,
    entity_id: entityId,
    operation,
    payload: JSON.stringify(payload ?? {}),
    created_at: nowIso(),
    attempts: 0,
    last_error: null,
    next_retry_at: null
  });
};

const normalizeAuthSyncStatus = (value: unknown): 'pending_upload' | 'synced' | 'failed' | 'not_required' => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'pending_upload' ||
    normalized === 'synced' ||
    normalized === 'failed' ||
    normalized === 'not_required'
  ) {
    return normalized;
  }
  return 'pending_upload';
};

const mapEmployeeOutboxPayload = (employee: Employee) => {
  const {
    pendingPasswordPlain,
    pendingPasswordEncrypted,
    hashedSessionToken,
    authLastError,
    lastVerifiedAt,
    verificationExpiresAt,
    ...rest
  } = employee;
  void pendingPasswordPlain;
  void pendingPasswordEncrypted;
  void hashedSessionToken;
  void authLastError;
  void lastVerifiedAt;
  void verificationExpiresAt;
  return rest;
};

const mapEmployee = (row: any): Employee => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  department: row.department,
  role: row.role,
  status: row.status,
  passwordHash: row.password_hash,
  passwordSalt: row.password_salt,
  supabaseUserId: row.supabase_user_id ?? undefined,
  authSyncStatus: row.auth_sync_status ?? 'pending_upload',
  authLastError: row.auth_last_error ?? undefined,
  pendingPasswordEncrypted: row.pending_password_enc ?? undefined,
  provisionedAt: row.provisioned_at ?? undefined,
  lastVerifiedAt: row.last_verified_at ?? undefined,
  verificationExpiresAt: row.verification_expires_at ?? undefined,
  hashedSessionToken: row.hashed_session_token ?? undefined,
  createdAt: row.created_at,
  location: row.location,
  twoFactorEnabled: fromInt(row.two_factor_enabled),
  emailNotifications: fromInt(row.email_notifications),
  lowStockAlerts: fromInt(row.low_stock_alerts),
  language: row.language,
  version: row.version ?? 1
});

const mapProduct = (row: any): Product => ({
  id: row.id,
  valueCategory: row.value_category,
  article: row.article,
  date: row.date,
  description: row.description,
  parControlNumber: row.par_control_number,
  propertyNumber: row.property_number,
  unit: row.unit,
  unitValue: row.unit_value,
  balancePerCard: row.balance_per_card,
  onHandPerCount: row.on_hand_per_count,
  total: row.total,
  remarks: row.remarks,
  location: row.location ?? '',
  assignedToEmployeeId: row.assigned_to_employee_id ?? undefined,
  assignedAt: row.assigned_at ?? undefined,
  assignmentStatus: row.assignment_status ?? 'returned',
  status: row.status,
  version: row.version ?? 1
});

const mapActivity = (row: any): ActivityLog => ({
  id: row.id,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  performedByEmployeeId: row.performed_by_employee_id,
  timestamp: row.timestamp,
  details: row.details,
  status: row.status,
  ipAddress: row.ip_address,
  version: row.version ?? 1
});

const mapSettings = (row: any): SystemSettings => ({
  id: row.id,
  systemName: row.system_name,
  companyName: row.company_name,
  timeZone: row.time_zone,
  dateFormat: row.date_format,
  maintenanceMode: fromInt(row.maintenance_mode),
  notificationsLowStock: fromInt(row.notifications_low_stock),
  notificationsNewReturn: fromInt(row.notifications_new_return),
  notificationsReturnApproved: fromInt(row.notifications_return_approved),
  notificationsEmployeeAdded: fromInt(row.notifications_employee_added),
  notificationsSystemUpdates: fromInt(row.notifications_system_updates),
  passwordPolicy: row.password_policy,
  sessionTimeoutMinutes: row.session_timeout_minutes,
  maxLoginAttempts: row.max_login_attempts,
  requireTwoFactor: fromInt(row.require_two_factor),
  ipWhitelistEnabled: fromInt(row.ip_whitelist_enabled),
  backupFrequency: row.backup_frequency,
  lastBackupAt: row.last_backup_at,
  smtpServer: row.smtp_server,
  smtpPort: row.smtp_port,
  smtpEncryption: row.smtp_encryption,
  smtpFromEmail: row.smtp_from_email,
  apiKey: row.api_key,
  apiRateLimit: row.api_rate_limit,
  apiEnabled: fromInt(row.api_enabled)
});

const mapReturn = (row: any, receivers: ReturnReceiverEntry[]): ReturnRecord => ({
  id: row.id,
  rrspNumber: row.rrsp_number,
  productId: row.product_id,
  returnDate: row.return_date,
  quantity: row.quantity,
  condition: row.condition,
  remarks: row.remarks,
  returnedByEmployeeId: row.returned_by_employee_id,
  returnedByPosition: row.returned_by_position,
  receivedDate: row.received_date,
  location: row.location,
  receivedByEmployeeIds: receivers.map((entry) => entry.employeeId),
  receivedByEntries: receivers,
  createdAt: row.created_at,
  status: row.status,
  processedByEmployeeId: row.processed_by_employee_id ?? undefined,
  processedDate: row.processed_date ?? undefined,
  processingNotes: row.processing_notes ?? undefined,
  version: row.version ?? 1
});

const fetchReturnReceivers = (db: Database.Database, returnId: string): ReturnReceiverEntry[] => {
  const rows = db
    .prepare('SELECT employee_id, position, received_date, location FROM return_receivers WHERE return_id = ?')
    .all(returnId);
  return rows.map((row: any) => ({
    employeeId: row.employee_id,
    position: row.position,
    receivedDate: row.received_date,
    location: row.location
  }));
};

const insertOrUpdateReturnReceivers = (
  db: Database.Database,
  returnId: string,
  receivers: ReturnReceiverEntry[] = []
) => {
  db.prepare('DELETE FROM return_receivers WHERE return_id = ?').run(returnId);
  if (!receivers.length) return;
  const insertReceiver = db.prepare(
    `
      INSERT INTO return_receivers (return_id, employee_id, position, received_date, location)
      VALUES (@return_id, @employee_id, @position, @received_date, @location)
    `
  );
  const tx = db.transaction((entries: ReturnReceiverEntry[]) => {
    for (const entry of entries) {
      insertReceiver.run({
        return_id: returnId,
        employee_id: entry.employeeId,
        position: entry.position,
        received_date: entry.receivedDate,
        location: entry.location
      });
    }
  });
  tx(receivers);
};

export const dataStore = {
  initialize: () => {
    ensureDb();
    return true;
  },
  getDb: ensureDb,
  importLegacyDump: (dump: unknown) => {
    const db = ensureDb();
    importLegacyDump(db, dump as any);
  },
  employees: {
    list: (): Employee[] => {
      const db = ensureDb();
      const rows = db.prepare('SELECT * FROM employees WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
      return rows.map(mapEmployee);
    },
    count: (): number => {
      const db = ensureDb();
      const row = db.prepare('SELECT COUNT(*) as count FROM employees WHERE deleted_at IS NULL').get() as { count: number };
      return row.count;
    },
    get: (id: string): Employee | undefined => {
      const db = ensureDb();
      const row = db.prepare('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL').get(id);
      return row ? mapEmployee(row) : undefined;
    },
    findBy: (field: string, value: unknown): Employee | undefined => {
      const db = ensureDb();
      const fieldMap: Record<string, string> = { email: 'email', id: 'id' };
      const column = fieldMap[field];
      if (!column) return undefined;
      const row = db.prepare(`SELECT * FROM employees WHERE ${column} = ? AND deleted_at IS NULL`).get(value as any);
      return row ? mapEmployee(row) : undefined;
    },
    add: (employee: Employee): void => {
      const db = ensureDb();
      const now = nowIso();
      const pendingPasswordEncrypted =
        employee.pendingPasswordPlain && employee.pendingPasswordPlain.trim()
          ? encryptLocalSecret(employee.pendingPasswordPlain)
          : employee.pendingPasswordEncrypted ?? null;
      const authSyncStatus = normalizeAuthSyncStatus(
        employee.authSyncStatus ?? (employee.supabaseUserId ? 'synced' : 'pending_upload')
      );

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
      `
      ).run({
        id: employee.id,
        full_name: employee.fullName,
        email: employee.email,
        phone: employee.phone,
        department: employee.department,
        role: employee.role,
        status: employee.status,
        password_hash: employee.passwordHash,
        password_salt: employee.passwordSalt,
        supabase_user_id: employee.supabaseUserId ?? null,
        auth_sync_status: authSyncStatus,
        auth_last_error: employee.authLastError ?? null,
        pending_password_enc: pendingPasswordEncrypted,
        provisioned_at: employee.provisionedAt ?? null,
        last_verified_at: employee.lastVerifiedAt ?? null,
        verification_expires_at: employee.verificationExpiresAt ?? null,
        hashed_session_token: employee.hashedSessionToken ?? null,
        created_at: employee.createdAt,
        location: employee.location,
        two_factor_enabled: toInt(employee.twoFactorEnabled),
        email_notifications: toInt(employee.emailNotifications),
        low_stock_alerts: toInt(employee.lowStockAlerts),
        language: employee.language,
        sync_status: 'pending',
        is_dirty: 1,
        last_modified: now,
        last_synced_at: null,
        deleted_at: null,
        version: 1
      });
      enqueueOutbox(db, 'employees', employee.id, 'insert', {
        ...mapEmployeeOutboxPayload({
          ...employee,
          pendingPasswordEncrypted: pendingPasswordEncrypted ?? undefined,
          authSyncStatus,
          version: 1
        } as Employee),
        version: 1
      });
    },
    update: (id: string, changes: Partial<Employee>): void => {
      const db = ensureDb();
      const existing = dataStore.employees.get(id);
      if (!existing) return;
      const nextVersion = (existing.version ?? 1) + 1;
      const nextPendingPasswordEncrypted =
        Object.prototype.hasOwnProperty.call(changes, 'pendingPasswordPlain')
          ? changes.pendingPasswordPlain && String(changes.pendingPasswordPlain).trim()
            ? encryptLocalSecret(String(changes.pendingPasswordPlain))
            : null
          : Object.prototype.hasOwnProperty.call(changes, 'pendingPasswordEncrypted')
            ? changes.pendingPasswordEncrypted || null
            : existing.pendingPasswordEncrypted || null;

      const provisioningFieldsChanged =
        (changes.email != null && changes.email !== existing.email) ||
        (changes.role != null && changes.role !== existing.role) ||
        (changes.status != null && changes.status !== existing.status) ||
        Object.prototype.hasOwnProperty.call(changes, 'pendingPasswordPlain') ||
        Object.prototype.hasOwnProperty.call(changes, 'pendingPasswordEncrypted');

      let nextAuthSyncStatus = normalizeAuthSyncStatus(changes.authSyncStatus ?? existing.authSyncStatus ?? 'pending_upload');
      if (provisioningFieldsChanged) {
        nextAuthSyncStatus = 'pending_upload';
      } else if (!nextPendingPasswordEncrypted && existing.supabaseUserId && nextAuthSyncStatus === 'pending_upload') {
        nextAuthSyncStatus = 'synced';
      }

      const updated: Employee = {
        ...existing,
        ...changes,
        pendingPasswordEncrypted: nextPendingPasswordEncrypted || undefined,
        authSyncStatus: nextAuthSyncStatus,
        authLastError: provisioningFieldsChanged ? undefined : changes.authLastError ?? existing.authLastError,
        version: nextVersion
      };
      const now = nowIso();
      db.prepare(
        `
        UPDATE employees SET
          full_name = @full_name,
          email = @email,
          phone = @phone,
          department = @department,
          role = @role,
          status = @status,
          password_hash = @password_hash,
          password_salt = @password_salt,
          supabase_user_id = @supabase_user_id,
          auth_sync_status = @auth_sync_status,
          auth_last_error = @auth_last_error,
          pending_password_enc = @pending_password_enc,
          provisioned_at = @provisioned_at,
          last_verified_at = @last_verified_at,
          verification_expires_at = @verification_expires_at,
          hashed_session_token = @hashed_session_token,
          created_at = @created_at,
          location = @location,
          two_factor_enabled = @two_factor_enabled,
          email_notifications = @email_notifications,
          low_stock_alerts = @low_stock_alerts,
          language = @language,
          sync_status = @sync_status,
          is_dirty = @is_dirty,
          last_modified = @last_modified,
          version = @version
        WHERE id = @id
      `
      ).run({
        id,
        full_name: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        department: updated.department,
        role: updated.role,
        status: updated.status,
        password_hash: updated.passwordHash,
        password_salt: updated.passwordSalt,
        supabase_user_id: updated.supabaseUserId ?? null,
        auth_sync_status: normalizeAuthSyncStatus(updated.authSyncStatus),
        auth_last_error: updated.authLastError ?? null,
        pending_password_enc: updated.pendingPasswordEncrypted ?? null,
        provisioned_at: updated.provisionedAt ?? null,
        last_verified_at: updated.lastVerifiedAt ?? null,
        verification_expires_at: updated.verificationExpiresAt ?? null,
        hashed_session_token: updated.hashedSessionToken ?? null,
        created_at: updated.createdAt,
        location: updated.location,
        two_factor_enabled: toInt(updated.twoFactorEnabled),
        email_notifications: toInt(updated.emailNotifications),
        low_stock_alerts: toInt(updated.lowStockAlerts),
        language: updated.language,
        sync_status: 'pending',
        is_dirty: 1,
        last_modified: now,
        version: nextVersion
      });
      enqueueOutbox(db, 'employees', id, 'update', mapEmployeeOutboxPayload(updated));
    },
    remove: (id: string): void => {
      const db = ensureDb();
      const now = nowIso();
      const row = db.prepare('SELECT version FROM employees WHERE id = ?').get(id) as { version?: number } | undefined;
      const nextVersion = (row?.version ?? 1) + 1;
      db.prepare(
        `
        UPDATE employees
        SET deleted_at = ?, sync_status = 'pending', is_dirty = 1, last_modified = ?, version = ?
        WHERE id = ?
      `
      ).run(now, now, nextVersion, id);
      enqueueOutbox(db, 'employees', id, 'delete', { id, deletedAt: now, version: nextVersion });
    }
  },
  products: {
    list: (): Product[] => {
      const db = ensureDb();
      const rows = db.prepare('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY rowid DESC').all();
      return rows.map(mapProduct);
    },
    get: (id: string): Product | undefined => {
      const db = ensureDb();
      const row = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(id);
      return row ? mapProduct(row) : undefined;
    },
    findBy: (field: string, value: unknown): Product | undefined => {
      const db = ensureDb();
      const fieldMap: Record<string, string> = { id: 'id', propertyNumber: 'property_number', parControlNumber: 'par_control_number' };
      const column = fieldMap[field];
      if (!column) return undefined;
      const row = db.prepare(`SELECT * FROM products WHERE ${column} = ? AND deleted_at IS NULL`).get(value as any);
      return row ? mapProduct(row) : undefined;
    },
    add: (product: Product): void => {
      const db = ensureDb();
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
      `
      ).run({
        id: product.id,
        value_category: product.valueCategory,
        article: product.article,
        date: product.date,
        description: product.description,
        par_control_number: product.parControlNumber,
        property_number: product.propertyNumber,
        unit: product.unit,
        unit_value: product.unitValue,
        balance_per_card: product.balancePerCard,
        on_hand_per_count: product.onHandPerCount,
        total: product.total,
        remarks: product.remarks,
        location: product.location ?? '',
        assigned_to_employee_id: product.assignedToEmployeeId ?? null,
        assigned_at: product.assignedToEmployeeId ? product.assignedAt ?? now : null,
        assignment_status: product.assignedToEmployeeId ? 'active' : 'returned',
        status: product.status,
        sync_status: 'pending',
        is_dirty: 1,
        last_modified: now,
        last_synced_at: null,
        deleted_at: null,
        version: 1
      });
      enqueueOutbox(db, 'products', product.id, 'insert', {
        ...product,
        assignedAt: product.assignedToEmployeeId ? product.assignedAt ?? now : undefined,
        assignmentStatus: product.assignedToEmployeeId ? 'active' : 'returned',
        version: 1
      });
    },
    update: (id: string, changes: Partial<Product>): void => {
      const db = ensureDb();
      const existing = dataStore.products.get(id);
      if (!existing) return;
      const nextVersion = (existing.version ?? 1) + 1;
      const hasAssignmentChange = Object.prototype.hasOwnProperty.call(changes, 'assignedToEmployeeId');
      const nextAssignedToEmployeeId = hasAssignmentChange ? changes.assignedToEmployeeId : existing.assignedToEmployeeId;
      const assignmentChanged = nextAssignedToEmployeeId !== existing.assignedToEmployeeId;
      const assignedAt =
        nextAssignedToEmployeeId && (assignmentChanged || !existing.assignedAt)
          ? nowIso()
          : nextAssignedToEmployeeId
            ? existing.assignedAt
            : undefined;
      const updated: Product = {
        ...existing,
        ...changes,
        assignedToEmployeeId: nextAssignedToEmployeeId,
        assignedAt,
        assignmentStatus: nextAssignedToEmployeeId ? 'active' : 'returned',
        version: nextVersion
      } as Product;
      const now = nowIso();
      db.prepare(
        `
        UPDATE products SET
          value_category = @value_category,
          article = @article,
          date = @date,
          description = @description,
          par_control_number = @par_control_number,
          property_number = @property_number,
          unit = @unit,
          unit_value = @unit_value,
          balance_per_card = @balance_per_card,
          on_hand_per_count = @on_hand_per_count,
          total = @total,
          remarks = @remarks,
          location = @location,
          assigned_to_employee_id = @assigned_to_employee_id,
          assigned_at = @assigned_at,
          assignment_status = @assignment_status,
          status = @status,
          sync_status = @sync_status,
          is_dirty = @is_dirty,
          last_modified = @last_modified,
          version = @version
        WHERE id = @id
      `
      ).run({
        id,
        value_category: updated.valueCategory,
        article: updated.article,
        date: updated.date,
        description: updated.description,
        par_control_number: updated.parControlNumber,
        property_number: updated.propertyNumber,
        unit: updated.unit,
        unit_value: updated.unitValue,
        balance_per_card: updated.balancePerCard,
        on_hand_per_count: updated.onHandPerCount,
        total: updated.total,
        remarks: updated.remarks,
        location: updated.location,
        assigned_to_employee_id: updated.assignedToEmployeeId ?? null,
        assigned_at: updated.assignedToEmployeeId ? updated.assignedAt ?? now : null,
        assignment_status: updated.assignedToEmployeeId ? 'active' : 'returned',
        status: updated.status,
        sync_status: 'pending',
        is_dirty: 1,
        last_modified: now,
        version: nextVersion
      });
      enqueueOutbox(db, 'products', id, 'update', {
        ...updated,
        _meta: {
          previousAssignedToEmployeeId: existing.assignedToEmployeeId ?? null,
          assignmentChanged
        }
      });
    },
    remove: (id: string): void => {
      const db = ensureDb();
      const now = nowIso();
      const row = db
        .prepare('SELECT version, assigned_to_employee_id FROM products WHERE id = ?')
        .get(id) as { version?: number; assigned_to_employee_id?: string | null } | undefined;
      const nextVersion = (row?.version ?? 1) + 1;
      db.prepare(
        `
        UPDATE products
        SET deleted_at = ?, sync_status = 'pending', is_dirty = 1, last_modified = ?, version = ?, assignment_status = 'returned'
        WHERE id = ?
      `
      ).run(now, now, nextVersion, id);
      enqueueOutbox(db, 'products', id, 'delete', {
        id,
        deletedAt: now,
        version: nextVersion,
        assignedToEmployeeId: row?.assigned_to_employee_id ?? null
      });
    }
  },
  returns: {
    list: (): ReturnRecord[] => {
      const db = ensureDb();
      const rows = db.prepare('SELECT * FROM returns WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
      return rows.map((row: any) => {
        const receivers = fetchReturnReceivers(db, row.id);
        return mapReturn(row, receivers);
      });
    },
    get: (id: string): ReturnRecord | undefined => {
      const db = ensureDb();
      const row = db.prepare('SELECT * FROM returns WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!row) return undefined;
      const receivers = fetchReturnReceivers(db, id);
      return mapReturn(row, receivers);
    },
    add: (record: ReturnRecord): void => {
      const db = ensureDb();
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
      `
      ).run({
        id: record.id,
        rrsp_number: record.rrspNumber,
        product_id: record.productId,
        return_date: record.returnDate,
        quantity: record.quantity,
        condition: record.condition,
        remarks: record.remarks,
        returned_by_employee_id: record.returnedByEmployeeId,
        returned_by_position: record.returnedByPosition,
        received_date: record.receivedDate,
        location: record.location,
        created_at: record.createdAt,
        status: record.status,
        processed_by_employee_id: record.processedByEmployeeId ?? null,
        processed_date: record.processedDate ?? null,
        processing_notes: record.processingNotes ?? null,
        sync_status: 'pending',
        is_dirty: 1,
        last_modified: now,
        last_synced_at: null,
        deleted_at: null,
        version: 1
      });
      insertOrUpdateReturnReceivers(db, record.id, record.receivedByEntries || []);
      enqueueOutbox(db, 'returns', record.id, 'insert', { ...record, version: 1 });
    },
    update: (id: string, changes: Partial<ReturnRecord>): void => {
      const db = ensureDb();
      const existing = dataStore.returns.get(id);
      if (!existing) return;
      const nextVersion = (existing.version ?? 1) + 1;
      const updated: ReturnRecord = { ...existing, ...changes, version: nextVersion } as ReturnRecord;
      const now = nowIso();
      db.prepare(
        `
        UPDATE returns SET
          rrsp_number = @rrsp_number,
          product_id = @product_id,
          return_date = @return_date,
          quantity = @quantity,
          condition = @condition,
          remarks = @remarks,
          returned_by_employee_id = @returned_by_employee_id,
          returned_by_position = @returned_by_position,
          received_date = @received_date,
          location = @location,
          created_at = @created_at,
          status = @status,
          processed_by_employee_id = @processed_by_employee_id,
          processed_date = @processed_date,
          processing_notes = @processing_notes,
          sync_status = @sync_status,
          is_dirty = @is_dirty,
          last_modified = @last_modified,
          version = @version
        WHERE id = @id
      `
      ).run({
        id,
        rrsp_number: updated.rrspNumber,
        product_id: updated.productId,
        return_date: updated.returnDate,
        quantity: updated.quantity,
        condition: updated.condition,
        remarks: updated.remarks,
        returned_by_employee_id: updated.returnedByEmployeeId,
        returned_by_position: updated.returnedByPosition,
        received_date: updated.receivedDate,
        location: updated.location,
        created_at: updated.createdAt,
        status: updated.status,
        processed_by_employee_id: updated.processedByEmployeeId ?? null,
        processed_date: updated.processedDate ?? null,
        processing_notes: updated.processingNotes ?? null,
        sync_status: 'pending',
        is_dirty: 1,
        last_modified: now,
        version: nextVersion
      });
      insertOrUpdateReturnReceivers(db, id, updated.receivedByEntries || []);
      enqueueOutbox(db, 'returns', id, 'update', updated);
    },
    remove: (id: string): void => {
      const db = ensureDb();
      const now = nowIso();
      const row = db.prepare('SELECT version FROM returns WHERE id = ?').get(id) as { version?: number } | undefined;
      const nextVersion = (row?.version ?? 1) + 1;
      db.prepare(
        `
        UPDATE returns
        SET deleted_at = ?, sync_status = 'pending', is_dirty = 1, last_modified = ?, version = ?
        WHERE id = ?
      `
      ).run(now, now, nextVersion, id);
      enqueueOutbox(db, 'returns', id, 'delete', { id, deletedAt: now, version: nextVersion });
    }
  },
  activityLogs: {
    list: (): ActivityLog[] => {
      const db = ensureDb();
      const rows = db.prepare('SELECT * FROM activity_logs WHERE deleted_at IS NULL ORDER BY timestamp DESC').all();
      return rows.map(mapActivity);
    },
    get: (id: string): ActivityLog | undefined => {
      const db = ensureDb();
      const row = db.prepare('SELECT * FROM activity_logs WHERE id = ? AND deleted_at IS NULL').get(id);
      return row ? mapActivity(row) : undefined;
    },
    add: (log: ActivityLog): void => {
      const db = ensureDb();
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
      `
      ).run({
        id: log.id,
        action: log.action,
        entity_type: log.entityType,
        entity_id: log.entityId,
        performed_by_employee_id: log.performedByEmployeeId,
        timestamp: log.timestamp,
        details: log.details,
        status: log.status,
        ip_address: log.ipAddress,
        sync_status: 'local_only',
        is_dirty: 0,
        last_modified: now,
        last_synced_at: now,
        deleted_at: null,
        version: 1
      });
    }
  },
  settings: {
    list: (): SystemSettings[] => {
      const db = ensureDb();
      const rows = db.prepare('SELECT * FROM settings').all();
      return rows.map(mapSettings);
    },
    get: (id: string): SystemSettings | undefined => {
      const db = ensureDb();
      const row = db.prepare('SELECT * FROM settings WHERE id = ?').get(id);
      return row ? mapSettings(row) : undefined;
    },
    put: (settings: SystemSettings): void => {
      const db = ensureDb();
      db.prepare(
        `
        INSERT INTO settings (
          id, system_name, company_name, time_zone, date_format, maintenance_mode,
          notifications_low_stock, notifications_new_return, notifications_return_approved, notifications_employee_added,
          notifications_system_updates, password_policy, session_timeout_minutes, max_login_attempts,
          require_two_factor, ip_whitelist_enabled, backup_frequency, last_backup_at,
          smtp_server, smtp_port, smtp_encryption, smtp_from_email, api_key, api_rate_limit, api_enabled
        ) VALUES (
          @id, @system_name, @company_name, @time_zone, @date_format, @maintenance_mode,
          @notifications_low_stock, @notifications_new_return, @notifications_return_approved, @notifications_employee_added,
          @notifications_system_updates, @password_policy, @session_timeout_minutes, @max_login_attempts,
          @require_two_factor, @ip_whitelist_enabled, @backup_frequency, @last_backup_at,
          @smtp_server, @smtp_port, @smtp_encryption, @smtp_from_email, @api_key, @api_rate_limit, @api_enabled
        )
        ON CONFLICT(id) DO UPDATE SET
          system_name = excluded.system_name,
          company_name = excluded.company_name,
          time_zone = excluded.time_zone,
          date_format = excluded.date_format,
          maintenance_mode = excluded.maintenance_mode,
          notifications_low_stock = excluded.notifications_low_stock,
          notifications_new_return = excluded.notifications_new_return,
          notifications_return_approved = excluded.notifications_return_approved,
          notifications_employee_added = excluded.notifications_employee_added,
          notifications_system_updates = excluded.notifications_system_updates,
          password_policy = excluded.password_policy,
          session_timeout_minutes = excluded.session_timeout_minutes,
          max_login_attempts = excluded.max_login_attempts,
          require_two_factor = excluded.require_two_factor,
          ip_whitelist_enabled = excluded.ip_whitelist_enabled,
          backup_frequency = excluded.backup_frequency,
          last_backup_at = excluded.last_backup_at,
          smtp_server = excluded.smtp_server,
          smtp_port = excluded.smtp_port,
          smtp_encryption = excluded.smtp_encryption,
          smtp_from_email = excluded.smtp_from_email,
          api_key = excluded.api_key,
          api_rate_limit = excluded.api_rate_limit,
          api_enabled = excluded.api_enabled
      `
      ).run({
        id: settings.id,
        system_name: settings.systemName,
        company_name: settings.companyName,
        time_zone: settings.timeZone,
        date_format: settings.dateFormat,
        maintenance_mode: toInt(settings.maintenanceMode),
        notifications_low_stock: toInt(settings.notificationsLowStock),
        notifications_new_return: toInt(settings.notificationsNewReturn),
        notifications_return_approved: toInt(settings.notificationsReturnApproved),
        notifications_employee_added: toInt(settings.notificationsEmployeeAdded),
        notifications_system_updates: toInt(settings.notificationsSystemUpdates),
        password_policy: settings.passwordPolicy,
        session_timeout_minutes: settings.sessionTimeoutMinutes,
        max_login_attempts: settings.maxLoginAttempts,
        require_two_factor: toInt(settings.requireTwoFactor),
        ip_whitelist_enabled: toInt(settings.ipWhitelistEnabled),
        backup_frequency: settings.backupFrequency,
        last_backup_at: settings.lastBackupAt,
        smtp_server: settings.smtpServer,
        smtp_port: settings.smtpPort,
        smtp_encryption: settings.smtpEncryption,
        smtp_from_email: settings.smtpFromEmail,
        api_key: settings.apiKey,
        api_rate_limit: settings.apiRateLimit,
        api_enabled: toInt(settings.apiEnabled)
      });
    }
  }
};
