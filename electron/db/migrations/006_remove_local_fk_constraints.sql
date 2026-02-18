PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Rebuild local tables without FK constraints for offline-first sync safety.
-- Do not use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` here because older
-- SQLite builds bundled with some better-sqlite3 versions reject it.

CREATE TABLE products_new (
  id TEXT PRIMARY KEY,
  value_category TEXT NOT NULL,
  article TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  par_control_number TEXT NOT NULL,
  property_number TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_value REAL NOT NULL,
  balance_per_card REAL NOT NULL,
  on_hand_per_count REAL NOT NULL,
  total REAL NOT NULL,
  remarks TEXT NOT NULL,
  location TEXT NOT NULL,
  assigned_to_employee_id TEXT,
  assigned_at TEXT,
  assignment_status TEXT NOT NULL DEFAULT 'returned',
  status TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  is_dirty INTEGER NOT NULL,
  last_modified TEXT NOT NULL,
  last_synced_at TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO products_new (
  id, value_category, article, date, description, par_control_number, property_number,
  unit, unit_value, balance_per_card, on_hand_per_count, total, remarks, location,
  assigned_to_employee_id, assigned_at, assignment_status, status,
  sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
)
SELECT
  id, value_category, article, date, description, par_control_number, property_number,
  unit, unit_value, balance_per_card, on_hand_per_count, total, remarks, location,
  assigned_to_employee_id, assigned_at, assignment_status, status,
  sync_status, is_dirty, last_modified, last_synced_at, deleted_at, COALESCE(version, 1)
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

CREATE TABLE returns_new (
  id TEXT PRIMARY KEY,
  rrsp_number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  return_date TEXT NOT NULL,
  quantity REAL NOT NULL,
  condition TEXT NOT NULL,
  remarks TEXT NOT NULL,
  returned_by_employee_id TEXT NOT NULL,
  returned_by_position TEXT NOT NULL,
  received_date TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  processed_by_employee_id TEXT,
  processed_date TEXT,
  processing_notes TEXT,
  sync_status TEXT NOT NULL,
  is_dirty INTEGER NOT NULL,
  last_modified TEXT NOT NULL,
  last_synced_at TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO returns_new (
  id, rrsp_number, product_id, return_date, quantity, condition, remarks,
  returned_by_employee_id, returned_by_position, received_date, location,
  created_at, status, processed_by_employee_id, processed_date, processing_notes,
  sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
)
SELECT
  id, rrsp_number, product_id, return_date, quantity, condition, remarks,
  returned_by_employee_id, returned_by_position, received_date, location,
  created_at, status, processed_by_employee_id, processed_date, processing_notes,
  sync_status, is_dirty, last_modified, last_synced_at, deleted_at, COALESCE(version, 1)
FROM returns;

DROP TABLE returns;
ALTER TABLE returns_new RENAME TO returns;

CREATE TABLE return_receivers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  employee_id TEXT,
  receiver_name TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL,
  received_date TEXT NOT NULL,
  location TEXT NOT NULL
);

INSERT INTO return_receivers_new (
  id, return_id, employee_id, receiver_name, position, received_date, location
)
SELECT
  id, return_id, employee_id, COALESCE(receiver_name, ''), position, received_date, location
FROM return_receivers;

DROP TABLE return_receivers;
ALTER TABLE return_receivers_new RENAME TO return_receivers;

CREATE TABLE activity_logs_new (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  performed_by_employee_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  is_dirty INTEGER NOT NULL,
  last_modified TEXT NOT NULL,
  last_synced_at TEXT,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO activity_logs_new (
  id, action, entity_type, entity_id, performed_by_employee_id, timestamp,
  details, status, ip_address, sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
)
SELECT
  id, action, entity_type, entity_id, performed_by_employee_id, timestamp,
  details, status, ip_address, sync_status, is_dirty, last_modified, last_synced_at, deleted_at, COALESCE(version, 1)
FROM activity_logs;

DROP TABLE activity_logs;
ALTER TABLE activity_logs_new RENAME TO activity_logs;

CREATE INDEX IF NOT EXISTS idx_products_assigned_to ON products(assigned_to_employee_id);
CREATE INDEX IF NOT EXISTS idx_products_assigned_status ON products(assigned_to_employee_id, assignment_status);
CREATE INDEX IF NOT EXISTS idx_returns_product_id ON returns(product_id);
CREATE INDEX IF NOT EXISTS idx_returns_returned_by ON returns(returned_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_return_receivers_return_id ON return_receivers(return_id);
CREATE INDEX IF NOT EXISTS idx_return_receivers_employee_id ON return_receivers(employee_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id);

COMMIT;

PRAGMA foreign_keys = OFF;
