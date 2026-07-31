export type JournalTemplate = {
  id: string;
  title: string;
  description: string;
  content: string;
  source: 'system' | 'custom';
};

export type JournalTemplateFields = Pick<JournalTemplate, 'title' | 'description' | 'content'>;

export type JournalTemplateSettings = {
  systemOverrides: Record<string, JournalTemplateFields>;
  custom: JournalTemplate[];
};

export function emptyJournalTemplateSettings(): JournalTemplateSettings {
  return { systemOverrides: {}, custom: [] };
}

export const EMPTY_JOURNAL_TEMPLATE_SETTINGS: JournalTemplateSettings = emptyJournalTemplateSettings();

export const JOURNAL_TEMPLATES: JournalTemplate[] = [
  {
    id: 'daily-review',
    source: 'system',
    title: '今日复盘',
    description: '收好今天的片段与感受',
    content: '今天发生了什么：\n\n让我开心的一件事：\n\n让我有些为难的事：\n\n明天想做的一件小事：',
  },
  {
    id: 'mood',
    source: 'system',
    title: '情绪记录',
    description: '听一听此刻心里的声音',
    content: '我现在感到：\n\n这份感受可能来自：\n\n身体有什么反应：\n\n此刻我真正需要的是：',
  },
  {
    id: 'travel',
    source: 'system',
    title: '旅行片段',
    description: '记录地点、风景和偶遇',
    content: '今天去了：\n\n第一眼看到：\n\n最好吃 / 最喜欢的是：\n\n想记住的一个瞬间：',
  },
  {
    id: 'book-film',
    source: 'system',
    title: '读书与观影',
    description: '留下作品带来的回声',
    content: '作品：\n\n最触动我的片段：\n\n我想到：\n\n想留给以后的话：',
  },
];

export function resolveJournalTemplates(settings: JournalTemplateSettings) {
  const system = JOURNAL_TEMPLATES.map((template) => ({
    ...template,
    ...settings.systemOverrides[template.id],
    source: 'system' as const,
  }));
  return [...system, ...settings.custom.map((template) => ({ ...template, source: 'custom' as const }))];
}

export function isJournalTemplateFields(value: unknown): value is JournalTemplateFields {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<JournalTemplateFields>;
  return typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 30
    && typeof item.description === 'string' && item.description.length <= 80
    && typeof item.content === 'string' && item.content.trim().length > 0 && item.content.length <= 4000;
}

export function parseJournalTemplateSettings(value: unknown): JournalTemplateSettings {
  if (!value || typeof value !== 'object') return emptyJournalTemplateSettings();
  const candidate = value as Partial<JournalTemplateSettings>;
  const systemIds = new Set(JOURNAL_TEMPLATES.map((item) => item.id));
  const systemOverrides = Object.fromEntries(Object.entries(candidate.systemOverrides ?? {})
    .filter(([id, fields]) => systemIds.has(id) && isJournalTemplateFields(fields)));
  const seenIds = new Set(systemIds);
  const custom = Array.isArray(candidate.custom) ? candidate.custom.filter((item): item is JournalTemplate => {
    if (!item || typeof item.id !== 'string' || !item.id || item.source !== 'custom' || !isJournalTemplateFields(item) || seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  }) : [];
  return { systemOverrides, custom };
}

export function mergeJournalTemplateSettings(current: JournalTemplateSettings, incoming: JournalTemplateSettings) {
  const existingIds = new Set(current.custom.map((item) => item.id));
  return parseJournalTemplateSettings({
    // A merge restore must not silently replace local edits when templates have
    // no updatedAt field to establish which side is newer.
    systemOverrides: { ...incoming.systemOverrides, ...current.systemOverrides },
    custom: [...current.custom, ...incoming.custom.filter((item) => !existingIds.has(item.id))],
  });
}

export function applyJournalTemplate(current: string, template: JournalTemplate) {
  const trimmed = current.trimEnd();
  return trimmed ? `${trimmed}\n\n${template.content}` : template.content;
}
