import type Database from 'better-sqlite3';
import { dataStore } from '../db';

const SYNC_ENDPOINT = process.env.SYNC_ENDPOINT || 'http://localhost:4000/sync';

const nowIso = (): string => new Date().toISOString();

const tableMap: Record<string, string> = {
  employees: 'employees',
  products: 'products',
  returns: 'returns',
  activity_logs: 'activity_logs'
};

const applyServerEmployee = (db: Database.Database, data: any) => {
  const now = nowIso();
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
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      department = excluded.department,
      role = excluded.role,
      status = excluded.status,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
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
      deleted_at = excluded.deleted_at
  `
  ).run({
    id: data.id,
    full_name: data.fullName,
    email: data.email,
    phone: data.phone,
    department: data.department,
    role: data.role,
    status: data.status,
    password_hash: data.passwordHash,
    password_salt: data.passwordSalt,
    created_at: data.createdAt,
    location: data.location ?? '',
    two_factor_enabled: data.twoFactorEnabled ? 1 : 0,
    email_notifications: data.emailNotifications ? 1 : 0,
    low_stock_alerts: data.lowStockAlerts ? 1 : 0,
    language: data.language ?? 'English',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: data.lastModified ?? now,
    last_synced_at: now,
    deleted_at: data.deletedAt ?? null
  });
};

const applyServerProduct = (db: Database.Database, data: any) => {
  const now = nowIso();
  db.prepare(
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
      status = excluded.status,
      sync_status = excluded.sync_status,
      is_dirty = excluded.is_dirty,
      last_modified = excluded.last_modified,
      last_synced_at = excluded.last_synced_at,
      deleted_at = excluded.deleted_at
  `
  ).run({
    id: data.id,
    value_category: data.valueCategory,
    article: data.article,
    date: data.date,
    description: data.description,
    par_control_number: data.parControlNumber,
    property_number: data.propertyNumber,
    unit: data.unit,
    unit_value: data.unitValue,
    balance_per_card: data.balancePerCard,
    on_hand_per_count: data.onHandPerCount,
    total: data.total,
    remarks: data.remarks,
    location: data.location ?? '',
    assigned_to_employee_id: data.assignedToEmployeeId ?? null,
    status: data.status,
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: data.lastModified ?? now,
    last_synced_at: now,
    deleted_at: data.deletedAt ?? null
  });
};

const applyServerReturn = (db: Database.Database, data: any) => {
  const now = nowIso();
  db.prepare(
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
      deleted_at = excluded.deleted_at
  `
  ).run({
    id: data.id,
    rrsp_number: data.rrspNumber,
    product_id: data.productId,
    return_date: data.returnDate,
    quantity: data.quantity,
    condition: data.condition,
    remarks: data.remarks,
    returned_by_employee_id: data.returnedByEmployeeId,
    returned_by_position: data.returnedByPosition,
    received_date: data.receivedDate,
    location: data.location,
    created_at: data.createdAt,
    status: data.status,
    processed_by_employee_id: data.processedByEmployeeId ?? null,
    processed_date: data.processedDate ?? null,
    processing_notes: data.processingNotes ?? null,
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: data.lastModified ?? now,
    last_synced_at: now,
    deleted_at: data.deletedAt ?? null
  });

  if (Array.isArray(data.receivedByEntries)) {
    db.prepare('DELETE FROM return_receivers WHERE return_id = ?').run(data.id);
    const insertReceiver = db.prepare(
      `
      INSERT INTO return_receivers (return_id, employee_id, position, received_date, location)
      VALUES (@return_id, @employee_id, @position, @received_date, @location)
    `
    );
    const tx = db.transaction((entries: any[]) => {
      for (const entry of entries) {
        insertReceiver.run({
          return_id: data.id,
          employee_id: entry.employeeId,
          position: entry.position,
          received_date: entry.receivedDate,
          location: entry.location
        });
      }
    });
    tx(data.receivedByEntries);
  }
};

const applyServerActivity = (db: Database.Database, data: any) => {
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO activity_logs (
      id, action, entity_type, entity_id, performed_by_employee_id, timestamp,
      details, status, ip_address, sync_status, is_dirty, last_modified, last_synced_at, deleted_at
    ) VALUES (
      @id, @action, @entity_type, @entity_id, @performed_by_employee_id, @timestamp,
      @details, @status, @ip_address, @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at
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
      deleted_at = excluded.deleted_at
  `
  ).run({
    id: data.id,
    action: data.action,
    entity_type: data.entityType,
    entity_id: data.entityId,
    performed_by_employee_id: data.performedByEmployeeId,
    timestamp: data.timestamp,
    details: data.details,
    status: data.status,
    ip_address: data.ipAddress,
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: data.lastModified ?? now,
    last_synced_at: now,
    deleted_at: data.deletedAt ?? null
  });
};

const applyServerChange = (db: Database.Database, change: any) => {
  const { entityType, data } = change;
  switch (entityType) {
    case 'employees':
      return applyServerEmployee(db, data);
    case 'products':
      return applyServerProduct(db, data);
    case 'returns':
      return applyServerReturn(db, data);
    case 'activity_logs':
      return applyServerActivity(db, data);
    default:
      return undefined;
  }
};

const scheduleRetry = (attempts: number): string => {
  const delaySeconds = Math.min(300, 30 * (attempts + 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
};

export async function syncNow() {
  const db = dataStore.getDb();
  if (typeof fetch !== 'function') {
    return { status: 'error', error: 'fetch is not available in this runtime' };
  }
  const outboxRows = db
    .prepare('SELECT * FROM sync_outbox WHERE next_retry_at IS NULL OR next_retry_at <= ? ORDER BY id ASC LIMIT 100')
    .all(nowIso()) as Array<any>;

  if (!outboxRows.length) return { status: 'idle' };

  const payload = outboxRows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    data: JSON.parse(row.payload)
  }));

  try {
    const response = await fetch(`${SYNC_ENDPOINT}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: payload })
    });

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    const result = await response.json();
    const ackedIds = new Set<number>(result.ackedIds || []);
    const conflicts = result.conflicts || [];
    const serverChanges = result.serverChanges || [];

    const now = nowIso();
    const tx = db.transaction(() => {
      if (ackedIds.size) {
        const ackedRows = outboxRows.filter((row) => ackedIds.has(row.id));

        for (const row of ackedRows) {
          const table = tableMap[row.entity_type];
          if (!table) continue;
          db.prepare(`UPDATE ${table} SET sync_status = 'synced', is_dirty = 0, last_synced_at = ? WHERE id = ?`).run(
            now,
            row.entity_id
          );
        }

        db.prepare('DELETE FROM sync_outbox WHERE id IN (' + Array.from(ackedIds).map(() => '?').join(',') + ')').run(
          ...Array.from(ackedIds)
        );
      }

      for (const conflict of conflicts) {
        const table = tableMap[conflict.entityType];
        if (!table) continue;
        db.prepare(`UPDATE ${table} SET sync_status = 'conflict' WHERE id = ?`).run(conflict.entityId);
      }

      for (const change of serverChanges) {
        applyServerChange(db, change);
      }
    });

    tx();
    return { status: 'synced' };
  } catch (error: any) {
    const tx = db.transaction(() => {
      for (const row of outboxRows) {
        const attempts = (row.attempts ?? 0) + 1;
        db.prepare(
          'UPDATE sync_outbox SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?'
        ).run(attempts, error?.message ?? 'sync failed', scheduleRetry(attempts), row.id);
      }
    });
    tx();
    return { status: 'error', error: error?.message ?? 'sync failed' };
  }
}
