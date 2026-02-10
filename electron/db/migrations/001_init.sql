PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  location TEXT NOT NULL,
  two_factor_enabled INTEGER NOT NULL,
  email_notifications INTEGER NOT NULL,
  low_stock_alerts INTEGER NOT NULL,
  language TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  is_dirty INTEGER NOT NULL,
  last_modified TEXT NOT NULL,
  last_synced_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
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
  status TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  is_dirty INTEGER NOT NULL,
  last_modified TEXT NOT NULL,
  last_synced_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (assigned_to_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS returns (
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
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (returned_by_employee_id) REFERENCES employees(id),
  FOREIGN KEY (processed_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS return_receivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  position TEXT NOT NULL,
  received_date TEXT NOT NULL,
  location TEXT NOT NULL,
  FOREIGN KEY (return_id) REFERENCES returns(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
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
  FOREIGN KEY (performed_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  system_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  date_format TEXT NOT NULL,
  maintenance_mode INTEGER NOT NULL,
  notifications_low_stock INTEGER NOT NULL,
  notifications_new_return INTEGER NOT NULL,
  notifications_return_approved INTEGER NOT NULL,
  notifications_employee_added INTEGER NOT NULL,
  notifications_system_updates INTEGER NOT NULL,
  password_policy TEXT NOT NULL,
  session_timeout_minutes INTEGER NOT NULL,
  max_login_attempts INTEGER NOT NULL,
  require_two_factor INTEGER NOT NULL,
  ip_whitelist_enabled INTEGER NOT NULL,
  backup_frequency TEXT NOT NULL,
  last_backup_at TEXT NOT NULL,
  smtp_server TEXT NOT NULL,
  smtp_port TEXT NOT NULL,
  smtp_encryption TEXT NOT NULL,
  smtp_from_email TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_rate_limit INTEGER NOT NULL,
  api_enabled INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  next_retry_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_assigned_to ON products(assigned_to_employee_id);
CREATE INDEX IF NOT EXISTS idx_returns_product_id ON returns(product_id);
CREATE INDEX IF NOT EXISTS idx_returns_returned_by ON returns(returned_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON sync_outbox(entity_type, entity_id);
