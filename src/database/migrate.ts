import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Schema 13 is the first supported production baseline.
 *
 * Versions 1–12 were development-only schemas. They are intentionally not
 * migrated in production: data from those builds must first be exported by the
 * old build and restored through the validated ZIP backup flow.
 */
export const DATABASE_VERSION = 13;
export const DATABASE_BASELINE_VERSION = 13;

const BASELINE_SCHEMA = `
  CREATE TABLE entries (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    mood TEXT,
    favorited_at TEXT,
    location_name TEXT,
    latitude REAL,
    longitude REAL,
    weather TEXT
  );

  CREATE TABLE follow_ups (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE kv_store (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE entry_images (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL,
    uri TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'image',
    paired_video_uri TEXT,
    duration INTEGER,
    thumbnail_uri TEXT,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE entry_tags (
    entry_id TEXT NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entry_id, label),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE drafts (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    mood TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    images_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    location_name TEXT,
    latitude REAL,
    longitude REAL,
    weather TEXT
  );

  CREATE TABLE entry_versions (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL,
    content TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    mood TEXT,
    weather TEXT,
    location_name TEXT,
    latitude REAL,
    longitude REAL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE memory_suppressed_entries (
    entry_id TEXT PRIMARY KEY NOT NULL,
    suppressed_at TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );

  CREATE TABLE follow_up_images (
    id TEXT PRIMARY KEY NOT NULL,
    follow_up_id TEXT NOT NULL,
    uri TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'image',
    paired_video_uri TEXT,
    duration INTEGER,
    thumbnail_uri TEXT,
    FOREIGN KEY (follow_up_id) REFERENCES follow_ups(id) ON DELETE CASCADE
  );

  CREATE INDEX idx_entries_occurred_at
    ON entries(occurred_at DESC) WHERE deleted_at IS NULL;
  CREATE INDEX idx_follow_ups_entry_id
    ON follow_ups(entry_id, created_at ASC) WHERE deleted_at IS NULL;
  CREATE INDEX idx_entry_images_entry_id
    ON entry_images(entry_id, sort_order ASC);
  CREATE INDEX idx_entry_tags_label
    ON entry_tags(label, entry_id);
  CREATE INDEX idx_entries_favorited_at
    ON entries(favorited_at DESC)
    WHERE deleted_at IS NULL AND favorited_at IS NOT NULL;
  CREATE INDEX idx_drafts_updated_at
    ON drafts(updated_at DESC);
  CREATE INDEX idx_entries_location_name
    ON entries(location_name, occurred_at DESC)
    WHERE deleted_at IS NULL AND location_name IS NOT NULL;
  CREATE INDEX idx_entries_weather
    ON entries(weather, occurred_at DESC)
    WHERE deleted_at IS NULL AND weather IS NOT NULL;
  CREATE INDEX idx_entry_versions_entry_id
    ON entry_versions(entry_id, created_at DESC);
  CREATE INDEX idx_follow_up_images_follow_up_id
    ON follow_up_images(follow_up_id, sort_order ASC);
  CREATE INDEX idx_entries_timeline_page
    ON entries(occurred_at DESC, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX idx_entries_mood
    ON entries(mood, occurred_at DESC)
    WHERE deleted_at IS NULL AND mood IS NOT NULL;
`;

export async function migrateDatabase(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion > DATABASE_VERSION) {
    throw new Error(`数据库来自更新版本（${currentVersion}），请升级应用后再打开`);
  }
  if (currentVersion > 0 && currentVersion < DATABASE_BASELINE_VERSION) {
    throw new Error(
      `不再支持开发期数据库版本（${currentVersion}）。请先用旧版本导出 ZIP 备份，再安装当前版本并恢复`,
    );
  }
  if (currentVersion === DATABASE_VERSION) return;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.execAsync(BASELINE_SCHEMA);
    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}; COMMIT`);
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      // A failed statement can already have ended the transaction.
    }
    throw error;
  }
}
