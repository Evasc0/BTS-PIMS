import Dexie, { Table } from 'dexie';
import type { ActivityLog, Employee, Product, ReturnRecord, SystemSettings } from './types';
import { createPasswordHash, regenerateApiKey } from './security';
import { createId, nowIso } from './utils';

class InventoryDatabase extends Dexie {
  employees!: Table<Employee, string>;
  products!: Table<Product, string>;
  returns!: Table<ReturnRecord, string>;
  activityLogs!: Table<ActivityLog, string>;
  settings!: Table<SystemSettings, string>;

  constructor() {
    super('bts-inventory-db');
    this.version(1).stores({
      employees: 'id, email, role, status',
      products: 'id, valueCategory, article, parControlNumber, propertyNumber, status, assignedToEmployeeId',
      returns: 'id, rrspNumber, productId, returnDate, status, returnedByEmployeeId',
      activityLogs: 'id, action, entityType, entityId, performedByEmployeeId, timestamp',
      settings: 'id'
    });
  }
}

export const db = new InventoryDatabase();

export const DEFAULT_ADMIN_CREDENTIALS = {
  email: 'admin@local',
  password: 'admin123'
};

const seedAdminIfNeeded = async (): Promise<void> => {
  const count = await db.employees.count();
  if (count > 0) return;

  const { hash, salt } = await createPasswordHash(DEFAULT_ADMIN_CREDENTIALS.password);
  const adminId = createId();
  await db.employees.add({
    id: adminId,
    fullName: 'System Administrator',
    email: DEFAULT_ADMIN_CREDENTIALS.email,
    phone: '',
    department: 'Administration',
    role: 'admin',
    status: 'active',
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: nowIso(),
    location: '',
    twoFactorEnabled: false,
    emailNotifications: false,
    lowStockAlerts: false,
    language: 'English'
  });

  await db.activityLogs.add({
    id: createId(),
    action: 'CREATE',
    entityType: 'employee',
    entityId: adminId,
    performedByEmployeeId: adminId,
    timestamp: nowIso(),
    details: 'Initial admin account created',
    status: 'success',
    ipAddress: 'offline'
  });
};

const seedSettingsIfNeeded = async (): Promise<void> => {
  const count = await db.settings.count();
  if (count > 0) return;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  await db.settings.add({
    id: 'system',
    systemName: 'BTS Property Inventory Management System',
    companyName: '',
    timeZone,
    dateFormat: 'YYYY-MM-DD',
    maintenanceMode: false,
    notificationsLowStock: false,
    notificationsNewReturn: false,
    notificationsReturnApproved: false,
    notificationsEmployeeAdded: false,
    notificationsSystemUpdates: false,
    passwordPolicy: 'medium',
    sessionTimeoutMinutes: 30,
    maxLoginAttempts: 5,
    requireTwoFactor: false,
    ipWhitelistEnabled: false,
    backupFrequency: 'monthly',
    lastBackupAt: '',
    smtpServer: '',
    smtpPort: '',
    smtpEncryption: 'TLS',
    smtpFromEmail: '',
    apiKey: regenerateApiKey(),
    apiRateLimit: 100,
    apiEnabled: false
  });
};

export const initializeDatabase = async (): Promise<void> => {
  if (!db.isOpen()) {
    await db.open();
  }
  await seedAdminIfNeeded();
  await seedSettingsIfNeeded();
};
