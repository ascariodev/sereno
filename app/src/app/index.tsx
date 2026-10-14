import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useOrganizationStore } from '@/organization/store';
import { useAuthStore } from '@/session/auth';

export default function Index() {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);
  const organizationName = useOrganizationStore((state) => state.active()?.name ?? null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sereno</Text>
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
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
  },
  organization: {
    fontSize: 18,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonText: {
    fontSize: 16,
  },
});
