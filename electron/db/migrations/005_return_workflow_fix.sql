-- SQLite versions bundled with some better-sqlite3 builds do not support
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
-- `receiver_name` is already enforced in runtime bootstrap (`ensureCoreSchema`).
SELECT 1;

CREATE INDEX IF NOT EXISTS idx_return_receivers_return_id ON return_receivers(return_id);
CREATE INDEX IF NOT EXISTS idx_return_receivers_employee_id ON return_receivers(employee_id);
