export function appendOlderWindow<T extends { id: string }>(current: T[], incoming: T[], maximum: number) {
  const ids = new Set(current.map((item) => item.id));
  const combined = [...current, ...incoming.filter((item) => !ids.has(item.id))];
  const trimCount = Math.max(0, combined.length - maximum);
  return { entries: trimCount ? combined.slice(trimCount) : combined, trimmedNewest: trimCount };
}

export function prependNewerWindow<T extends { id: string }>(current: T[], incoming: T[], maximum: number) {
  const ids = new Set(current.map((item) => item.id));
  const combined = [...incoming.filter((item) => !ids.has(item.id)), ...current];
  const trimCount = Math.max(0, combined.length - maximum);
  return { entries: trimCount ? combined.slice(0, maximum) : combined, trimmedOldest: trimCount };
}
