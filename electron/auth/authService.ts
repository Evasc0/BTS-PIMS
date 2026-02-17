import { createHash, randomBytes, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { EmployeeRole, EmployeeStatus } from '../shared/types';
import { dataStore } from '../db';
import { hashSessionToken } from './localSecrets';
import { supabaseAuth } from './supabaseAuth';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTH_VERIFICATION_DAYS = Math.max(1, Number(process.env.AUTH_VERIFICATION_DAYS || 30));

type LoginFailure = { success: false; error: string; requiresInternet?: boolean };
type LoginSuccess = {
  success: true;
  userId: string;
  verifiedOnline: boolean;
  verificationExpiresAt: string | null;
  provisioning?: ProvisioningSummary;
  warning?: string;
  sessionAccessToken?: string;
  sessionAccessTokenExpiresAt?: string | null;
};

export type OfflineFirstLoginResult = LoginSuccess | LoginFailure;

export interface ProvisioningSummary {
  processed: number;
  synced: number;
  failed: number;
  failures: Array<{ employeeId: string; email: string; reason: string }>;
}

export type InstantUserCreateResult =
  | { success: true; employeeId: string }
  | { success: false; error: string; requiresInternet?: boolean };

interface EmployeeRow {
  id: string;
  full_name: string;
  email: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  password_hash: string;
  password_salt: string;
  supabase_user_id: string | null;
  auth_sync_status: string | null;
  auth_last_error: string | null;
  pending_password_enc: string | null;
  provisioned_at: string | null;
  last_verified_at: string | null;
  verification_expires_at: string | null;
  hashed_session_token: string | null;
}

interface CachedSupabaseSession {
  accessToken: string;
  expiresAtMs: number | null;
}

const sessionCache = new Map<string, CachedSupabaseSession>();

const nowIso = (): string => new Date().toISOString();

const parseIsoMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseExpiryMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isExpired = (value: string | null | undefined): boolean => {
  const parsed = parseIsoMs(value);
  if (parsed == null) return true;
  return parsed < Date.now();
};

const normalizeRole = (value: unknown): EmployeeRole => {
  const role = String(value || '')
    .trim()
    .toLowerCase();
  if (role === 'system_admin' || role === 'admin') return 'system_admin';
  return 'employee';
};

const normalizeStatus = (value: unknown): EmployeeStatus => {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (status === 'inactive') return 'inactive';
  return 'active';
};

const hashWithSalt = (password: string, salt: string): string =>
  createHash('sha256')
    .update(`${salt}:${password}`)
    .digest('base64');

const createPasswordHash = (password: string): { hash: string; salt: string } => {
  const salt = randomBytes(16).toString('base64');
  const hash = hashWithSalt(password, salt);
  return { hash, salt };
};

const verifyLocalPassword = (password: string, storedHash: string, storedSalt: string): boolean => {
  if (!storedHash || !storedSalt) return false;
  return hashWithSalt(password, storedSalt) === storedHash;
};

const normalizeLoginError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || 'Unable to complete online verification.');
  if (!message) return 'Unable to complete online verification.';
  return message;
};

const isConnectivityError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed') ||
    normalized.includes('etimedout') ||
    normalized.includes('enotfound') ||
    normalized.includes('econnreset')
  );
};

const isInvalidCredentialsError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid email') ||
    normalized.includes('invalid password') ||
    normalized.includes('email not confirmed')
  );
};

const getEmployeeByEmail = (db: Database.Database, email: string): EmployeeRow | undefined =>
  db.prepare('SELECT * FROM employees WHERE email = ? AND deleted_at IS NULL').get(email) as EmployeeRow | undefined;

const getEmployeeById = (db: Database.Database, id: string): EmployeeRow | undefined =>
  db.prepare('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL').get(id) as EmployeeRow | undefined;

const getEmployeeBySupabaseUserId = (db: Database.Database, supabaseUserId: string): EmployeeRow | undefined =>
  db
    .prepare('SELECT * FROM employees WHERE supabase_user_id = ? AND deleted_at IS NULL')
    .get(supabaseUserId) as EmployeeRow | undefined;

const setCachedSession = (userId: string, accessToken: string, expiresAt?: string | null): void => {
  if (!userId || !accessToken) return;
  sessionCache.set(userId, {
    accessToken,
    expiresAtMs: parseExpiryMs(expiresAt)
  });
};

const getCachedSessionToken = (userId: string): string | null => {
  const cached = sessionCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAtMs != null && cached.expiresAtMs <= Date.now()) {
    sessionCache.delete(userId);
    return null;
  }
  return cached.accessToken;
};

const deriveFullName = (email: string): string => {
  const username = email.split('@')[0] || 'User';
  return username.replace(/[._-]+/gu, ' ').trim() || 'User';
};

