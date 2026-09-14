import type { SQLiteDatabase } from 'expo-sqlite';

type RecoveryListener = (error: Error) => void;

const listeners = new Set<RecoveryListener>();
const WRAPPED = Symbol('shishi-database-recovery');
let activeDatabase: SQLiteDatabase | null = null;
let recoveryPending = false;
let lastRecoveryAt = 0;
const RECOVERY_COOLDOWN_MS = 10_000;

export function isReleasedDatabaseError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /SharedObject|shared object that was already released|NativeDatabase.*received class java\.lang\.Integer|NativeStatement.*received class java\.lang\.Integer|doesn't contain valid shared object/i.test(message);
}

export function subscribeToDatabaseRecovery(listener: RecoveryListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestDatabaseRecovery(error: unknown, source?: SQLiteDatabase) {
  if (!isReleasedDatabaseError(error)) return false;
  // A rejected request can arrive after SQLiteProvider has already replaced its
  // connection. Never let that stale handle remount the new provider again.
  if (source && source !== activeDatabase) return true;
  if (recoveryPending) return true;
  const now = Date.now();
  // If the replacement connection fails immediately as well, leave the error
  // visible to its caller instead of remounting the whole application forever.
  if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) return true;
  const normalized = error instanceof Error ? error : new Error(String(error));
  lastRecoveryAt = now;
  recoveryPending = true;
  listeners.forEach((listener) => listener(normalized));
  return true;
}

/**
 * Expo's convenience query methods eventually call prepareAsync. Wrapping that
 * single boundary lets every repository request signal a dead native handle,
 * while the original rejection still cancels the in-flight operation safely.
 */
export function installDatabaseRecovery(db: SQLiteDatabase) {
  activeDatabase = db;
  recoveryPending = false;
  const target = db as SQLiteDatabase & { [WRAPPED]?: boolean };
  if (target[WRAPPED]) return;
  const prepare = db.prepareAsync.bind(db);
  db.prepareAsync = (async (...args: Parameters<SQLiteDatabase['prepareAsync']>) => {
    try {
      return await prepare(...args);
    } catch (error) {
      requestDatabaseRecovery(error, db);
      throw error;
    }
  }) as SQLiteDatabase['prepareAsync'];
  target[WRAPPED] = true;
}
