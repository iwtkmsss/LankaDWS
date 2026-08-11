const apostrophes = /[\u0060\u00b4\u02bc\u2018\u2019\u201b\u2032\uff07]/gu

export function normalizeUserSearchValue(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('uk-UA')
    .replace(apostrophes, "'")
}

export function userSearchCodePointLength(value: string): number {
  return [...normalizeUserSearchValue(value)].length
}

export function isUserSearchValueLongEnough(value: string): boolean {
  return userSearchCodePointLength(value) >= 1
}
