import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useOrganizationStore } from '@/organization/store';
import { useAuthStore } from '@/session/auth';

export default function Settings() {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);
  const organizationName = useOrganizationStore((state) => state.active()?.name ?? null);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('settings.title')}
      </Text>
      {organizationName ? <Text style={styles.organization}>{organizationName}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => router.push('/select-organization')} style={styles.button}>
        <Text style={styles.buttonText}>{t('common.changeOrganization')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => void logout()} style={styles.button}>
        <Text style={styles.buttonText}>{t('common.signOut')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  organization: { fontSize: 18 },
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
