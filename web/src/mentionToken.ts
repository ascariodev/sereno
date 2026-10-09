// Same token as the API (StoreMessageRequest): ids without leading zeros, up to 18 digits.
// Global flag: use it with matchAll/replace, never with test/exec (they keep lastIndex).
export const MENTION_TOKEN = /<@([1-9][0-9]{0,17})>/g

export function mentionToken(id: number): string {
  return `<@${id}>`
}
