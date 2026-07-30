export type JournalTemplate = {
  id: string;
  title: string;
  description: string;
  content: string;
};

export const JOURNAL_TEMPLATES: JournalTemplate[] = [
  {
    id: 'daily-review',
    title: '今日复盘',
    description: '收好今天的片段与感受',
    content: '今天发生了什么：\n\n让我开心的一件事：\n\n让我有些为难的事：\n\n明天想做的一件小事：',
  },
  {
    id: 'mood',
    title: '情绪记录',
    description: '听一听此刻心里的声音',
    content: '我现在感到：\n\n这份感受可能来自：\n\n身体有什么反应：\n\n此刻我真正需要的是：',
  },
  {
    id: 'travel',
    title: '旅行片段',
    description: '记录地点、风景和偶遇',
    content: '今天去了：\n\n第一眼看到：\n\n最好吃 / 最喜欢的是：\n\n想记住的一个瞬间：',
  },
  {
    id: 'book-film',
    title: '读书与观影',
    description: '留下作品带来的回声',
    content: '作品：\n\n最触动我的片段：\n\n我想到：\n\n想留给以后的话：',
  },
];

export function applyJournalTemplate(current: string, template: JournalTemplate) {
  const trimmed = current.trimEnd();
  return trimmed ? `${trimmed}\n\n${template.content}` : template.content;
}
