import { DatabaseSync } from 'node:sqlite';

function normalizeParams(args) {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

export function createTestDatabase() {
  const sqlite = new DatabaseSync(':memory:');

  const db = {
    async execAsync(sql) {
      sqlite.exec(sql);
    },
    async getFirstAsync(sql, ...args) {
      return sqlite.prepare(sql).get(...normalizeParams(args));
    },
    async getAllAsync(sql, ...args) {
      return sqlite.prepare(sql).all(...normalizeParams(args));
    },
    async runAsync(sql, ...args) {
      const result = sqlite.prepare(sql).run(...normalizeParams(args));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async withTransactionAsync(callback) {
      sqlite.exec('BEGIN');
      try {
        const result = await callback();
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    async withExclusiveTransactionAsync(callback) {
      sqlite.exec('BEGIN EXCLUSIVE');
      try {
        const result = await callback(db);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      sqlite.close();
    },
  };
  return db;
}
