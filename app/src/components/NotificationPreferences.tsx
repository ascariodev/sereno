import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  getNotificationPreferences,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  updateNotificationPreferences,
  type NotificationPreferences as Preferences,
  type PreferenceChannel,
  type PreferenceType,
} from '@/notifications/preferences';

const cellKey = (channel: PreferenceChannel, type: PreferenceType) => `${channel}-${type}`;

export function NotificationPreferences() {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  const inFlight = useRef(new Set<string>());

  const [reloadKey, setReloadKey] = useState(0);

  function retry() {
    setLoading(true);
    setLoadFailed(false);
    setSaving({});
    setFailed({});
    setReloadKey((key) => key + 1);
  }

  useEffect(() => {
    const counter = generation;
    const current = ++counter.current;
    const inFlightIds = inFlight.current;
    inFlightIds.clear();
    void (async () => {
      try {
        const response = await getNotificationPreferences();
        if (current !== counter.current) return;
        setPreferences({ email: { ...response.email }, push: { ...response.push } });
      } catch {
        if (current !== counter.current) return;
        setLoadFailed(true);
      } finally {
        if (current === counter.current) setLoading(false);
      }
    })();
    return () => {
      counter.current++;
    };
  }, [reloadKey]);

  async function onChange(channel: PreferenceChannel, type: PreferenceType, next: boolean) {
    const id = cellKey(channel, type);
    if (!preferences || inFlight.current.has(id)) return;
    const previous = preferences[channel][type];
    const run = generation.current;
    const apply = (value: boolean) =>
      setPreferences((state) => (state ? { ...state, [channel]: { ...state[channel], [type]: value } } : state));
    inFlight.current.add(id);
    apply(next);
    setSaving((state) => ({ ...state, [id]: true }));
    setFailed((state) => ({ ...state, [id]: false }));
    try {
      const response = await updateNotificationPreferences(channel, { [type]: next });
      if (run !== generation.current) return;
      apply(response[channel][type]);
    } catch {
      if (run !== generation.current) return;
      apply(previous);
      setFailed((state) => ({ ...state, [id]: true }));
    } finally {
      if (run === generation.current) {
        inFlight.current.delete(id);
        setSaving((state) => ({ ...state, [id]: false }));
      }
    }
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('notificationPreferences.title')}
      </Text>
      <Text style={styles.description}>{t('notificationPreferences.description')}</Text>
      {loading ? <Text>{t('common.loading')}</Text> : null}
      {!loading && loadFailed ? (
        <View style={styles.failed}>
          <Text accessibilityRole="alert">{t('notificationPreferences.loadFailed')}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && preferences
        ? NOTIFICATION_TYPES.map((type) => (
            <View key={type} style={styles.group}>
              <Text style={styles.event}>{t(`notificationPreferences.types.${type}`)}</Text>
              {NOTIFICATION_CHANNELS.map((channel) => {
                const id = cellKey(channel, type);
                const label = t(`notificationPreferences.channels.${channel}`);
                return (
                  <View key={channel}>
                    <View style={styles.row}>
                      <Text>{label}</Text>
                      <Switch
                        accessibilityLabel={t('notificationPreferences.switchLabel', {
                          type: t(`notificationPreferences.types.${type}`),
                          channel: label,
                        })}
                        value={preferences[channel][type]}
                        disabled={saving[id]}
                        onValueChange={(next) => void onChange(channel, type, next)}
                      />
                    </View>
                    {failed[id] ? (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {t('notificationPreferences.saveFailed', {
                          type: t(`notificationPreferences.types.${type}`),
                          channel: label,
                        })}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  heading: { fontSize: 20, fontWeight: '600' },
  description: { fontSize: 14, color: '#666' },
  failed: { gap: 8, alignItems: 'flex-start' },
  group: { gap: 4 },
  event: { fontSize: 16, fontWeight: '500' },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { color: '#b00020', fontSize: 13 },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
});
