import crypto from 'crypto';
import type Database from 'better-sqlite3';

export const DEFAULT_ADMIN_CREDENTIALS = {
  email: 'admin@local',
  password: 'admin123'
};

const encodeBase64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

const hashWithSalt = (password: string, salt: string): string => {
  const hash = crypto.createHash('sha256');
  hash.update(`${salt}:${password}`);
  return hash.digest('base64');
};

const createPasswordHash = (password: string): { hash: string; salt: string } => {
  const saltBytes = crypto.randomBytes(16);
  const salt = encodeBase64(saltBytes);
  const hash = hashWithSalt(password, salt);
  return { hash, salt };
};

const regenerateApiKey = (): string => {
  const bytes = crypto.randomBytes(24);
  return encodeBase64(bytes).replace(/=+$/u, '');
};

const createId = (): string => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const random = Math.random().toString(36).slice(2);
  const timestamp = Date.now().toString(36);
  return `${timestamp}-${random}`;
};

export function seedIfNeeded(db: Database.Database): void {
  const now = new Date().toISOString();
  const employeeCount = db.prepare('SELECT COUNT(*) as count FROM employees').get() as { count: number };

  if (employeeCount.count === 0) {
    const { hash, salt } = createPasswordHash(DEFAULT_ADMIN_CREDENTIALS.password);
    const adminId = createId();

    db.prepare(
      `
      INSERT INTO employees (
        id, full_name, email, phone, department, role, status, password_hash, password_salt,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at
      ) VALUES (
        @id, @full_name, @email, @phone, @department, @role, @status, @password_hash, @password_salt,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at
      )
    `
    ).run({
      id: adminId,
      full_name: 'System Administrator',
      email: DEFAULT_ADMIN_CREDENTIALS.email,
      phone: '',
      department: 'Administration',
      role: 'admin',
      status: 'active',
      password_hash: hash,
      password_salt: salt,
      created_at: now,
      location: '',
      two_factor_enabled: 0,
      email_notifications: 0,
      low_stock_alerts: 0,
      language: 'English',
      sync_status: 'pending',
      is_dirty: 1,
      last_modified: now,
      last_synced_at: null,
      deleted_at: null
    });

    db.prepare(
      `
      INSERT INTO activity_logs (
        id, action, entity_type, entity_id, performed_by_employee_id, timestamp,
        details, status, ip_address, sync_status, is_dirty, last_modified, last_synced_at, deleted_at
      ) VALUES (
        @id, @action, @entity_type, @entity_id, @performed_by_employee_id, @timestamp,
        @details, @status, @ip_address, @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at
      )
    `
    ).run({
      id: createId(),
      action: 'CREATE',
      entity_type: 'employee',
      entity_id: adminId,
      performed_by_employee_id: adminId,
      timestamp: now,
      details: 'Initial admin account created',
      status: 'success',
      ip_address: 'offline',
      sync_status: 'pending',
      is_dirty: 1,
      last_modified: now,
      last_synced_at: null,
      deleted_at: null
    });
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
  if (settingsCount.count === 0) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
    `
    ).run({
      id: 'system',
      system_name: 'BTS Property Inventory Management System',
      company_name: '',
      time_zone: timeZone,
      date_format: 'YYYY-MM-DD',
      maintenance_mode: 0,
      notifications_low_stock: 0,
      notifications_new_return: 0,
      notifications_return_approved: 0,
      notifications_employee_added: 0,
      notifications_system_updates: 0,
      password_policy: 'medium',
      session_timeout_minutes: 30,
      max_login_attempts: 5,
      require_two_factor: 0,
      ip_whitelist_enabled: 0,
      backup_frequency: 'monthly',
      last_backup_at: '',
      smtp_server: '',
      smtp_port: '',
      smtp_encryption: 'TLS',
      smtp_from_email: '',
      api_key: regenerateApiKey(),
      api_rate_limit: 100,
      api_enabled: 0
    });
  }
}
