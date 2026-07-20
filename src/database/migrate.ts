import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 3;

export async function migrateDatabase(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = result?.user_version ?? 0;

  if (currentVersion === 0) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY NOT NULL, content TEXT NOT NULL, occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS follow_ups (
        id TEXT PRIMARY KEY NOT NULL, entry_id TEXT NOT NULL, content TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entries_occurred_at
        ON entries(occurred_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_follow_ups_entry_id
        ON follow_ups(entry_id, created_at ASC) WHERE deleted_at IS NULL;
    `);
    currentVersion = 1;
  }

  if (currentVersion === 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS entry_images (
        id TEXT PRIMARY KEY NOT NULL, entry_id TEXT NOT NULL, uri TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_entry_images_entry_id
        ON entry_images(entry_id, sort_order ASC);
    `);
    currentVersion = 2;
  }

  if (currentVersion === 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entry_id, label),
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_entry_tags_label ON entry_tags(label, entry_id);
    `);
    currentVersion = 3;
  }

  if (currentVersion < DATABASE_VERSION) throw new Error(`不支持的数据库版本：${currentVersion}`);
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
