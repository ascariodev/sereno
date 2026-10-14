import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { splitMentions } from '@/mentionToken';

export function MentionChip({ name, own }: { name: string; own: boolean }) {
  return (
    <Text testID="mention" style={[styles.chip, own && styles.own]}>
      @{name}
    </Text>
  );
}

export function MessageBody({
  body,
  mentions = [],
  ownUserId,
  style,
}: {
  body: string | null;
  mentions?: readonly { id: number; name: string }[];
  ownUserId?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { t } = useTranslation();
  const parts = splitMentions(body ?? '', mentions, t('channel.unknownMention'), ownUserId);

  return (
    <Text style={style}>
      {parts.map((part, i) =>
        'mention' in part ? <MentionChip key={i} name={part.mention} own={part.own} /> : part.text,
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: { backgroundColor: '#e0e7ff', color: '#3730a3', fontWeight: '500', borderRadius: 5 },
  own: { backgroundColor: '#c7d2fe', fontWeight: '600' },
});
