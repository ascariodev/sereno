import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/client';
import { useOrganizationStore } from '@/organization/store';
import { useAuthStore } from '@/session/auth';

const NAME_MAX_LENGTH = 255;

export default function SelectOrganization() {
  const { t } = useTranslation();
  const organizations = useOrganizationStore((state) => state.organizations);
  const loaded = useOrganizationStore((state) => state.loaded);
  const loadError = useOrganizationStore((state) => state.loadError);
  const load = useOrganizationStore((state) => state.load);
  const select = useOrganizationStore((state) => state.select);
  const create = useOrganizationStore((state) => state.create);
  const logout = useAuthStore((state) => state.logout);
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  const activeId = useOrganizationStore((state) => state.activeId);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function goHome() {
    router.dismissTo('/');
  }

  async function choose(id: number) {
    await select(id);
    goHome();
  }

  async function submit() {
    if (submittingRef.current) return;
    const trimmed = name.trim();
    setFormError(null);
    if (trimmed === '') {
      setNameError(t('organization.nameRequired'));
      return;
    }
    if ([...trimmed].length > NAME_MAX_LENGTH) {
      setNameError(t('organization.nameTooLong', { max: NAME_MAX_LENGTH }));
      return;
    }
    setNameError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await create(trimmed);
      if (mounted.current) goHome();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (!mounted.current) return;
      if (error.status === 422 && error.errors.name?.length) {
        setNameError(error.errors.name[0]);
      } else if (error.status === 429) {
        setFormError(t('organization.tooManyAttempts'));
      } else if (error.status === 0) {
        setFormError(t('organization.network'));
      } else {
        setFormError(t('organization.failed'));
      }
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  const errorBlock = loadError ? (
    <>
      <Text accessibilityRole="alert" style={styles.error}>
        {t('organization.loadFailed')}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}>
        <Text style={styles.secondaryText}>{t('organization.retry')}</Text>
      </Pressable>
    </>
  ) : null;

  const signOut = (
    <Pressable accessibilityRole="button" onPress={() => void logout()} style={styles.linkButton}>
      <Text style={styles.link}>{t('common.signOut')}</Text>
    </Pressable>
  );

  if (!loaded) {
    return (
      <View style={styles.centered}>
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('organization.title')}
          </Text>
          {loadError ? null : (
            <Text accessibilityRole="progressbar" style={styles.subtitle}>
              {t('common.loading')}
            </Text>
          )}
          {errorBlock}
          {signOut}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('organization.title')}
          </Text>
          {errorBlock}

          {organizations.length === 0 ? (
            <View style={styles.field}>
              <Text style={styles.subtitle}>{t('organization.none')}</Text>
              <Text style={styles.subtitle}>{t('organization.noneHint')}</Text>
            </View>
          ) : (
            <View style={styles.field}>
              <Text style={styles.subtitle}>{t('organization.subtitle')}</Text>
              {organizations.map((organization) => (
                <Pressable
                  key={organization.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: organization.id === activeId }}
                  onPress={() => void choose(organization.id)}
                  style={styles.option}
                >
                  <Text style={styles.optionText}>{organization.name}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.field}>
            <Text accessibilityRole="header" style={styles.label}>
              {t('organization.createTitle')}
            </Text>
            <TextInput
              accessibilityLabel={t('organization.nameLabel')}
              style={[styles.input, nameError ? styles.inputInvalid : null]}
              value={name}
              onChangeText={setName}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              editable={!submitting}
            />
            {nameError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {nameError}
              </Text>
            ) : null}
            {formError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {formError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting, busy: submitting }}
              disabled={submitting}
              onPress={() => void submit()}
              style={[styles.button, submitting ? styles.buttonDisabled : null]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : null}
              <Text style={styles.buttonText}>{submitting ? t('organization.creating') : t('organization.submit')}</Text>
            </Pressable>
          </View>

          {signOut}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  form: { gap: 18, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, color: '#555' },
  field: { gap: 10 },
  label: { fontSize: 16, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 44,
  },
  inputInvalid: { borderColor: '#c0392b' },
  error: { color: '#c0392b', fontSize: 14 },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#999',
  },
  optionText: { fontSize: 16 },
  button: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#1f2937',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  secondaryText: { fontSize: 16 },
  linkButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  link: { fontSize: 14, color: '#555' },
});
