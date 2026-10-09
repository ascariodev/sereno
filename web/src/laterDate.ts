/** The later of two ISO dates (the first one on a tie); `null` counts as absent. */
export function laterDate(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}
