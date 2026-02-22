import type { EmployeeRole, EmployeeStatus } from '../shared/types';

const getSupabaseUrl = (): string => (process.env.SUPABASE_URL || '').replace(/\/+$/u, '');
const getSupabaseAnonKey = (): string => process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const getSupabaseServiceRoleKey = (): string =>
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  '';
const getAppUsersTable = (): string => process.env.SUPABASE_APP_USERS_TABLE || 'app_users';

const isConfigured = (): boolean => Boolean(getSupabaseUrl() && getSupabaseAnonKey());

const nowIso = (): string => new Date().toISOString();

interface SupabaseSignInResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  user: {
    id: string;
    email?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  };
}

interface AppUserRow {
  user_id: string;
  employee_id: string;
  email: string;
  role: EmployeeRole;
  account_status: EmployeeStatus;
  updated_at: string;
}

export interface OnlineLoginResult {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresInSeconds: number;
  expiresAt: string | null;
  supabaseUserId: string;
  email: string | null;
  role: EmployeeRole | null;
  accountStatus: EmployeeStatus | null;
  profileEmployeeId: string | null;
  profileFound: boolean;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  address: string | null;
  location: string | null;
  language: string | null;
}

interface AuthProfileMetadataInput {
  employeeId: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  position?: string | null;
  department?: string | null;
  address?: string | null;
  location?: string | null;
  language?: string | null;
}

const parseSupabaseError = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text) return `Supabase request failed with status ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error_description?: string; msg?: string; message?: string };
    return parsed.error_description || parsed.msg || parsed.message || text;
  } catch {
    return text;
  }
};

const buildAuthHeaders = (): Record<string, string> => {
  const key = getSupabaseAnonKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'content-type': 'application/json'
  };
};

const buildRestHeaders = (accessToken?: string): Record<string, string> => {
  const key = getSupabaseAnonKey();
  return {
    apikey: key,
    Authorization: `Bearer ${accessToken || key}`,
    'content-type': 'application/json'
  };
};

const buildServiceRoleHeaders = (): Record<string, string> => {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json'
  };
};

const authRequest = async (pathAndQuery: string, init: RequestInit): Promise<Response> => {
  if (!isConfigured()) {
    throw new Error(
      'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
    );
  }

  return fetch(`${getSupabaseUrl()}/auth/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      ...buildAuthHeaders(),
      ...(init.headers as Record<string, string> | undefined)
    }
  });
};

const restRequestAsServiceRole = async (pathAndQuery: string, init: RequestInit): Promise<Response> => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    throw new Error('Supabase auth is not configured. Set SUPABASE_URL first.');
  }
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service-role app_users updates.');
  }

  return fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      ...buildServiceRoleHeaders(),
      ...(init.headers as Record<string, string> | undefined)
    }
  });
};

const restRequest = async (pathAndQuery: string, init: RequestInit, accessToken?: string): Promise<Response> => {
  if (!isConfigured()) {
    throw new Error(
      'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
    );
  }

  return fetch(`${getSupabaseUrl()}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      ...buildRestHeaders(accessToken),
      ...(init.headers as Record<string, string> | undefined)
    }
  });
};

const normalizeRole = (value: unknown): EmployeeRole | null => {
  const role = String(value || '')
    .trim()
    .toLowerCase();
  if (role === 'system_admin') return 'system_admin';
  if (role === 'employee') return 'employee';
  if (role === 'admin') return 'system_admin';
  if (role === 'supervisor') return 'employee';
  return null;
};

const normalizeStatus = (value: unknown): EmployeeStatus | null => {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (status === 'active' || status === 'inactive') return status;
  return null;
};

const normalizeOptionalText = (value: unknown): string | null => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
};

const buildAuthUserMetadata = (input: AuthProfileMetadataInput): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {
    employee_id: input.employeeId,
    app_role: input.role,
    role: input.role,
    account_status: input.status,
    status: input.status
  };

  const addIfPresent = (key: string, value: unknown): void => {
    const normalized = normalizeOptionalText(value);
    if (normalized) metadata[key] = normalized;
  };

  addIfPresent('full_name', input.fullName);
  addIfPresent('first_name', input.firstName);
  addIfPresent('last_name', input.lastName);
  addIfPresent('phone', input.phone);
  addIfPresent('position', input.position);
  addIfPresent('department', input.department);
  addIfPresent('address', input.address);
  addIfPresent('location', input.location);
  addIfPresent('language', input.language);

  return metadata;
};

const fetchAppUserByUserId = async (accessToken: string, userId: string): Promise<AppUserRow | null> => {
  const params = new URLSearchParams();
  params.set('select', 'user_id,employee_id,email,role,account_status,updated_at');
  params.set('user_id', `eq.${userId}`);
  params.set('limit', '1');
  const response = await restRequest(`${getAppUsersTable()}?${params.toString()}`, { method: 'GET' }, accessToken);
  if (!response.ok) {
    throw new Error(await parseSupabaseError(response));
  }
  const rows = (await response.json()) as AppUserRow[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const fetchAppUserByEmail = async (accessToken: string, email: string): Promise<AppUserRow | null> => {
  const params = new URLSearchParams();
  params.set('select', 'user_id,employee_id,email,role,account_status,updated_at');
  params.set('email', `eq.${email.toLowerCase()}`);
  params.set('limit', '1');
  const response = await restRequest(`${getAppUsersTable()}?${params.toString()}`, { method: 'GET' }, accessToken);
  if (!response.ok) {
    throw new Error(await parseSupabaseError(response));
  }
  const rows = (await response.json()) as AppUserRow[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const upsertAppUser = async (
  accessToken: string,
  payload: {
    user_id: string;
    employee_id: string;
    email: string;
    role: EmployeeRole;
    account_status: EmployeeStatus;
  }
): Promise<void> => {
  const response = await restRequest(
    `${getAppUsersTable()}?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify([{ ...payload, updated_at: nowIso() }])
    },
    accessToken
  );

  if (!response.ok) {
    throw new Error(await parseSupabaseError(response));
  }
};

