import { createHash, randomBytes, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { EmployeeRole, EmployeeStatus } from '../shared/types';
import { dataStore } from '../db';
import { decryptLocalSecret, encryptLocalSecret, hashSessionToken } from './localSecrets';
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

export type RefreshSessionResult =
  | { success: true; refreshed: boolean; accessToken: string; expiresAt: string | null }
  | { success: false; error: string; requiresInternet?: boolean };
export type ChangePasswordResult =
  | { success: true; accessToken: string; expiresAt: string | null }
  | { success: false; error: string; requiresInternet?: boolean };
export type ChangeEmailResult = { success: true } | { success: false; error: string; requiresInternet?: boolean };
export type AdminUpdateEmailResult = { success: true } | { success: false; error: string; requiresInternet?: boolean };
export type AdminResetPasswordResult = { success: true } | { success: false; error: string; requiresInternet?: boolean };

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
  supabase_refresh_token_enc: string | null;
}

interface CachedSupabaseSession {
  accessToken: string;
  expiresAtMs: number | null;
  refreshToken: string | null;
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

const setCachedSession = (
  userId: string,
  accessToken: string,
  expiresAt?: string | null,
  refreshToken?: string | null
): void => {
  if (!userId || !accessToken) return;
  const existing = sessionCache.get(userId);
  sessionCache.set(userId, {
    accessToken,
    expiresAtMs: parseExpiryMs(expiresAt),
    refreshToken: refreshToken ?? existing?.refreshToken ?? null
  });
};

const getCachedSessionToken = (userId: string): string | null => {
  const cached = sessionCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAtMs != null && cached.expiresAtMs <= Date.now()) {
    if (!cached.refreshToken) {
      sessionCache.delete(userId);
    }
    return null;
  }
  return cached.accessToken;
};

const getStoredRefreshToken = (db: Database.Database, userId: string): string | null => {
  const row = db
    .prepare('SELECT supabase_refresh_token_enc FROM employees WHERE id = ? AND deleted_at IS NULL')
    .get(userId) as { supabase_refresh_token_enc?: string | null } | undefined;
  return decryptLocalSecret(row?.supabase_refresh_token_enc ?? null);
};

const setStoredRefreshToken = (db: Database.Database, userId: string, refreshToken: string | null): void => {
  db.prepare('UPDATE employees SET supabase_refresh_token_enc = ? WHERE id = ?').run(
    refreshToken ? encryptLocalSecret(refreshToken) : null,
    userId
  );
};
const validatePasswordStrength = (password: string): string | null => {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/u.test(value)) return 'Password must include at least one lowercase letter.';
  if (!/[A-Z]/u.test(value)) return 'Password must include at least one uppercase letter.';
  if (!/[0-9]/u.test(value)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/u.test(value)) return 'Password must include at least one special character.';
  return null;
};

const refreshCachedSessionToken = async (userId: string): Promise<RefreshSessionResult> => {
  const db = dataStore.getDb();
  const cached = sessionCache.get(userId);
  const refreshToken = cached?.refreshToken || getStoredRefreshToken(db, userId);
  if (!refreshToken) {
    return { success: false, error: 'No refresh token available. Sign in online once on this device.' };
  }

  try {
    const refreshed = await supabaseAuth.refreshAccessToken(refreshToken);
    const nextRefreshToken = refreshed.refreshToken || refreshToken;
    setCachedSession(userId, refreshed.accessToken, refreshed.expiresAt, nextRefreshToken);
    setStoredRefreshToken(db, userId, nextRefreshToken);
    return {
      success: true,
      refreshed: true,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt
    };
  } catch (error: unknown) {
    const message = normalizeLoginError(error);
    if (isConnectivityError(message)) {
      return {
        success: false,
        error: 'Internet connection required to refresh your session.',
        requiresInternet: true
      };
    }
    if (message.toLowerCase().includes('refresh token') || message.toLowerCase().includes('invalid grant')) {
      setStoredRefreshToken(db, userId, null);
      sessionCache.delete(userId);
    }
    return { success: false, error: message };
  }
};

