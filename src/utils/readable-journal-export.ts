import type { Entry } from '@/domain/journal';

export type ReadableExportFormat = 'markdown' | 'html';
export type ReadableExportOptions = { includeLocations: boolean; title?: string };

function localDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markdownText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/^([#>*+-]) /gm, '\\$1 ');
}

function metadata(entry: Entry, includeLocations: boolean) {
  return [
    entry.mood && `心情：${entry.mood}`,
    entry.weather && `天气：${entry.weather}`,
    includeLocations && entry.locationName && `地点：${entry.locationName}`,
    entry.tags.length && `标签：${entry.tags.join('、')}`,
    entry.images.length && `媒体：${entry.images.length} 个（原文件请从完整 ZIP 备份恢复）`,
  ].filter(Boolean) as string[];
}

export function formatReadableJournal(entries: Entry[], format: ReadableExportFormat, options: ReadableExportOptions) {
  const title = options.title?.trim() || '拾时日记';
  if (format === 'markdown') {
    const body = entries.map((entry) => {
      const lines = [`## ${localDateTime(entry.occurredAt)}`, '', markdownText(entry.content)];
      const meta = metadata(entry, options.includeLocations);
      if (meta.length) lines.push('', ...meta.map((item) => `- ${markdownText(item)}`));
      if (entry.followUps.length) {
        lines.push('', '### 后续');
        for (const followUp of entry.followUps) lines.push('', `- ${localDateTime(followUp.createdAt)}　${markdownText(followUp.content)}`);
      }
      return lines.join('\n');
    }).join('\n\n---\n\n');
    return `# ${markdownText(title)}\n\n导出时间：${localDateTime(new Date().toISOString())}\n记录数量：${entries.length}\n\n${body}\n`;
  }
  const articles = entries.map((entry) => {
    const meta = metadata(entry, options.includeLocations);
    const followUps = entry.followUps.length
      ? `<section class="follow"><h3>后续</h3>${entry.followUps.map((item) => `<p><time>${escapeHtml(localDateTime(item.createdAt))}</time>${escapeHtml(item.content).replace(/\n/g, '<br>')}</p>`).join('')}</section>`
      : '';
    return `<article><h2>${escapeHtml(localDateTime(entry.occurredAt))}</h2><div class="content">${escapeHtml(entry.content).replace(/\n/g, '<br>')}</div>${meta.length ? `<ul>${meta.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${followUps}</article>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{max-width:760px;margin:40px auto;padding:0 22px;color:#27332e;background:#fffdf8;font:16px/1.8 system-ui,sans-serif}h1,h2,h3{font-family:serif}header{border-bottom:1px solid #e2e8e3;padding-bottom:20px}article{padding:28px 0;border-bottom:1px solid #e2e8e3}h2{font-size:18px;color:#497965}.content{white-space:normal}ul{color:#718178;font-size:14px}.follow{margin-top:18px;padding:12px 16px;background:#f1f7f1;border-radius:12px}.follow h3{margin:0}.follow time{margin-right:12px;color:#718178;font-size:13px}@media(max-width:600px){body{margin:10px auto}}</style></head><body><header><h1>${escapeHtml(title)}</h1><p>导出时间：${escapeHtml(localDateTime(new Date().toISOString()))} · ${entries.length} 条记录</p></header>${articles}</body></html>`;
}
