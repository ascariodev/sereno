import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/session/auth';

export default function Index() {
  const { t } = useTranslation();
  const logout = useAuthStore((state) => state.logout);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sereno</Text>
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
