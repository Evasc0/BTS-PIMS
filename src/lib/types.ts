export type EmployeeRole = 'admin' | 'supervisor' | 'employee';
export type EmployeeStatus = 'active' | 'inactive';

export interface Employee {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  department: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  location: string;
  twoFactorEnabled: boolean;
  emailNotifications: boolean;
  lowStockAlerts: boolean;
  language: string;
}

export type ValueCategory = 'LV' | 'MV' | 'HV';
export type ProductStatus = 'available' | 'assigned' | 'returned';

export interface Product {
  id: string;
  valueCategory: ValueCategory;
  article: string;
  date: string;
  description: string;
  parControlNumber: string;
  propertyNumber: string;
  unit: string;
  unitValue: number;
  balancePerCard: number;
  onHandPerCount: number;
  total: number;
  remarks: string;
  assignedToEmployeeId?: string;
  status: ProductStatus;
}

export type ReturnCondition =
  | 'functional'
  | 'destroyed'
  | 'for disposal'
  | 'need repair'
  | 'damaged';

export type ReturnStatus = 'pending' | 'approved' | 'rejected';

export interface ReturnReceiverEntry {
  employeeId: string;
  position: EmployeeRole;
  receivedDate: string;
  location: string;
}

export interface ReturnRecord {
  id: string;
  rrspNumber: string;
  productId: string;
  returnDate: string;
  quantity: number;
  condition: ReturnCondition;
  remarks: string;
  returnedByEmployeeId: string;
  returnedByPosition: EmployeeRole;
  receivedDate: string;
  location: string;
  receivedByEmployeeIds: string[];
  receivedByEntries: ReturnReceiverEntry[];
  createdAt: string;
  status: ReturnStatus;
  processedByEmployeeId?: string;
  processedDate?: string;
  processingNotes?: string;
}

export type ActivityEntityType = 'employee' | 'product' | 'return' | 'sync';

export interface ActivityLog {
  id: string;
  action: string;
  entityType: ActivityEntityType;
  entityId: string;
  performedByEmployeeId: string;
  timestamp: string;
  details: string;
  status: 'success' | 'warning' | 'error';
  ipAddress: string;
}

export type PasswordPolicy = 'strong' | 'medium' | 'basic';
export type BackupFrequency = 'daily' | 'weekly' | 'monthly';
export type SmtpEncryption = 'TLS' | 'SSL' | 'None';

export interface SystemSettings {
  id: string;
  systemName: string;
  companyName: string;
  timeZone: string;
  dateFormat: string;
  maintenanceMode: boolean;
  notificationsLowStock: boolean;
  notificationsNewReturn: boolean;
  notificationsReturnApproved: boolean;
  notificationsEmployeeAdded: boolean;
  notificationsSystemUpdates: boolean;
  passwordPolicy: PasswordPolicy;
  sessionTimeoutMinutes: number;
  maxLoginAttempts: number;
  requireTwoFactor: boolean;
  ipWhitelistEnabled: boolean;
  backupFrequency: BackupFrequency;
  lastBackupAt: string;
  smtpServer: string;
  smtpPort: string;
  smtpEncryption: SmtpEncryption;
  smtpFromEmail: string;
  apiKey: string;
  apiRateLimit: number;
  apiEnabled: boolean;
}
