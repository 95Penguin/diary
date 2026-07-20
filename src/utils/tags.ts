export function normalizeTag(value: string) {
  return value.trim().replace(/^#+/, '').replace(/[#,，\s]+/g, '').slice(0, 12);
}
