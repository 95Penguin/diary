import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSizeMode = 'verySmall' | 'small' | 'standard' | 'large' | 'veryLarge';
export type ReadingThemeName = 'cream' | 'white' | 'warm' | 'green' | 'gray' | 'night';
export type ReadingFontName = 'serif' | 'sans' | 'light' | 'classic' | 'rounded' | 'system';
export type AppPreferences = { nickname: string; avatarUri: string | null; themeMode: ThemeMode; fontSize: FontSizeMode; readingTheme: ReadingThemeName; readingFont: ReadingFontName };

const defaults: AppPreferences = { nickname: '拾时', avatarUri: null, themeMode: 'system', fontSize: 'standard', readingTheme: 'cream', readingFont: 'serif' };
export const readingThemes = {
  cream: { label: '米白', background: '#FFFDF8', surface: '#F4F6F2', text: '#27332E', secondary: '#7F8A84', border: '#E7EBE6' },
  white: { label: '纯白', background: '#FFFFFF', surface: '#F5F5F3', text: '#222825', secondary: '#747C78', border: '#E8EAE8' },
  warm: { label: '淡黄', background: '#FFFCF2', surface: '#FAF4E4', text: '#39362F', secondary: '#817B6F', border: '#F0E9D9' },
  green: { label: '浅绿', background: '#F1F7F1', surface: '#E4EEE5', text: '#26372D', secondary: '#718178', border: '#D9E7DC' },
  gray: { label: '浅灰', background: '#F3F4F2', surface: '#E8EAE7', text: '#292E2B', secondary: '#747A76', border: '#DDE0DC' },
  night: { label: '夜间', background: '#151A17', surface: '#232B26', text: '#EDF2EF', secondary: '#AAB6AF', border: '#344039' },
} as const;
type PreferencesContextValue = { preferences: AppPreferences; ready: boolean; isDark: boolean; fontScale: number; readingTheme: (typeof readingThemes)[ReadingThemeName]; readingFontFamily: string | undefined; updatePreferences: (patch: Partial<AppPreferences>) => Promise<void> };
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void db.getFirstAsync<{ value: string }>("SELECT value FROM kv_store WHERE key = 'app-preferences'").then((row) => {
      if (!active || !row) return;
      try {
        const stored = JSON.parse(row.value) as Partial<AppPreferences>;
        if (stored.readingFont === 'classic' || stored.readingFont === 'rounded') stored.readingFont = 'sans';
        setPreferences({ ...defaults, ...stored });
      } catch { /* Keep defaults. */ }
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [db]);


  const updatePreferences = useCallback(async (patch: Partial<AppPreferences>) => {
    const next = { ...preferences, ...patch };
    await db.runAsync(
      `INSERT INTO kv_store (key, value) VALUES ('app-preferences', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(next),
    );
    setPreferences(next);
  }, [db, preferences]);

  const value = useMemo<PreferencesContextValue>(() => ({
    preferences, ready,
    isDark: preferences.themeMode === 'dark' || (preferences.themeMode === 'system' && systemScheme === 'dark'),
    fontScale: preferences.fontSize === 'verySmall' ? 0.82 : preferences.fontSize === 'small' ? 0.92 : preferences.fontSize === 'large' ? 1.15 : preferences.fontSize === 'veryLarge' ? 1.3 : 1,
    readingTheme: readingThemes[preferences.readingTheme] ?? readingThemes.cream,
    readingFontFamily: preferences.readingFont === 'serif'
      ? 'ShishiSerif'
      : preferences.readingFont === 'sans'
        ? 'ShishiSans'
        : preferences.readingFont === 'light'
          ? Platform.select({ ios: 'Avenir Next', android: 'sans-serif-light', default: 'sans-serif' })
        : preferences.readingFont === 'classic'
          ? Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' })
          : preferences.readingFont === 'rounded'
            ? Platform.select({ ios: 'Avenir Next', android: 'sans-serif-rounded', default: 'sans-serif' })
            : undefined,
    updatePreferences,
  }), [preferences, ready, systemScheme, updatePreferences]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useAppPreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('useAppPreferences must be used inside AppPreferencesProvider');
  return value;
}
