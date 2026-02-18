ALTER TABLE return_receivers ADD COLUMN IF NOT EXISTS receiver_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_return_receivers_return_id ON return_receivers(return_id);
CREATE INDEX IF NOT EXISTS idx_return_receivers_employee_id ON return_receivers(employee_id);
