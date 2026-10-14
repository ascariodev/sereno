import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

export default function Notifications() {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('notifications.title')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
});