const updateAuthVerificationCache = (
  db: Database.Database,
  input: {
    employeeId: string;
    supabaseUserId?: string | null;
    role?: EmployeeRole;
    status?: EmployeeStatus;
    authSyncStatus?: string;
    authLastError?: string | null;
    pendingPasswordEnc?: string | null;
    provisionedAt?: string | null;
    lastVerifiedAt?: string | null;
    verificationExpiresAt?: string | null;
    hashedSessionToken?: string | null;
  }
): void => {
  db.prepare(
    `
      UPDATE employees
      SET
        supabase_user_id = COALESCE(@supabase_user_id, supabase_user_id),
        role = COALESCE(@role, role),
        status = COALESCE(@status, status),
        auth_sync_status = COALESCE(@auth_sync_status, auth_sync_status),
        auth_last_error = @auth_last_error,
        pending_password_enc = @pending_password_enc,
        provisioned_at = COALESCE(@provisioned_at, provisioned_at),
        last_verified_at = @last_verified_at,
        verification_expires_at = @verification_expires_at,
        hashed_session_token = @hashed_session_token
      WHERE id = @id
    `
  ).run({
    id: input.employeeId,
    supabase_user_id: input.supabaseUserId ?? null,
    role: input.role ?? null,
    status: input.status ?? null,
    auth_sync_status: input.authSyncStatus ?? null,
    auth_last_error: input.authLastError ?? null,
    pending_password_enc: input.pendingPasswordEnc ?? null,
    provisioned_at: input.provisionedAt ?? null,
    last_verified_at: input.lastVerifiedAt ?? null,
    verification_expires_at: input.verificationExpiresAt ?? null,
    hashed_session_token: input.hashedSessionToken ?? null
  });
};

const upsertLocalEmployeeFromOnline = (
  db: Database.Database,
  input: {
    email: string;
    password: string;
    role: EmployeeRole | null;
    status: EmployeeStatus | null;
    supabaseUserId: string;
    profileEmployeeId: string | null;
  }
): EmployeeRow => {
  const existingByEmail = getEmployeeByEmail(db, input.email);
  const existingBySupabase = getEmployeeBySupabaseUserId(db, input.supabaseUserId);
  const existing = existingByEmail || existingBySupabase;
  const role = normalizeRole(input.role || existing?.role || 'employee');
  const status = normalizeStatus(input.status || existing?.status || 'active');
  const employeeId = existing?.id || input.profileEmployeeId || input.supabaseUserId || randomUUID();
  const { hash, salt } = createPasswordHash(input.password);
  const now = nowIso();

  if (existing) {
    db.prepare(
      `
        UPDATE employees
        SET
          email = @email,
          role = @role,
          status = @status,
          password_hash = @password_hash,
          password_salt = @password_salt,
          supabase_user_id = @supabase_user_id,
          auth_sync_status = 'synced',
          auth_last_error = NULL,
          pending_password_enc = NULL,
          provisioned_at = COALESCE(provisioned_at, @provisioned_at),
          sync_status = 'synced',
          is_dirty = 0,
          last_modified = @last_modified,
          last_synced_at = @last_synced_at,
          deleted_at = NULL
        WHERE id = @id
      `
    ).run({
      id: existing.id,
      email: input.email,
      role,
      status,
      password_hash: hash,
      password_salt: salt,
      supabase_user_id: input.supabaseUserId,
      provisioned_at: now,
      last_modified: now,
      last_synced_at: now
    });

    return getEmployeeById(db, existing.id) as EmployeeRow;
  }

  db.prepare(
    `
      INSERT INTO employees (
        id, full_name, email, phone, department, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @full_name, @email, @phone, @department, @role, @status, @password_hash, @password_salt,
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
    `
  ).run({
    id: employeeId,
    full_name: deriveFullName(input.email),
    email: input.email,
    phone: '',
    department: '',
    role,
    status,
    password_hash: hash,
    password_salt: salt,
    supabase_user_id: input.supabaseUserId,
    auth_sync_status: 'synced',
    auth_last_error: null,
    pending_password_enc: null,
    provisioned_at: now,
    last_verified_at: null,
    verification_expires_at: null,
    hashed_session_token: null,
    created_at: now,
    location: '',
    two_factor_enabled: 0,
    email_notifications: 0,
    low_stock_alerts: 0,
    language: 'English',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: now,
    last_synced_at: now,
    deleted_at: null,
    version: 1
  });

  return getEmployeeById(db, employeeId) as EmployeeRow;
};

