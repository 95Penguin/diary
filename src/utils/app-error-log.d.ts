export type AppErrorLogItem = {
  id: string;
  occurredAt: string;
  context: string;
  name: string;
  message: string;
};

export function recordAppError(context: string, error: unknown): Promise<void>;
export function readAppErrorLog(): Promise<AppErrorLogItem[]>;
export function clearAppErrorLog(): Promise<void>;
export function formatAppErrorLog(items: AppErrorLogItem[]): string;
