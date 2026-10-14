import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useMessagesStore } from '@/messages/store';

export const MAX_MESSAGE_LENGTH = 4000;

export function MessageComposer() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const tooLong = [...text].length > MAX_MESSAGE_LENGTH;
  const canSend = !sending && !tooLong && text.trim() !== '';

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setErrorText(null);
    const sent = text;
    try {
      await useMessagesStore.getState().send(sent);
      setText((current) => (current === sent ? '' : current));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setErrorText(caught.errors.body?.[0] ?? caught.message);
      } else if (caught instanceof ApiError && caught.status === 429) {
        setErrorText(t('channel.composer.rateLimited'));
      } else {
        setErrorText(t('channel.composer.sendFailed'));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      {tooLong ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('channel.composer.tooLong', { max: MAX_MESSAGE_LENGTH })}
        </Text>
      ) : errorText !== null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorText}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          placeholder={t('channel.composer.placeholder')}
          accessibilityLabel={t('channel.composer.placeholder')}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() => void submit()}
          style={[styles.send, !canSend && styles.sendDisabled]}
        >
          <Text style={styles.sendText}>{t('channel.composer.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  send: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 14 },
});
