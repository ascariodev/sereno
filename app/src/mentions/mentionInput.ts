import { mentionToken } from '@/mentionToken';

export interface MentionCandidate {
  id: number;
  name: string;
}

// `text.slice(start, end)` is `@` + `name` (UTF-16 indices).
export interface InsertedMention {
  id: number;
  name: string;
  start: number;
  end: number;
}

export interface MentionState {
  text: string;
  caret: number | null;
  mentions: readonly InsertedMention[];
}

export interface MentionQuery {
  start: number;
  text: string;
}

export const EMPTY_MENTION_STATE: MentionState = { text: '', caret: null, mentions: [] };

const DEFAULT_LIMIT = 8;
const MAX_QUERY_LENGTH = 50;
// What may precede `@` to open the list: whitespace or opening punctuation, never a word character (emails).
const OPENERS = /[\s([{"'¿¡]/;

export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findQuery(state: MentionState): MentionQuery | null {
  const { text, caret, mentions } = state;
  if (caret === null) return null;
  const at = text.lastIndexOf('@', caret - 1);
  if (at < 0 || caret <= at) return null;
  if (at > 0 && !OPENERS.test(text[at - 1])) return null;
  const query = text.slice(at + 1, caret);
  if (query.length > MAX_QUERY_LENGTH || /^\s|[\r\n]/.test(query)) return null;
  if (mentions.some((m) => (at >= m.start && at < m.end) || (caret > m.start && caret < m.end))) return null;
  return { start: at, text: query };
}

// Moves the mentions after an edit and drops the ones the edit touched.
function reconcile(previous: string, next: string, mentions: readonly InsertedMention[]): InsertedMention[] {
  if (previous === next) return [...mentions];
  const shortest = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < shortest && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const editEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  const result: InsertedMention[] = [];
  for (const mention of mentions) {
    let moved: InsertedMention | null = null;
    if (mention.end <= prefix) moved = mention;
    else if (mention.start >= editEnd) moved = { ...mention, start: mention.start + delta, end: mention.end + delta };
    if (moved && next.slice(moved.start, moved.end) === `@${moved.name}`) result.push(moved);
  }
  return result;
}

// The caret is not known from a text change alone: it sits at the end of the edited region.
function estimateCaret(previous: string, next: string): number {
  const shortest = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < shortest && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  return next.length - suffix;
}

export function updateText(state: MentionState, next: string): MentionState {
  return {
    text: next,
    caret: estimateCaret(state.text, next),
    mentions: reconcile(state.text, next, state.mentions),
  };
}

export function moveCaret(state: MentionState, start: number, end: number = start): MentionState {
  return { ...state, caret: start === end ? start : null };
}

export function suggestionsFor<T extends MentionCandidate>(
  state: MentionState,
  members: readonly T[],
  excludeUserId?: number | null,
  limit: number = DEFAULT_LIMIT,
): T[] {
  const query = findQuery(state);
  if (!query) return [];
  const needle = normalizeForSearch(query.text);
  const first: T[] = [];
  const rest: T[] = [];
  for (const member of members) {
    if (member.id === excludeUserId) continue;
    const name = normalizeForSearch(member.name);
    if (name.startsWith(needle)) first.push(member);
    else if (` ${name}`.includes(` ${needle}`)) rest.push(member);
  }
  return [...first, ...rest].slice(0, limit);
}

// Replaces the `@query` before the caret with `@Name `.
export function selectMember(state: MentionState, member: MentionCandidate): MentionState {
  const query = findQuery(state);
  const at = state.caret;
  if (!query || at === null) return state;
  const label = `@${member.name}`;
  const after = state.text.slice(at);
  const spacer = /^[ \t]/.test(after) ? '' : ' ';
  const delta = label.length + spacer.length - (at - query.start);
  const inserted: InsertedMention = {
    id: member.id,
    name: member.name,
    start: query.start,
    end: query.start + label.length,
  };
  const shifted = state.mentions.map((m) => (m.start >= at ? { ...m, start: m.start + delta, end: m.end + delta } : m));
  return {
    text: state.text.slice(0, query.start) + label + spacer + after,
    caret: inserted.end + 1,
    mentions: [...shifted, inserted].sort((a, b) => a.start - b.start),
  };
}

export function serializeMentions(state: MentionState): string {
  let out = '';
  let last = 0;
  for (const mention of state.mentions) {
    out += state.text.slice(last, mention.start) + mentionToken(mention.id);
    last = mention.end;
  }
  return out + state.text.slice(last);
}
