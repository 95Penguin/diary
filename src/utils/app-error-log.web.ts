import type { AppErrorLogItem } from './app-error-log';
import { formatAppErrorLogItems, redactDiagnosticValue } from './app-error-log-core';

const STORAGE_KEY = 'shishi-error-log';
const MAX_ITEMS = 30;

export async function readAppErrorLog(): Promise<AppErrorLogItem[]> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is AppErrorLogItem =>
      Boolean(item)
      && typeof item.id === 'string'
      && typeof item.occurredAt === 'string'
      && typeof item.context === 'string'
      && typeof item.name === 'string'
      && typeof item.message === 'string').slice(-MAX_ITEMS);
  } catch {
    return [];
  }
}

export async function recordAppError(context: string, error: unknown) {
  try {
    const items = await readAppErrorLog();
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    const item: AppErrorLogItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      occurredAt: new Date().toISOString(),
      context: redactDiagnosticValue(context).slice(0, 60),
      name: redactDiagnosticValue(name).slice(0, 60),
      message: redactDiagnosticValue(message) || '未知错误',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...items, item].slice(-MAX_ITEMS)));
  } catch {
    // Diagnostics must never interrupt the action that originally failed.
  }
}

export async function clearAppErrorLog() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Best effort. */ }
}

export function formatAppErrorLog(items: AppErrorLogItem[]) {
  return formatAppErrorLogItems(items);
}
