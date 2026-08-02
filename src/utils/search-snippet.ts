export function searchSnippet(text: string, query: string, before = 36, after = 72) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;
  const index = text.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase());
  if (index < 0) return text;
  const start = Math.max(0, index - before);
  const end = Math.min(text.length, index + normalizedQuery.length + after);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
