import type { AppErrorLogItem } from './app-error-log';

export function redactDiagnosticValue(value: string) {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[API_KEY]')
    .replace(/(?:file|content):\/\/\S+/gi, '[本地文件]')
    .replace(/\/(?:Users|home|data|private|var)\/\S+/g, '[本地路径]')
    .replace(/-?\d{1,3}\.\d{4,}\s*[,，]\s*-?\d{1,3}\.\d{4,}/g, '[坐标]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function formatAppErrorLogItems(items: AppErrorLogItem[]) {
  if (!items.length) return '最近错误：无';
  return [
    `最近错误：${items.length} 条（仅含脱敏技术信息）`,
    ...items.map((item) => `${item.occurredAt} | ${item.context} | ${item.name}: ${item.message}`),
  ].join('\n');
}
