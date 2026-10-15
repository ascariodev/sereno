import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { enablePush, refreshPushState, usePushStore } from '@/push/device';

export function DevicePush() {
  const { t } = useTranslation();
  const state = usePushStore((store) => store.state);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'dismissed' | 'enableFailed' | null>(null);

  useEffect(() => {
    void refreshPushState().catch(() => {});
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshPushState().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enablePush();
      if (result === 'inactive') setMessage('dismissed');
    } catch {
      setMessage('enableFailed');
    } finally {
      setBusy(false);
    }
  }

  if (state === null) return null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('push.title')}
      </Text>
      <Text>{t(`push.status.${state}`)}</Text>
      {state === 'inactive' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void enable()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{t('push.enable')}</Text>
        </Pressable>
      ) : null}
      {state === 'blocked' ? (
        <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.button}>
          <Text style={styles.buttonText}>{t('push.openSettings')}</Text>
        </Pressable>
      ) : null}
      {message ? <Text accessibilityRole="alert">{t(`push.${message}`)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: { fontSize: 20, fontWeight: '600' },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonText: { fontSize: 16 },
});
