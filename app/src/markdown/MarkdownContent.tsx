import * as Linking from 'expo-linking';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { MentionChip } from '@/components/MessageBody';

import { allowedHref, headingLevel, type MarkdownNode, parseMarkdown, type TaskMeta } from './parseMarkdown';

interface Props {
  source: string | null | undefined;
  interactive?: boolean;
  mentions?: readonly { id: number; name: string }[];
  ownUserId?: number;
  onToggle?: (line: number) => void;
}

interface Context {
  interactive: boolean;
  onToggle?: (line: number) => void;
}

function plainText(nodes: MarkdownNode[]): string {
  return nodes
    .map((node) => (node.token.type === 'text' || node.token.type === 'code_inline' ? node.token.content : plainText(node.children)))
    .join('');
}

function renderInline(nodes: MarkdownNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    const { token } = node;
    switch (token.type) {
      case 'text':
      case 'escaped_mention':
        return token.content;
      case 'softbreak':
      case 'hardbreak':
        return '\n';
      case 'code_inline':
        return (
          <Text key={i} style={styles.codeInline}>
            {token.content}
          </Text>
        );
      case 'mention':
        return <MentionChip key={i} name={token.content} own={token.meta?.own === true} />;
      case 'strong_open':
        return (
          <Text key={i} style={styles.strong}>
            {renderInline(node.children)}
          </Text>
        );
      case 'em_open':
        return (
          <Text key={i} style={styles.em}>
            {renderInline(node.children)}
          </Text>
        );
      case 's_open':
        return (
          <Text key={i} style={styles.del}>
            {renderInline(node.children)}
          </Text>
        );
      case 'link_open': {
        const href = allowedHref(token);
        if (href === null) return <Text key={i}>{renderInline(node.children)}</Text>;
        return (
          <Text key={i} accessibilityRole="link" style={styles.link} onPress={() => void Linking.openURL(href)}>
            {renderInline(node.children)}
          </Text>
        );
      }
      case 'image':
        return null;
      default:
        return node.children.length > 0 ? <Text key={i}>{renderInline(node.children)}</Text> : token.content;
    }
  });
}

function inlineChildren(node: MarkdownNode): ReactNode[] {
  return node.children.flatMap((child) => (child.token.type === 'inline' ? renderInline(child.children) : []));
}

function TaskBox({ task, label, context }: { task: TaskMeta; label: string; context: Context }) {
  return (
    <Pressable
      testID="task-box"
      accessibilityRole="checkbox"
      accessibilityLabel={label || undefined}
      accessibilityState={{ checked: task.checked, disabled: !context.interactive }}
      disabled={!context.interactive}
      onPress={() => context.onToggle?.(task.line)}
      style={[styles.box, task.checked && styles.boxChecked]}
    >
      {task.checked ? <Text style={styles.boxMark}>✓</Text> : null}
    </Pressable>
  );
}

function renderBlocks(nodes: MarkdownNode[], context: Context, listStart?: number): ReactNode[] {
  return nodes.map((node, i) => {
    const { token } = node;
    switch (token.type) {
      case 'paragraph_open':
        return (
          <Text key={i} style={styles.text}>
            {inlineChildren(node)}
          </Text>
        );
      case 'heading_open':
        return (
          <Text key={i} accessibilityRole="header" style={headingLevel(token) === 3 ? styles.h3 : styles.h4}>
            {inlineChildren(node)}
          </Text>
        );
      case 'bullet_list_open':
        return (
          <View key={i} style={styles.list}>
            {renderBlocks(node.children, context)}
          </View>
        );
      case 'ordered_list_open':
        return (
          <View key={i} style={styles.list}>
            {renderBlocks(node.children, context, Number(token.attrGet('start') ?? 1))}
          </View>
        );
      case 'list_item_open': {
        const task = token.meta?.task === true ? (token.meta as unknown as TaskMeta) : null;
        const label = task ? plainText(node.children.find((child) => child.token.type === 'paragraph_open')?.children ?? []).trim() : '';
        return (
          <View key={i} style={styles.item}>
            {task ? (
              <TaskBox task={task} label={label} context={context} />
            ) : (
              <Text style={styles.text}>{listStart === undefined ? '•' : `${listStart + i}.`}</Text>
            )}
            <View style={styles.itemBody}>{renderBlocks(node.children, context)}</View>
          </View>
        );
      }
      case 'blockquote_open':
        return (
          <View key={i} style={styles.quote}>
            {renderBlocks(node.children, context)}
          </View>
        );
      case 'code_block':
      case 'fence':
        return (
          <View key={i} style={styles.pre}>
            <Text style={styles.code}>{token.content.replace(/\n$/, '')}</Text>
          </View>
        );
      case 'hr':
        return <View key={i} style={styles.hr} />;
      case 'inline':
        return (
          <Text key={i} style={styles.text}>
            {renderInline(node.children)}
          </Text>
        );
      default:
        return node.children.length > 0 ? <View key={i}>{renderBlocks(node.children, context)}</View> : null;
    }
  });
}

export function MarkdownContent({ source, interactive = false, mentions, ownUserId, onToggle }: Props) {
  const { t } = useTranslation();
  const unknownLabel = t('channel.unknownMention');
  const nodes = useMemo(
    () => parseMarkdown(source ?? '', mentions ? { mentions, unknownLabel, ownUserId } : undefined),
    [source, mentions, unknownLabel, ownUserId],
  );
  if (nodes.length === 0) return null;
  return <View style={styles.root}>{renderBlocks(nodes, { interactive, onToggle })}</View>;
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  root: { gap: 8 },
  text: { fontSize: 14, lineHeight: 21, color: '#1f2937' },
  h3: { fontSize: 15, fontWeight: '600', lineHeight: 20, color: '#1f2937' },
  h4: { fontSize: 14, fontWeight: '600', lineHeight: 18, color: '#1f2937' },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  link: { color: '#3730a3', textDecorationLine: 'underline' },
  codeInline: { fontFamily: mono, fontSize: 12.5, backgroundColor: '#f3f4f6' },
  pre: { padding: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, backgroundColor: '#f3f4f6' },
  code: { fontFamily: mono, fontSize: 12.5, color: '#1f2937' },
  list: { gap: 4 },
  item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  itemBody: { flex: 1, gap: 4 },
  quote: { paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: '#e5e7eb', gap: 8 },
  hr: { borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  box: {
    width: 18,
    height: 18,
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#6b7280',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  boxMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
