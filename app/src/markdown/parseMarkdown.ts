import MarkdownIt, { type Token } from 'markdown-it';

import { splitMentions } from '@/mentionToken';

// Same parser setup as web/src/markdown/renderMarkdown.ts; the app turns the tokens into components, not HTML.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const MAX_HEADING_LEVEL = 4;
const HEADING_OFFSET = 2;
const ALLOWED_URI = /^(?:https?:|mailto:)/i;
const TASK_MARKER = /^\[([ xX])\](?:\s+|$)/;
const ESCAPED_MENTION = /^\\(<@[1-9][0-9]{0,17}>)/;

export interface MentionOptions {
  mentions: readonly { id: number; name: string }[];
  unknownLabel: string;
  ownUserId?: number;
}

export interface TaskMeta {
  task: true;
  checked: boolean;
  line: number;
}

function taskInline(tokens: Token[], idx: number): Token | null {
  const inline = tokens[idx + 2];
  if (tokens[idx].type !== 'list_item_open' || inline?.type !== 'inline' || tokens[idx].map === null) return null;
  return TASK_MARKER.test(inline.content) ? inline : null;
}

md.core.ruler.after('inline', 'task_list', (state) => {
  const tokens = state.tokens;
  tokens.forEach((token, idx) => {
    const inline = taskInline(tokens, idx);
    if (!inline || !inline.children) return;
    const checked = TASK_MARKER.exec(inline.content)![1] !== ' ';
    token.meta = { ...token.meta, task: true, checked, line: token.map![0] } satisfies TaskMeta;
    const first = inline.children[0];
    first.content = first.content.replace(TASK_MARKER, '');
    inline.content = inline.content.replace(TASK_MARKER, '');
  });
});

md.inline.ruler.before('escape', 'escaped_mention', (state, silent) => {
  const match = ESCAPED_MENTION.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('escaped_mention', '', 0).content = match[1];
  state.pos += match[0].length;
  return true;
});

md.core.ruler.after('inline', 'mentions', (state) => {
  const options = state.env?.mentions as MentionOptions | undefined;
  if (!options) return;
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const children: Token[] = [];
    for (const child of block.children) {
      if (child.type !== 'text' || !child.content.includes('<@')) {
        children.push(child);
        continue;
      }
      for (const part of splitMentions(child.content, options.mentions, options.unknownLabel, options.ownUserId)) {
        const token = new state.Token('mention' in part ? 'mention' : 'text', '', 0);
        if ('mention' in part) {
          token.content = part.mention;
          token.meta = { own: part.own };
        } else {
          token.content = part.text;
        }
        children.push(token);
      }
    }
    block.children = children;
  }
});

export interface MarkdownNode {
  token: Token;
  children: MarkdownNode[];
}

function toTree(tokens: Token[]): MarkdownNode[] {
  const root: MarkdownNode[] = [];
  const stack: MarkdownNode[][] = [root];
  for (const token of tokens) {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: MarkdownNode = { token, children: token.type === 'inline' ? toTree(token.children ?? []) : [] };
    stack[stack.length - 1].push(node);
    if (token.nesting === 1) stack.push(node.children);
  }
  return root;
}

export function headingLevel(token: Token): number {
  return Math.min(Number(token.tag.slice(1)) + HEADING_OFFSET, MAX_HEADING_LEVEL);
}

export function allowedHref(token: Token): string | null {
  const href = token.attrGet('href');
  return typeof href === 'string' && ALLOWED_URI.test(href) ? href : null;
}

export function parseMarkdown(source: string, mentions?: MentionOptions): MarkdownNode[] {
  if (!source) return [];
  return toTree(md.parse(source, { mentions }));
}