const insertLocalUserProvision = (
  db: Database.Database,
  input: {
    employeeId: string;
    fullName: string;
    email: string;
    phone: string;
    department: string;
    role: EmployeeRole;
    status: EmployeeStatus;
    password: string;
    supabaseUserId: string;
    location?: string | null;
    language?: string | null;
  }
): void => {
  const now = nowIso();
  const { hash, salt } = createPasswordHash(input.password);
  db.prepare(
    `
      INSERT INTO employees (
        id, full_name, email, phone, department, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @full_name, @email, @phone, @department, @role, @status, @password_hash, @password_salt,
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
    `
  ).run({
    id: input.employeeId,
    full_name: input.fullName,
    email: input.email,
    phone: input.phone,
    department: input.department,
    role: input.role,
    status: input.status,
    password_hash: hash,
    password_salt: salt,
    supabase_user_id: input.supabaseUserId,
    auth_sync_status: 'synced',
    auth_last_error: null,
    pending_password_enc: null,
    provisioned_at: now,
    last_verified_at: null,
    verification_expires_at: null,
    hashed_session_token: null,
    created_at: now,
    location: input.location ?? '',
    two_factor_enabled: 0,
    email_notifications: 0,
    low_stock_alerts: 0,
    language: input.language || 'English',
    sync_status: 'synced',
    is_dirty: 0,
    last_modified: now,
    last_synced_at: now,
    deleted_at: null,
    version: 1
  });
};

const requiresOnlineVerification = (employee: EmployeeRow): boolean =>
  !employee.last_verified_at || !employee.verification_expires_at || isExpired(employee.verification_expires_at);

const applyOnlineLogin = async (
  db: Database.Database,
  employee: EmployeeRow,
  online: Awaited<ReturnType<typeof supabaseAuth.onlineLogin>>
): Promise<OfflineFirstLoginResult> => {
  const remoteStatus = normalizeStatus(online.accountStatus || employee.status);
  if (remoteStatus === 'inactive') {
    updateAuthVerificationCache(db, {
      employeeId: employee.id,
      status: 'inactive',
      authLastError: 'Account is inactive in Supabase.',
      lastVerifiedAt: nowIso(),
      verificationExpiresAt: nowIso(),
      hashedSessionToken: null
    });
    return { success: false, error: 'Your account has been deactivated. Contact administrator.' };
  }

  const verifiedAt = nowIso();
  const expiresAt = new Date(Date.now() + AUTH_VERIFICATION_DAYS * DAY_MS).toISOString();
  updateAuthVerificationCache(db, {
    employeeId: employee.id,
    supabaseUserId: online.supabaseUserId,
    role: normalizeRole(online.role || employee.role),
    status: remoteStatus,
    authSyncStatus: 'synced',
    authLastError: null,
    pendingPasswordEnc: null,
    provisionedAt: employee.provisioned_at || verifiedAt,
    lastVerifiedAt: verifiedAt,
    verificationExpiresAt: expiresAt,
    hashedSessionToken: hashSessionToken(online.accessToken)
  });

  setCachedSession(employee.id, online.accessToken, online.expiresAt);

  return {
    success: true,
    userId: employee.id,
    verifiedOnline: true,
    verificationExpiresAt: expiresAt,
    sessionAccessToken: online.accessToken,
    sessionAccessTokenExpiresAt: online.expiresAt
  };
};

const emptyProvisioningSummary = (): ProvisioningSummary => ({
  processed: 0,
  synced: 0,
  failed: 0,
  failures: []
});