const deriveFullName = (email: string): string => {
  const username = email.split('@')[0] || 'User';
  return username.replace(/[._-]+/gu, ' ').trim() || 'User';
};
const splitFullName = (fullName: string): { firstName: string; lastName: string } => {
  const normalized = String(fullName || '').trim();
  if (!normalized) return { firstName: '', lastName: '' };
  const [firstName, ...rest] = normalized.split(/\s+/u);
  return {
    firstName: firstName || '',
    lastName: rest.join(' ')
  };
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
        id, first_name, last_name, full_name, email, phone, position, department, address, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @first_name, @last_name, @full_name, @email, @phone, @position, @department, @address, @role, @status, @password_hash, @password_salt,
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
    `
  ).run({
    id: employeeId,
    first_name: splitFullName(deriveFullName(input.email)).firstName,
    last_name: splitFullName(deriveFullName(input.email)).lastName,
    full_name: deriveFullName(input.email),
    email: input.email,
    phone: '',
    position: '',
    department: '',
    address: '',
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
    position: string;
    department: string;
    address: string;
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
  const splitName = splitFullName(input.fullName);
  db.prepare(
    `
      INSERT INTO employees (
        id, first_name, last_name, full_name, email, phone, position, department, address, role, status, password_hash, password_salt,
        supabase_user_id, auth_sync_status, auth_last_error, pending_password_enc, provisioned_at,
        last_verified_at, verification_expires_at, hashed_session_token,
        created_at, location, two_factor_enabled, email_notifications, low_stock_alerts, language,
        sync_status, is_dirty, last_modified, last_synced_at, deleted_at, version
      ) VALUES (
        @id, @first_name, @last_name, @full_name, @email, @phone, @position, @department, @address, @role, @status, @password_hash, @password_salt,
        @supabase_user_id, @auth_sync_status, @auth_last_error, @pending_password_enc, @provisioned_at,
        @last_verified_at, @verification_expires_at, @hashed_session_token,
        @created_at, @location, @two_factor_enabled, @email_notifications, @low_stock_alerts, @language,
        @sync_status, @is_dirty, @last_modified, @last_synced_at, @deleted_at, @version
      )
    `
  ).run({
    id: input.employeeId,
    first_name: splitName.firstName,
    last_name: splitName.lastName,
    full_name: input.fullName,
    email: input.email,
    phone: input.phone,
    position: input.position,
    department: input.department,
    address: input.address,
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
  const resolvedRole = normalizeRole(online.role || employee.role);
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

  let profileWarning: string | undefined;
  try {
    await supabaseAuth.upsertAppUserStatus({
      adminAccessToken: online.accessToken,
      supabaseUserId: online.supabaseUserId,
      employeeId: employee.id,
      email: (online.email || employee.email || '').trim().toLowerCase(),
      role: resolvedRole,
      status: remoteStatus
    });
  } catch (error: unknown) {
    const message = normalizeLoginError(error);
    profileWarning = `Supabase app_users sync warning: ${message}`;
  }

  const verifiedAt = nowIso();
  const expiresAt = new Date(Date.now() + AUTH_VERIFICATION_DAYS * DAY_MS).toISOString();
  updateAuthVerificationCache(db, {
    employeeId: employee.id,
    supabaseUserId: online.supabaseUserId,
    role: resolvedRole,
    status: remoteStatus,
    authSyncStatus: 'synced',
    authLastError: null,
    pendingPasswordEnc: null,
    provisionedAt: employee.provisioned_at || verifiedAt,
    lastVerifiedAt: verifiedAt,
    verificationExpiresAt: expiresAt,
    hashedSessionToken: hashSessionToken(online.accessToken)
  });

  setCachedSession(employee.id, online.accessToken, online.expiresAt, online.refreshToken);
  setStoredRefreshToken(db, employee.id, online.refreshToken);

  return {
    success: true,
    userId: employee.id,
    verifiedOnline: true,
    verificationExpiresAt: expiresAt,
    warning: profileWarning,
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
    position?: string;
    department?: string;
    address?: string;
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

    let adminAccessToken = getCachedSessionToken(input.adminUserId);
    if (!adminAccessToken) {
      const refreshed = await refreshCachedSessionToken(input.adminUserId);
      if (!refreshed.success) {
        const failure = refreshed as Extract<RefreshSessionResult, { success: false }>;
        return {
          success: false,
          error: failure.error || 'Internet connection required to create user.',
          requiresInternet: failure.requiresInternet ?? true
        };
      }
      adminAccessToken = refreshed.accessToken;
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
        position: (input.position || '').trim(),
        department: (input.department || '').trim(),
        address: (input.address || '').trim(),
        role,
        status,
        password,
        supabaseUserId: provisioned.supabaseUserId,
        location: input.location || input.address,
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

  async refreshSession(userId: string, options?: { forceRefresh?: boolean }): Promise<RefreshSessionResult> {
    const db = dataStore.getDb();
    const employee = getEmployeeById(db, userId);
    if (!employee) {
      return { success: false, error: 'User profile not found locally.' };
    }
    if (normalizeStatus(employee.status) !== 'active') {
      return { success: false, error: 'Account is inactive. Contact administrator.' };
    }
    if (!supabaseAuth.isConfigured()) {
      return {
        success: false,
        error: 'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    const forceRefresh = Boolean(options?.forceRefresh);
    const cachedToken = forceRefresh ? null : getCachedSessionToken(userId);
    if (cachedToken) {
      return {
        success: true,
        refreshed: false,
        accessToken: cachedToken,
        expiresAt: null
      };
    }

    return refreshCachedSessionToken(userId);
  },

  async changeOwnPassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<ChangePasswordResult> {
    const db = dataStore.getDb();
    const employee = getEmployeeById(db, input.userId);
    if (!employee) {
      return { success: false, error: 'User profile was not found locally.' };
    }
    if (normalizeStatus(employee.status) !== 'active') {
      return { success: false, error: 'Account is inactive. Contact administrator.' };
    }
    if (!supabaseAuth.isConfigured()) {
      return {
        success: false,
        error: 'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    const currentPassword = String(input.currentPassword || '');
    const newPassword = String(input.newPassword || '');
    if (!currentPassword || !newPassword) {
      return { success: false, error: 'Current password and new password are required.' };
    }
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      return { success: false, error: strengthError };
    }
    if (currentPassword === newPassword) {
      return { success: false, error: 'New password must be different from your current password.' };
    }

    try {
      const verifiedSession = await supabaseAuth.onlineLogin(employee.email, currentPassword);
      await supabaseAuth.updateUserPassword(verifiedSession.accessToken, newPassword);
      const refreshedSession = await supabaseAuth.onlineLogin(employee.email, newPassword);
      const verifiedAt = nowIso();
      const expiresAt = new Date(Date.now() + AUTH_VERIFICATION_DAYS * DAY_MS).toISOString();
      const { hash, salt } = createPasswordHash(newPassword);

      db.prepare(
        `
          UPDATE employees
          SET
            password_hash = @password_hash,
            password_salt = @password_salt,
            auth_sync_status = 'synced',
            auth_last_error = NULL,
            pending_password_enc = NULL,
            last_verified_at = @last_verified_at,
            verification_expires_at = @verification_expires_at,
            hashed_session_token = @hashed_session_token
          WHERE id = @id
        `
      ).run({
        id: employee.id,
        password_hash: hash,
        password_salt: salt,
        last_verified_at: verifiedAt,
        verification_expires_at: expiresAt,
        hashed_session_token: hashSessionToken(refreshedSession.accessToken)
      });

      setCachedSession(employee.id, refreshedSession.accessToken, refreshedSession.expiresAt, refreshedSession.refreshToken);
      setStoredRefreshToken(db, employee.id, refreshedSession.refreshToken);

      return {
        success: true,
        accessToken: refreshedSession.accessToken,
        expiresAt: refreshedSession.expiresAt
      };
    } catch (error: unknown) {
      const message = normalizeLoginError(error);
      if (isInvalidCredentialsError(message)) {
        return { success: false, error: 'Current password is incorrect.' };
      }
      if (isConnectivityError(message)) {
        return {
          success: false,
          error: 'Internet connection required to update your password.',
          requiresInternet: true
        };
      }
      return { success: false, error: message };
    }
  },

  async changeOwnEmail(input: { userId: string; newEmail: string }): Promise<ChangeEmailResult> {
    const db = dataStore.getDb();
    const employee = getEmployeeById(db, input.userId);
    if (!employee) {
      return { success: false, error: 'User profile was not found locally.' };
    }
    if (normalizeStatus(employee.status) !== 'active') {
      return { success: false, error: 'Account is inactive. Contact administrator.' };
    }
    if (!supabaseAuth.isConfigured()) {
      return {
        success: false,
        error: 'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }

    const normalizedEmail = String(input.newEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return { success: false, error: 'New email is required.' };
    }
    if (normalizedEmail === String(employee.email || '').trim().toLowerCase()) {
      return { success: true };
    }

    try {
      const refreshed = await authService.refreshSession(employee.id, { forceRefresh: true });
      if (!refreshed.success) {
        const failure = refreshed as Extract<RefreshSessionResult, { success: false }>;
        return {
          success: false,
          error: failure.error || 'Internet connection required to update your email.',
          requiresInternet: failure.requiresInternet
        };
      }

      await supabaseAuth.updateUserEmail(refreshed.accessToken, normalizedEmail);

      let resolvedSupabaseUserId = String(employee.supabase_user_id || '').trim();
      if (!resolvedSupabaseUserId) {
        try {
          const currentUser = await supabaseAuth.getCurrentUser(refreshed.accessToken);
          resolvedSupabaseUserId = currentUser.id;
          if (resolvedSupabaseUserId) {
            db
              .prepare('UPDATE employees SET supabase_user_id = ? WHERE id = ? AND deleted_at IS NULL')
              .run(resolvedSupabaseUserId, employee.id);
          }
        } catch {
          resolvedSupabaseUserId = '';
        }
      }

      if (resolvedSupabaseUserId) {
        try {
          await supabaseAuth.upsertAppUserStatus({
            adminAccessToken: refreshed.accessToken,
            supabaseUserId: resolvedSupabaseUserId,
            employeeId: employee.id,
            email: normalizedEmail,
            role: normalizeRole(employee.role),
            status: normalizeStatus(employee.status)
          });
        } catch {
          // Email update already succeeded in auth; keep app_users upsert best-effort.
        }
      }
      return { success: true };
    } catch (error: unknown) {
      const message = normalizeLoginError(error);
      if (message.toLowerCase().includes('user from sub claim in jwt does not exist')) {
        authService.clearLocalSessionCache(employee.id);
        return {
          success: false,
          error: 'Session became invalid after email update. Please sign in again online, then retry.'
        };
      }
      if (isConnectivityError(message)) {
        return {
          success: false,
          error: 'Internet connection required to update your email.',
          requiresInternet: true
        };
      }
      return { success: false, error: message };
    }
  },

  async adminUpdateEmployeeEmail(input: {
    adminUserId: string;
    targetEmployeeId: string;
    newEmail: string;
  }): Promise<AdminUpdateEmailResult> {
    const db = dataStore.getDb();
    const admin = getEmployeeById(db, input.adminUserId);
    if (!admin || normalizeStatus(admin.status) !== 'active' || normalizeRole(admin.role) !== 'system_admin') {
      return { success: false, error: 'Only active system admin accounts can update employee email.' };
    }

    const targetEmployeeId = String(input.targetEmployeeId || '').trim();
    if (!targetEmployeeId) {
      return { success: false, error: 'Target employee id is required.' };
    }
    const target = getEmployeeById(db, targetEmployeeId);
    if (!target) {
      return { success: false, error: 'Target employee profile was not found locally.' };
    }

    const normalizedEmail = String(input.newEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return { success: false, error: 'New email is required.' };
    }
    if (normalizedEmail === String(target.email || '').trim().toLowerCase()) {
      return { success: true };
    }
    if (!supabaseAuth.isConfigured()) {
      return {
        success: false,
        error: 'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }
    if (!target.supabase_user_id) {
      return {
        success: false,
        error: 'Employee is not linked to Supabase Auth yet. Re-provision this account first.'
      };
    }

    const refreshedAdminSession = await authService.refreshSession(admin.id, { forceRefresh: true });
    if (!refreshedAdminSession.success) {
      const failure = refreshedAdminSession as Extract<RefreshSessionResult, { success: false }>;
      return {
        success: false,
        error: failure.error || 'Internet connection required to update employee email.',
        requiresInternet: failure.requiresInternet
      };
    }
    const adminAccessToken = refreshedAdminSession.accessToken;

    try {
      await supabaseAuth.adminUpdateUserEmail({
        supabaseUserId: target.supabase_user_id,
        newEmail: normalizedEmail
      });

      try {
        await supabaseAuth.upsertAppUserStatus({
          adminAccessToken,
          supabaseUserId: target.supabase_user_id,
          employeeId: target.id,
          email: normalizedEmail,
          role: normalizeRole(target.role),
          status: normalizeStatus(target.status)
        });
      } catch {
        // Email update already succeeded in auth; keep app_users upsert best-effort.
      }

      return { success: true };
    } catch (error: unknown) {
      const message = normalizeLoginError(error);
      if (isConnectivityError(message)) {
        return {
          success: false,
          error: 'Internet connection required to update employee email.',
          requiresInternet: true
        };
      }
      return { success: false, error: message };
    }
  },

  async adminResetEmployeePassword(input: {
    adminUserId: string;
    targetEmployeeId: string;
    newPassword: string;
  }): Promise<AdminResetPasswordResult> {
    const db = dataStore.getDb();
    const admin = getEmployeeById(db, input.adminUserId);
    if (!admin || normalizeStatus(admin.status) !== 'active' || normalizeRole(admin.role) !== 'system_admin') {
      return { success: false, error: 'Only active system admin accounts can reset employee passwords.' };
    }

    const targetEmployeeId = String(input.targetEmployeeId || '').trim();
    if (!targetEmployeeId) {
      return { success: false, error: 'Target employee id is required.' };
    }
    if (targetEmployeeId === admin.id) {
      return { success: false, error: 'Use the Profile page to change your own password.' };
    }

    const target = getEmployeeById(db, targetEmployeeId);
    if (!target) {
      return { success: false, error: 'Target employee profile was not found locally.' };
    }
    if (normalizeRole(target.role) !== 'employee') {
      return { success: false, error: 'Use the Profile page to change another admin password.' };
    }

    const newPassword = String(input.newPassword || '');
    if (!newPassword) {
      return { success: false, error: 'New password is required.' };
    }
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      return { success: false, error: strengthError };
    }

    if (!supabaseAuth.isConfigured()) {
      return {
        success: false,
        error: 'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      };
    }
    if (!target.supabase_user_id) {
      return {
        success: false,
        error: 'Employee is not linked to Supabase Auth yet. Re-provision this account first.'
      };
    }

    try {
      await supabaseAuth.adminResetUserPassword({
        supabaseUserId: target.supabase_user_id,
        newPassword
      });

      const { hash, salt } = createPasswordHash(newPassword);
      const verifiedAt = nowIso();
      const expiresAt = new Date(Date.now() + AUTH_VERIFICATION_DAYS * DAY_MS).toISOString();

      dataStore.employees.update(target.id, {
        passwordHash: hash,
        passwordSalt: salt,
        authSyncStatus: 'synced',
        authLastError: undefined,
        pendingPasswordPlain: undefined,
        pendingPasswordEncrypted: undefined,
        lastVerifiedAt: verifiedAt,
        verificationExpiresAt: expiresAt
      });

      setStoredRefreshToken(db, target.id, null);
      sessionCache.delete(target.id);
      return { success: true };
    } catch (error: unknown) {
      const message = normalizeLoginError(error);
      if (isConnectivityError(message)) {
        return {
          success: false,
          error: 'Internet connection required to reset employee password.',
          requiresInternet: true
        };
      }
      return { success: false, error: message };
    }
  },

  clearLocalSessionCache(userId: string): void {
    const db = dataStore.getDb();
    updateAuthVerificationCache(db, {
      employeeId: userId,
      hashedSessionToken: null
    });
    setStoredRefreshToken(db, userId, null);
    sessionCache.delete(userId);
  }
};