const upsertAppUserWithServiceRole = async (payload: {
  user_id: string;
  employee_id: string;
  email: string;
  role: EmployeeRole;
  account_status: EmployeeStatus;
}): Promise<void> => {
  const response = await restRequestAsServiceRole(`${getAppUsersTable()}?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([{ ...payload, updated_at: nowIso() }])
  });

  if (!response.ok) {
    throw new Error(await parseSupabaseError(response));
  }
};

const signUpWithPassword = async (
  email: string,
  password: string,
  metadata: Record<string, unknown>
): Promise<{ userId: string }> => {
  const response = await authRequest('signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: metadata
    })
  });

  const bodyText = await response.text();
  let parsed: any = {};
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = {};
    }
  }

  if (!response.ok) {
    const message =
      parsed?.error_description || parsed?.msg || parsed?.message || bodyText || `Sign up failed (${response.status})`;
    throw new Error(message);
  }

  const userId = parsed?.user?.id || parsed?.session?.user?.id;
  if (!userId) {
    // Some Supabase auth configurations return a successful signup payload without user.id.
    // Try resolving by signing in immediately with the same credentials.
    try {
      const loginResponse = await authRequest('token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (loginResponse.ok) {
        const loginPayload = (await loginResponse.json()) as SupabaseSignInResponse;
        const resolvedUserId = loginPayload?.user?.id;
        if (resolvedUserId) {
          return { userId: resolvedUserId };
        }
      }
    } catch {
      // ignore and throw detailed message below
    }

    throw new Error(
      'Supabase signup succeeded but returned no user id. Disable Email Confirmations for managed accounts (Auth > Providers > Email) or verify this user manually, then retry.'
    );
  }

  return { userId };
};

export const supabaseAuth = {
  isConfigured,
  isServiceRoleConfigured: (): boolean => Boolean(getSupabaseServiceRoleKey()),

  async onlineLogin(email: string, password: string): Promise<OnlineLoginResult> {
    if (!isConfigured()) {
      throw new Error(
        'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      );
    }

    const response = await authRequest('token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }

    const payload = (await response.json()) as SupabaseSignInResponse;
    const accessToken = payload.access_token;
    const refreshToken = payload.refresh_token || null;
    const expiresIn = Number(payload.expires_in || 0);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const userId = payload?.user?.id;
    if (!userId || !accessToken) {
      throw new Error('Supabase login response is missing session information.');
    }

    let profileByUserId: AppUserRow | null = null;
    let profileByEmail: AppUserRow | null = null;
    try {
      profileByUserId = await fetchAppUserByUserId(accessToken, userId);
      profileByEmail =
        profileByUserId || !payload?.user?.email
          ? null
          : await fetchAppUserByEmail(accessToken, payload.user.email.toLowerCase());
    } catch {
      profileByUserId = null;
      profileByEmail = null;
    }
    const profile = profileByUserId || profileByEmail;
    const metadata = (payload?.user?.user_metadata || {}) as Record<string, unknown>;
    const metadataEmployeeId = normalizeOptionalText(metadata.employee_id ?? metadata.employeeId);
    const metadataRole = normalizeRole(metadata.app_role ?? metadata.role);
    const metadataStatus = normalizeStatus(metadata.account_status ?? metadata.status);
    const metadataFirstName = normalizeOptionalText(metadata.first_name ?? metadata.firstName);
    const metadataLastName = normalizeOptionalText(metadata.last_name ?? metadata.lastName);
    const metadataFullName = normalizeOptionalText(metadata.full_name ?? metadata.fullName);
    const metadataPhone = normalizeOptionalText(metadata.phone);
    const metadataPosition = normalizeOptionalText(metadata.position);
    const metadataDepartment = normalizeOptionalText(metadata.department);
    const metadataAddress = normalizeOptionalText(metadata.address);
    const metadataLocation = normalizeOptionalText(metadata.location);
    const metadataLanguage = normalizeOptionalText(metadata.language);

    const role =
      normalizeRole(profile?.role) ||
      normalizeRole(payload?.user?.app_metadata?.app_role) ||
      metadataRole;
    const accountStatus =
      normalizeStatus(profile?.account_status) ||
      metadataStatus ||
      'active';

    return {
      accessToken,
      refreshToken,
      tokenType: payload.token_type || 'bearer',
      expiresInSeconds: expiresIn,
      expiresAt,
      supabaseUserId: userId,
      email: payload?.user?.email || profile?.email || null,
      role,
      accountStatus,
      profileEmployeeId: profile?.employee_id || metadataEmployeeId || null,
      profileFound: Boolean(profile),
      firstName: metadataFirstName,
      lastName: metadataLastName,
      fullName: metadataFullName,
      phone: metadataPhone,
      position: metadataPosition,
      department: metadataDepartment,
      address: metadataAddress,
      location: metadataLocation,
      language: metadataLanguage
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null }> {
    if (!isConfigured()) {
      throw new Error(
        'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      );
    }

    if (!refreshToken) {
      throw new Error('No refresh token is available for this user session.');
    }

    const response = await authRequest('token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }

    const payload = (await response.json()) as SupabaseSignInResponse;
    const accessToken = payload.access_token;
    const nextRefreshToken = payload.refresh_token || refreshToken;
    const expiresIn = Number(payload.expires_in || 0);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    if (!accessToken) {
      throw new Error('Supabase did not return an access token while refreshing session.');
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt
    };
  },

  async getCurrentUser(accessToken: string): Promise<{ id: string; email: string | null }> {
    if (!isConfigured()) {
      throw new Error(
        'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      );
    }
    if (!accessToken) {
      throw new Error('Missing authenticated access token for current-user lookup.');
    }

    const response = await authRequest('user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }

    const payload = (await response.json()) as { id?: string; email?: string | null };
    const id = String(payload?.id || '').trim();
    if (!id) {
      throw new Error('Supabase user lookup returned no user id.');
    }
    return { id, email: payload?.email ?? null };
  },

  async updateUserPassword(accessToken: string, newPassword: string): Promise<void> {
    if (!isConfigured()) {
      throw new Error(
        'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      );
    }
    if (!accessToken) {
      throw new Error('Missing authenticated access token for password update.');
    }
    const password = String(newPassword || '');
    if (!password) {
      throw new Error('New password is required.');
    }

    const response = await authRequest('user', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }
  },

  async updateUserEmail(accessToken: string, newEmail: string): Promise<void> {
    if (!isConfigured()) {
      throw new Error(
        'Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).'
      );
    }
    if (!accessToken) {
      throw new Error('Missing authenticated access token for email update.');
    }
    const email = String(newEmail || '').trim().toLowerCase();
    if (!email) {
      throw new Error('New email is required.');
    }

    const response = await authRequest('user', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }
  },

  async adminResetUserPassword(input: { supabaseUserId: string; newPassword: string }): Promise<void> {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase auth is not configured. Set SUPABASE_URL first.');
    }
    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin password reset.');
    }
    const supabaseUserId = String(input.supabaseUserId || '').trim();
    if (!supabaseUserId) {
      throw new Error('Target Supabase user id is required.');
    }
    const password = String(input.newPassword || '');
    if (!password) {
      throw new Error('New password is required.');
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`, {
      method: 'PUT',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }
  },

  async adminUpdateUserEmail(input: {
    supabaseUserId: string;
    newEmail: string;
    confirmEmail?: boolean;
  }): Promise<void> {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase auth is not configured. Set SUPABASE_URL first.');
    }
    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin email update.');
    }
    const supabaseUserId = String(input.supabaseUserId || '').trim();
    if (!supabaseUserId) {
      throw new Error('Target Supabase user id is required.');
    }
    const email = String(input.newEmail || '').trim().toLowerCase();
    if (!email) {
      throw new Error('New email is required.');
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`, {
      method: 'PUT',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email,
        email_confirm: input.confirmEmail ?? true
      })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }
  },

  async adminCreateUser(input: {
    email: string;
    password: string;
    employeeId: string;
    role: EmployeeRole;
    status: EmployeeStatus;
    profile?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      position?: string;
      department?: string;
      address?: string;
      location?: string;
      language?: string;
    };
  }): Promise<{ supabaseUserId: string }> {
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      throw new Error('Supabase auth is not configured. Set SUPABASE_URL first.');
    }
    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to create users via service role.');
    }

    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (!email) {
      throw new Error('Email is required.');
    }
    if (!password) {
      throw new Error('Password is required.');
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: buildAuthUserMetadata({
          employeeId: input.employeeId,
          role: input.role,
          status: input.status,
          fullName: input.profile?.fullName,
          firstName: input.profile?.firstName,
          lastName: input.profile?.lastName,
          phone: input.profile?.phone,
          position: input.profile?.position,
          department: input.profile?.department,
          address: input.profile?.address,
          location: input.profile?.location,
          language: input.profile?.language
        })
      })
    });

    if (!response.ok) {
      throw new Error(await parseSupabaseError(response));
    }

    const payload = (await response.json()) as { id?: string; user?: { id?: string } };
    const supabaseUserId = String(payload?.id || payload?.user?.id || '').trim();
    if (!supabaseUserId) {
      throw new Error('Supabase admin user creation returned no user id.');
    }

    return { supabaseUserId };
  },

  async registerUserWithPassword(input: {
    email: string;
    password: string;
    employeeId: string;
    role: EmployeeRole;
    status?: EmployeeStatus;
    profile?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      position?: string;
      department?: string;
      address?: string;
      location?: string;
      language?: string;
    };
  }): Promise<{ supabaseUserId: string }> {
    const metadata = buildAuthUserMetadata({
      employeeId: input.employeeId,
      role: input.role,
      status: normalizeStatus(input.status) || 'active',
      fullName: input.profile?.fullName,
      firstName: input.profile?.firstName,
      lastName: input.profile?.lastName,
      phone: input.profile?.phone,
      position: input.profile?.position,
      department: input.profile?.department,
      address: input.profile?.address,
      location: input.profile?.location,
      language: input.profile?.language
    });
    const result = await signUpWithPassword(input.email.trim().toLowerCase(), input.password, metadata);
    return { supabaseUserId: result.userId };
  },

  async provisionEmployeeAccount(input: {
    adminAccessToken: string;
    employeeId: string;
    email: string;
    password: string;
    role: EmployeeRole;
    status: EmployeeStatus;
    profile?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      position?: string;
      department?: string;
      address?: string;
      location?: string;
      language?: string;
    };
  }): Promise<{ supabaseUserId: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    let supabaseUserId: string | null = null;

    try {
      const signUpResult = await signUpWithPassword(normalizedEmail, input.password, {
        ...buildAuthUserMetadata({
          employeeId: input.employeeId,
          role: input.role,
          status: input.status,
          fullName: input.profile?.fullName,
          firstName: input.profile?.firstName,
          lastName: input.profile?.lastName,
          phone: input.profile?.phone,
          position: input.profile?.position,
          department: input.profile?.department,
          address: input.profile?.address,
          location: input.profile?.location,
          language: input.profile?.language
        })
      });
      supabaseUserId = signUpResult.userId;
    } catch (error: any) {
      const message = String(error?.message || '');
      const alreadyRegistered =
        message.toLowerCase().includes('already registered') ||
        message.toLowerCase().includes('already exists') ||
        message.toLowerCase().includes('user already');
      if (!alreadyRegistered) {
        throw error;
      }

      const loginResult = await supabaseAuth.onlineLogin(normalizedEmail, input.password);
      supabaseUserId = loginResult.supabaseUserId;
    }

    if (!supabaseUserId) {
      throw new Error('Unable to resolve Supabase user id during employee provisioning.');
    }

    await upsertAppUser(input.adminAccessToken, {
      user_id: supabaseUserId,
      employee_id: input.employeeId,
      email: normalizedEmail,
      role: input.role,
      account_status: input.status
    });

    return { supabaseUserId };
  },

  async upsertAppUserStatus(input: {
    adminAccessToken: string;
    supabaseUserId: string;
    employeeId: string;
    email: string;
    role: EmployeeRole;
    status: EmployeeStatus;
  }): Promise<void> {
    const payload = {
      user_id: input.supabaseUserId,
      employee_id: input.employeeId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      account_status: input.status
    };

    try {
      await upsertAppUser(input.adminAccessToken, payload);
      return;
    } catch (scopedError: unknown) {
      if (!getSupabaseServiceRoleKey()) {
        throw scopedError instanceof Error ? scopedError : new Error(String(scopedError || 'app_users upsert failed.'));
      }

      try {
        await upsertAppUserWithServiceRole(payload);
        return;
      } catch (serviceRoleError: unknown) {
        const scopedMessage = scopedError instanceof Error ? scopedError.message : String(scopedError || 'unknown');
        const serviceMessage =
          serviceRoleError instanceof Error ? serviceRoleError.message : String(serviceRoleError || 'unknown');
        throw new Error(`app_users upsert failed (scoped + service-role): ${scopedMessage}; ${serviceMessage}`);
      }
    }
  }
};
