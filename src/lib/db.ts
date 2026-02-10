import type { ActivityLog, Employee, Product, ReturnRecord, SystemSettings } from './types';

export const DEFAULT_ADMIN_CREDENTIALS = {
  email: 'admin@local',
  password: 'admin123'
};

type TableApi<T> = {
  list: () => Promise<T[]>;
  get: (id: string) => Promise<T | undefined>;
  add: (record: T) => Promise<void>;
  update?: (id: string, changes: Partial<T>) => Promise<void>;
  delete?: (id: string) => Promise<void>;
  findBy?: (field: string, value: unknown) => Promise<T | undefined>;
  count?: () => Promise<number>;
  put?: (record: T) => Promise<void>;
};

type TableWrapper<T> = {
  toArray: () => Promise<T[]>;
  get: (id: string) => Promise<T | undefined>;
  add: (record: T) => Promise<void>;
  update: (id: string, changes: Partial<T>) => Promise<void>;
  delete: (id: string) => Promise<void>;
  count: () => Promise<number>;
  put: (record: T) => Promise<void>;
  where: (field: string) => { equals: (value: unknown) => { first: () => Promise<T | undefined> } };
};

let isOpen = false;

const ensureApi = () => {
  if (!window.api?.db) {
    throw new Error('Database API is not available. Ensure the app is running in Electron.');
  }
  return window.api.db;
};

const makeTable = <T>(tableApi: TableApi<T>): TableWrapper<T> => ({
  toArray: () => tableApi.list(),
  get: (id: string) => tableApi.get(id),
  add: (record: T) => tableApi.add(record),
  update: (id: string, changes: Partial<T>) => (tableApi.update ? tableApi.update(id, changes) : Promise.resolve()),
  delete: (id: string) => (tableApi.delete ? tableApi.delete(id) : Promise.resolve()),
  count: () => (tableApi.count ? tableApi.count() : Promise.resolve(0)),
  put: (record: T) => (tableApi.put ? tableApi.put(record) : Promise.resolve()),
  where: (field: string) => ({
    equals: (value: unknown) => ({
      first: () => (tableApi.findBy ? tableApi.findBy(field, value) : Promise.resolve(undefined))
    })
  })
});

export const db = {
  employees: makeTable<Employee>(ensureApi().employees),
  products: makeTable<Product>(ensureApi().products),
  returns: makeTable<ReturnRecord>(ensureApi().returns),
  activityLogs: makeTable<ActivityLog>(ensureApi().activityLogs),
  settings: makeTable<SystemSettings>(ensureApi().settings),
  isOpen: () => isOpen,
  open: async () => {
    await ensureApi().initialize();
    isOpen = true;
  }
};

export const initializeDatabase = async (): Promise<void> => {
  await db.open();
};
