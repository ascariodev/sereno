import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import {
  isLogGroupOpenedPayload,
  isLogGroupStatusChangedPayload,
  isTaskCreatedFromGroupPayload,
  isTaskGroupReopenedPayload,
  levelTone,
} from '@/messages/payload';
import type { Message } from '@/messages/store';

const TONE_COLORS: Record<string, string> = {
  debug: '#6b7280',
  info: '#2563eb',
  notice: '#0891b2',
  warning: '#d97706',
  error: '#dc2626',
  critical: '#b91c1c',
  alert: '#9f1239',
  emergency: '#7f1d1d',
};

export function SystemNotice({ message }: { message: Message }) {
  const { t, i18n } = useTranslation();
  const payload = message.payload;
  const time = new Date(message.created_at).toLocaleTimeString(i18n.language, { timeStyle: 'short' });
  const actor = message.user?.name ?? t('notice.unknownActor');
  const status = (value: string) => (i18n.exists(`notice.status.${value}`) ? t(`notice.status.${value}`) : value);

  if (isLogGroupOpenedPayload(payload)) {
    const tone = levelTone(payload.level);
    const color = TONE_COLORS[tone];
    return (
      <View testID="system-notice" style={[styles.card, { borderLeftColor: color }]}>
        <View style={styles.head}>
          <Text style={[styles.pill, { backgroundColor: color }]}>
            {i18n.exists(`notice.level.${tone}`) ? t(`notice.level.${tone}`) : payload.level}
          </Text>
          <Text style={styles.kind}>
            {payload.type === 'log.group_reopened' ? t('notice.reopenedLabel') : t('notice.openedLabel')}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.stats}>
          {payload.events_count} {t('notice.eventsWord', { count: payload.events_count })}
        </Text>
      </View>
    );
  }

  if (isLogGroupStatusChangedPayload(payload)) {
    const title = payload.title?.trim();
    const text = title
      ? t('notice.statusChangedTitled', { actor, title, status: status(payload.status) })
      : t('notice.statusChanged', { actor, status: status(payload.status) });
    return <Line text={text} time={time} />;
  }

  if (isTaskCreatedFromGroupPayload(payload)) {
    return <Line text={t('notice.taskCreated', { actor, task: payload.task_key })} time={time} />;
  }

  if (isTaskGroupReopenedPayload(payload)) {
    return <Line text={t('notice.taskGroupReopened', { task: payload.task_key })} time={time} />;
  }

  return <Text style={styles.generic}>{t('channel.systemNotice')}</Text>;
}

function Line({ text, time }: { text: string; time: string }) {
  return (
    <View testID="system-notice-line" style={styles.line}>
      <Text style={styles.lineText}>{text}</Text>
      <Text style={styles.time}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, padding: 12, borderWidth: 1, borderColor: '#ddd', borderLeftWidth: 4, borderRadius: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { color: '#fff', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  kind: { fontSize: 13, color: '#444' },
  time: { fontSize: 12, color: '#777', marginLeft: 'auto' },
  title: { fontSize: 13, fontWeight: '500', fontFamily: 'monospace' },
  stats: { fontSize: 12.5, color: '#444' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lineText: { fontSize: 13, color: '#444', flexShrink: 1 },
  generic: { color: '#777' },
});
