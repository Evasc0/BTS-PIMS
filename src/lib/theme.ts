export type ThemePreference = 'light' | 'dark';

const GLOBAL_THEME_KEY = 'bts-theme-preference';
const USER_THEME_KEY_PREFIX = 'bts-theme-preference:';

const normalizeTheme = (value: unknown): ThemePreference => (String(value).toLowerCase() === 'dark' ? 'dark' : 'light');

const getUserThemeKey = (userId: string) => `${USER_THEME_KEY_PREFIX}${userId}`;

export const getStoredThemePreference = (userId?: string | null): ThemePreference => {
  if (typeof window === 'undefined') return 'light';

  if (userId) {
    const userTheme = localStorage.getItem(getUserThemeKey(userId));
    if (userTheme) return normalizeTheme(userTheme);
  }

  const globalTheme = localStorage.getItem(GLOBAL_THEME_KEY);
  return normalizeTheme(globalTheme);
};

export const setStoredThemePreference = (theme: ThemePreference, userId?: string | null): ThemePreference => {
  if (typeof window === 'undefined') return normalizeTheme(theme);

  const normalized = normalizeTheme(theme);
  localStorage.setItem(GLOBAL_THEME_KEY, normalized);
  if (userId) {
    localStorage.setItem(getUserThemeKey(userId), normalized);
  }
  return normalized;
};

export const applyThemePreference = (theme: ThemePreference): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const normalized = normalizeTheme(theme);
  root.classList.toggle('dark', normalized === 'dark');
  root.style.colorScheme = normalized;
};
