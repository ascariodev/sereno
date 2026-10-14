import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Message } from '@/messages/store';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function relativeTime(iso: string, locale: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit);
  }
  return formatter.format(0, 'second');
}

export function ThreadSummary({ message, onOpen }: { message: Message; onOpen?: (messageId: number) => void }) {
  const { t, i18n } = useTranslation();
  const count = message.replies_count;

  return (
    <Pressable accessibilityRole="button" onPress={() => onOpen?.(message.id)} style={styles.summary}>
      {count > 0 ? (
        <>
          {message.recent_participants.length > 0 ? (
            <View style={styles.participants}>
              {message.recent_participants.map((user) => (
                <Text key={user.id} style={styles.initial}>
                  {user.name.charAt(0).toUpperCase()}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={styles.count}>{t('thread.replies', { count })}</Text>
          {message.last_reply_at !== null ? (
            <Text style={styles.when}>{t('thread.lastReply', { when: relativeTime(message.last_reply_at, i18n.language) })}</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.count}>{t('thread.replyAction')}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  participants: { flexDirection: 'row', gap: 2 },
  initial: {
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 20,
    fontSize: 11,
    color: '#fff',
    backgroundColor: '#2563eb',
  },
  count: { fontSize: 13, fontWeight: '500', color: '#444' },
  when: { fontSize: 12, color: '#777' },
});
