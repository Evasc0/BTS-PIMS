ALTER TABLE products ADD COLUMN assigned_at TEXT;
ALTER TABLE products ADD COLUMN assignment_status TEXT NOT NULL DEFAULT 'returned';

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
WHERE 1 = 1;

CREATE INDEX IF NOT EXISTS idx_products_assigned_status ON products(assigned_to_employee_id, assignment_status);

