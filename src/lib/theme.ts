export const THEME_STORAGE_KEY = 'prd-template:reader-theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' &&
  THEME_PREFERENCES.some((preference) => preference === value);
