export function pickRandomMemoryId(ids: string[], previousId: string | null = null, random = Math.random) {
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0];
  const choices = previousId ? ids.filter((id) => id !== previousId) : ids;
  return choices[Math.floor(random() * choices.length)] ?? choices[0] ?? null;
}
