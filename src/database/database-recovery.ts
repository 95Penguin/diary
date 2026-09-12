import type { SQLiteDatabase } from 'expo-sqlite';

type RecoveryListener = (error: Error) => void;

const listeners = new Set<RecoveryListener>();
const WRAPPED = Symbol('shishi-database-recovery');
let lastRecoveryAt = 0;

export function isReleasedDatabaseError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /SharedObject|shared object that was already released|NativeDatabase.*received class java\.lang\.Integer|NativeStatement.*received class java\.lang\.Integer|doesn't contain valid shared object/i.test(message);
}

export function subscribeToDatabaseRecovery(listener: RecoveryListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestDatabaseRecovery(error: unknown) {
  if (!isReleasedDatabaseError(error)) return false;
  const normalized = error instanceof Error ? error : new Error(String(error));
  const now = Date.now();
  if (now - lastRecoveryAt < 750) return true;
  lastRecoveryAt = now;
  listeners.forEach((listener) => listener(normalized));
  return true;
}

/**
 * Expo's convenience query methods eventually call prepareAsync. Wrapping that
 * single boundary lets every repository request signal a dead native handle,
 * while the original rejection still cancels the in-flight operation safely.
 */
export function installDatabaseRecovery(db: SQLiteDatabase) {
  const target = db as SQLiteDatabase & { [WRAPPED]?: boolean };
  if (target[WRAPPED]) return;
  const prepare = db.prepareAsync.bind(db);
  db.prepareAsync = (async (...args: Parameters<SQLiteDatabase['prepareAsync']>) => {
    try {
      return await prepare(...args);
    } catch (error) {
      requestDatabaseRecovery(error);
      throw error;
    }
  }) as SQLiteDatabase['prepareAsync'];
  target[WRAPPED] = true;
}
