import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NotificationPreferences } from '@/components/NotificationPreferences';
import { getLocale, LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@/i18n';
import { invitableRolesFor } from '@/organization/invitations';
import { useOrganizationStore } from '@/organization/store';
import { useAuthStore } from '@/session/auth';

export default function Settings() {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);
  const chooseAndSaveLocale = useAuthStore((state) => state.chooseAndSaveLocale);
  const organizationName = useOrganizationStore((state) => state.active()?.name ?? null);
  const canInvite = useOrganizationStore((state) => invitableRolesFor(state.active()?.roles ?? []).length > 0);
  const [localeSaveFailed, setLocaleSaveFailed] = useState(false);
  const current = getLocale();

  async function selectLocale(locale: Locale) {
    setLocaleSaveFailed(false);
    const saved = await chooseAndSaveLocale(locale);
    setLocaleSaveFailed(!saved);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('settings.title')}
      </Text>
      {organizationName ? <Text style={styles.organization}>{organizationName}</Text> : null}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('settings.language')}
        </Text>
        {SUPPORTED_LOCALES.map((locale) => (
          <Pressable
            key={locale}
            accessibilityRole="radio"
            accessibilityState={{ selected: current === locale }}
            onPress={() => void selectLocale(locale)}
            style={[styles.button, current === locale && styles.selected]}
          >
            <Text style={styles.buttonText}>{LOCALE_LABELS[locale]}</Text>
          </Pressable>
        ))}
        {localeSaveFailed ? <Text accessibilityRole="alert">{t('common.localeSaveFailed')}</Text> : null}
      </View>
      <NotificationPreferences />
      <Pressable accessibilityRole="button" onPress={() => router.push('/members')} style={styles.button}>
        <Text style={styles.buttonText}>{t('settings.members')}</Text>
      </Pressable>
      {canInvite ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/invitations')} style={styles.button}>
          <Text style={styles.buttonText}>{t('settings.invitations')}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => router.push('/select-organization')} style={styles.button}>
        <Text style={styles.buttonText}>{t('common.changeOrganization')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void logout()} style={styles.button}>
        <Text style={styles.buttonText}>{t('common.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  organization: { fontSize: 18 },
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
  selected: { borderWidth: 2, borderColor: '#000' },
  buttonText: { fontSize: 16 },
});
