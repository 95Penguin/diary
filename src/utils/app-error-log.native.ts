import { File, Paths } from 'expo-file-system';

import type { AppErrorLogItem } from './app-error-log';
import { formatAppErrorLogItems, redactDiagnosticValue } from './app-error-log-core';

const LOG_FILE = new File(Paths.document, 'shishi-error-log.json');
const MAX_ITEMS = 30;

function normalize(context: string, error: unknown): AppErrorLogItem {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    occurredAt: new Date().toISOString(),
    context: redactDiagnosticValue(context).slice(0, 60),
    name: redactDiagnosticValue(name).slice(0, 60),
    message: redactDiagnosticValue(message) || '未知错误',
  };
}

export async function readAppErrorLog(): Promise<AppErrorLogItem[]> {
  try {
    if (!LOG_FILE.exists) return [];
    const value = JSON.parse(await LOG_FILE.text()) as unknown;
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
    const next = [...items, normalize(context, error)].slice(-MAX_ITEMS);
    if (!LOG_FILE.exists) LOG_FILE.create();
    LOG_FILE.write(JSON.stringify(next));
  } catch {
    // Diagnostics must never interrupt the action that originally failed.
  }
}

export async function clearAppErrorLog() {
  try {
    if (LOG_FILE.exists) LOG_FILE.delete();
  } catch {
    // Clearing diagnostics is best effort.
  }
}

export function formatAppErrorLog(items: AppErrorLogItem[]) {
  return formatAppErrorLogItems(items);
}