export const authService = {
  verificationDays: AUTH_VERIFICATION_DAYS,

  async loginOfflineFirst(input: {
    email: string;
    password: string;
    preferOnline: boolean;
  }): Promise<OfflineFirstLoginResult> {
    const db = dataStore.getDb();
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    if (!email || !password) {
      return { success: false, error: 'Email and password are required.' };
    }

    let employee = getEmployeeByEmail(db, email);
    const localPasswordValid = employee
      ? verifyLocalPassword(password, employee.password_hash, employee.password_salt)
      : false;
    const needsOnline = employee ? requiresOnlineVerification(employee) : true;
    const canTryOnline = Boolean(input.preferOnline && supabaseAuth.isConfigured());

    if (canTryOnline) {
      try {
        const online = await supabaseAuth.onlineLogin(email, password);
        employee = upsertLocalEmployeeFromOnline(db, {
          email,
          password,
          role: online.role,
          status: online.accountStatus,
          supabaseUserId: online.supabaseUserId,
          profileEmployeeId: online.profileEmployeeId
        });
        return applyOnlineLogin(db, employee, online);
      } catch (error: unknown) {
        const message = normalizeLoginError(error);
        const connectivityIssue = isConnectivityError(message);
        const invalidCredentials = isInvalidCredentialsError(message);

        if (employee && normalizeRole(employee.role) === 'system_admin' && !employee.supabase_user_id && invalidCredentials) {
          try {
            const registration = await supabaseAuth.registerUserWithPassword({
              email,
              password,
              employeeId: employee.id,
              role: 'system_admin'
            });
            const online = await supabaseAuth.onlineLogin(email, password);
            try {
              await supabaseAuth.upsertAppUserStatus({
                adminAccessToken: online.accessToken,
                supabaseUserId: registration.supabaseUserId || online.supabaseUserId,
                employeeId: employee.id,
                email,
                role: 'system_admin',
                status: normalizeStatus(employee.status)
              });
            } catch {
              // Metadata upsert is best-effort during bootstrap.
            }
            employee = upsertLocalEmployeeFromOnline(db, {
              email,
              password,
              role: 'system_admin',
              status: normalizeStatus(employee.status),
              supabaseUserId: online.supabaseUserId,
              profileEmployeeId: employee.id
            });
            return applyOnlineLogin(db, employee, online);
          } catch (bootstrapError: unknown) {
            return { success: false, error: normalizeLoginError(bootstrapError) };
          }
        }

        if (!employee || !localPasswordValid || needsOnline) {
          if (connectivityIssue) {
            return {
              success: false,
              error: 'Internet connection required to verify your account.',
              requiresInternet: true
            };
          }
          return { success: false, error: message };
        }

        if (!connectivityIssue) {
          return { success: false, error: message };
        }
      }
    }

    if (!employee) {
      if (!supabaseAuth.isConfigured()) {
        return {
          success: false,
          error:
            'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
        };
      }
      return {
        success: false,
        error: 'Internet connection required to verify your account.',
        requiresInternet: true
      };
    }

    if (!localPasswordValid) {
      return { success: false, error: 'Invalid email or password.' };
    }

    if (normalizeStatus(employee.status) !== 'active') {
      return { success: false, error: 'Account is inactive. Contact an administrator.' };
    }

    if (needsOnline) {
      return {
        success: false,
        error: 'Internet connection required to verify your account.',
        requiresInternet: true
      };
    }

    return {
      success: true,
      userId: employee.id,
      verifiedOnline: false,
      verificationExpiresAt: employee.verification_expires_at
    };
  },

  async createUserInstant(input: {
    adminUserId: string;
    fullName: string;
    email: string;
    phone?: string;
    department?: string;
    role: EmployeeRole;
    status: EmployeeStatus;
    password: string;
    location?: string;
    language?: string;
  }): Promise<InstantUserCreateResult> {
    const db = dataStore.getDb();
    const admin = getEmployeeById(db, input.adminUserId);
    if (!admin || normalizeStatus(admin.status) !== 'active' || normalizeRole(admin.role) !== 'system_admin') {
      return { success: false, error: 'Only active system admin accounts can create users.' };
    }

    const adminAccessToken = getCachedSessionToken(input.adminUserId);
    if (!adminAccessToken) {
      return {
        success: false,
        error: 'Internet connection required to create user.',
        requiresInternet: true
      };
    }

    if (!supabaseAuth.isConfigured()) {
      return {
        success: false,
        error: 'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    const fullName = input.fullName.trim();
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    if (!fullName || !email || !password) {
      return { success: false, error: 'Full name, email, and password are required.' };
    }

    if (getEmployeeByEmail(db, email)) {
      return { success: false, error: 'A user with this email already exists locally.' };
    }

    const role = normalizeRole(input.role);
    const status = normalizeStatus(input.status);
    const employeeId = randomUUID();

    try {
      const provisioned = await supabaseAuth.provisionEmployeeAccount({
        adminAccessToken,
        employeeId,
        email,
        password,
        role,
        status
      });

      insertLocalUserProvision(db, {
        employeeId,
        fullName,
        email,
        phone: (input.phone || '').trim(),
        department: (input.department || '').trim(),
        role,
        status,
        password,
        supabaseUserId: provisioned.supabaseUserId,
        location: input.location,
        language: input.language
      });

      return { success: true, employeeId };
    } catch (error: unknown) {
      const message = normalizeLoginError(error);
      if (isConnectivityError(message)) {
        return {
          success: false,
          error: 'Internet connection required to create user.',
          requiresInternet: true
        };
      }
      return { success: false, error: message };
    }
  },

  async provisionPendingEmployees(_input?: {
    adminUserId: string;
    adminAccessToken: string;
  }): Promise<ProvisioningSummary> {
    return emptyProvisioningSummary();
  },

  clearLocalSessionCache(userId: string): void {
    const db = dataStore.getDb();
    updateAuthVerificationCache(db, {
      employeeId: userId,
      hashedSessionToken: null
    });
    sessionCache.delete(userId);
  }
};
