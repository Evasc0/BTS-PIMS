import type Database from 'better-sqlite3';
import type { ReturnRecord } from '../shared/types';

interface LegacyDump {
  employees: any[];
  products: any[];
  returns: ReturnRecord[];
  activityLogs: any[];
  settings: any[];
}

const normalizeSync = (record: any) => {
  const isDirty = Boolean(record?.isDirty ?? record?.is_dirty ?? false);
  const lastModified =
    record?.lastModified ?? record?.last_modified ?? record?.updatedAt ?? record?.createdAt ?? new Date().toISOString();
  const lastSyncedAt = record?.lastSyncedAt ?? record?.last_synced_at ?? null;
  const deletedAt = record?.deletedAt ?? record?.deleted_at ?? null;
  const syncStatus = record?.syncStatus ?? record?.sync_status ?? (isDirty ? 'pending' : 'synced');

  return {
    sync_status: syncStatus,
    is_dirty: isDirty ? 1 : 0,
    last_modified: lastModified,
    last_synced_at: lastSyncedAt,
    deleted_at: deletedAt
  };
};

export function importLegacyDump(db: Database.Database, dump: LegacyDump): void {
  if (!dump) return;

  const insertEmployee = db.prepare(
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
  );

  const insertProduct = db.prepare(
    `
    INSERT INTO products (
      id, value_category, article, date, description, par_control_number, property_number,
      unit, unit_value, balance_per_card, on_hand_per_count, total, remarks, location,
      assigned_to_employee_id, status, sync_status, is_dirty, last_modified, last_synced_at, deleted_at
    ) VALUES (
      @id, @value_category, @article, @date, @description, @par_control_number, @property_number,
      @unit, @unit_value, @balance_per_card, @on_hand_per_count, @total, @remarks, @location,
      @assigned_to_employee_id, @status, @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at
    )
  `
  );

  const insertReturn = db.prepare(
    `
    INSERT INTO returns (
      id, rrsp_number, product_id, return_date, quantity, condition, remarks,
      returned_by_employee_id, returned_by_position, received_date, location,
      created_at, status, processed_by_employee_id, processed_date, processing_notes,
      sync_status, is_dirty, last_modified, last_synced_at, deleted_at
    ) VALUES (
      @id, @rrsp_number, @product_id, @return_date, @quantity, @condition, @remarks,
      @returned_by_employee_id, @returned_by_position, @received_date, @location,
      @created_at, @status, @processed_by_employee_id, @processed_date, @processing_notes,
      @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at
    )
  `
  );

  const insertReturnReceiver = db.prepare(
    `
    INSERT INTO return_receivers (
      return_id, employee_id, position, received_date, location
    ) VALUES (
      @return_id, @employee_id, @position, @received_date, @location
    )
  `
  );

  const insertActivity = db.prepare(
    `
    INSERT INTO activity_logs (
      id, action, entity_type, entity_id, performed_by_employee_id, timestamp,
      details, status, ip_address, sync_status, is_dirty, last_modified, last_synced_at, deleted_at
    ) VALUES (
      @id, @action, @entity_type, @entity_id, @performed_by_employee_id, @timestamp,
      @details, @status, @ip_address, @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at
    )
  `
  );

  const insertSettings = db.prepare(
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
  );

  const tx = db.transaction(() => {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM return_receivers');
    db.exec('DELETE FROM returns');
    db.exec('DELETE FROM products');
    db.exec('DELETE FROM employees');
    db.exec('DELETE FROM activity_logs');
    db.exec('DELETE FROM settings');
    db.exec('DELETE FROM sync_outbox');

    for (const employee of dump.employees || []) {
      const sync = normalizeSync(employee);
      insertEmployee.run({
        id: employee.id,
        full_name: employee.fullName,
        email: employee.email,
        phone: employee.phone,
        department: employee.department,
        role: employee.role,
        status: employee.status,
        password_hash: employee.passwordHash,
        password_salt: employee.passwordSalt,
        created_at: employee.createdAt,
        location: employee.location ?? '',
        two_factor_enabled: employee.twoFactorEnabled ? 1 : 0,
        email_notifications: employee.emailNotifications ? 1 : 0,
        low_stock_alerts: employee.lowStockAlerts ? 1 : 0,
        language: employee.language ?? 'English',
        ...sync
      });
    }

    for (const product of dump.products || []) {
      const sync = normalizeSync(product);
      insertProduct.run({
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
        status: product.status,
        ...sync
      });
    }

    for (const record of dump.returns || []) {
      const sync = normalizeSync(record);
      insertReturn.run({
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
        ...sync
      });

      const entries = Array.isArray(record.receivedByEntries) ? record.receivedByEntries : [];
      for (const entry of entries) {
        insertReturnReceiver.run({
          return_id: record.id,
          employee_id: entry.employeeId,
          position: entry.position,
          received_date: entry.receivedDate,
          location: entry.location
        });
      }
    }

    for (const log of dump.activityLogs || []) {
      const sync = normalizeSync(log);
      insertActivity.run({
        id: log.id,
        action: log.action,
        entity_type: log.entityType,
        entity_id: log.entityId,
        performed_by_employee_id: log.performedByEmployeeId,
        timestamp: log.timestamp,
        details: log.details,
        status: log.status,
        ip_address: log.ipAddress,
        ...sync
      });
    }

    for (const settings of dump.settings || []) {
      insertSettings.run({
        id: settings.id,
        system_name: settings.systemName,
        company_name: settings.companyName,
        time_zone: settings.timeZone,
        date_format: settings.dateFormat,
        maintenance_mode: settings.maintenanceMode ? 1 : 0,
        notifications_low_stock: settings.notificationsLowStock ? 1 : 0,
        notifications_new_return: settings.notificationsNewReturn ? 1 : 0,
        notifications_return_approved: settings.notificationsReturnApproved ? 1 : 0,
        notifications_employee_added: settings.notificationsEmployeeAdded ? 1 : 0,
        notifications_system_updates: settings.notificationsSystemUpdates ? 1 : 0,
        password_policy: settings.passwordPolicy,
        session_timeout_minutes: settings.sessionTimeoutMinutes,
        max_login_attempts: settings.maxLoginAttempts,
        require_two_factor: settings.requireTwoFactor ? 1 : 0,
        ip_whitelist_enabled: settings.ipWhitelistEnabled ? 1 : 0,
        backup_frequency: settings.backupFrequency,
        last_backup_at: settings.lastBackupAt,
        smtp_server: settings.smtpServer,
        smtp_port: settings.smtpPort,
        smtp_encryption: settings.smtpEncryption,
        smtp_from_email: settings.smtpFromEmail,
        api_key: settings.apiKey,
        api_rate_limit: settings.apiRateLimit,
        api_enabled: settings.apiEnabled ? 1 : 0
      });
    }

    db.exec('PRAGMA foreign_keys = ON');
  });

  tx();
}
