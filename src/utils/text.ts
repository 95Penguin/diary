export function countJournalCharacters(value: string) {
  return [...value].filter((character) => !/\s/u.test(character)).length;
}
