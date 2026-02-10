import type { ActivityLog, Employee, Product, ReturnRecord, SystemSettings } from './lib/types';

declare global {
  interface Window {
    api?: {
      db: {
        initialize: () => Promise<void>;
        onChanged: (callback: (payload: { table: string; ids: string[] }) => void) => () => void;
        employees: {
          list: () => Promise<Employee[]>;
          get: (id: string) => Promise<Employee | undefined>;
          add: (record: Employee) => Promise<void>;
          update: (id: string, changes: Partial<Employee>) => Promise<void>;
          delete: (id: string) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<Employee | undefined>;
          count: () => Promise<number>;
        };
        products: {
          list: () => Promise<Product[]>;
          get: (id: string) => Promise<Product | undefined>;
          add: (record: Product) => Promise<void>;
          update: (id: string, changes: Partial<Product>) => Promise<void>;
          delete: (id: string) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<Product | undefined>;
        };
        returns: {
          list: () => Promise<ReturnRecord[]>;
          get: (id: string) => Promise<ReturnRecord | undefined>;
          add: (record: ReturnRecord) => Promise<void>;
          update: (id: string, changes: Partial<ReturnRecord>) => Promise<void>;
          delete: (id: string) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<ReturnRecord | undefined>;
        };
        activityLogs: {
          list: () => Promise<ActivityLog[]>;
          get: (id: string) => Promise<ActivityLog | undefined>;
          add: (record: ActivityLog) => Promise<void>;
        };
        settings: {
          get: (id: string) => Promise<SystemSettings | undefined>;
          put: (record: SystemSettings) => Promise<void>;
          findBy: (field: string, value: unknown) => Promise<SystemSettings | undefined>;
          list: () => Promise<SystemSettings[]>;
          add: (record: SystemSettings) => Promise<void>;
          update: (id: string, changes: Partial<SystemSettings>) => Promise<void>;
          delete: (id: string) => Promise<void>;
        };
      };
      migration: {
        importLegacyDump: (dump: unknown) => Promise<void>;
      };
      sync: {
        trigger: () => Promise<void>;
      };
      update: {
        check: () => Promise<void>;
        install: () => Promise<void>;
        onDownloaded: (callback: () => void) => () => void;
        onError: (callback: (message: string) => void) => () => void;
      };
      system: {
        version: () => Promise<string>;
      };
    };
  }
}

export {};
