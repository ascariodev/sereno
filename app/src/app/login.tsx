import { router } from 'expo-router';
import { useRef, useState } from 'react';
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
import type { FieldErrors } from '@/api/types';
import { useAuthStore } from '@/session/auth';

export default function Login() {
  const { t } = useTranslation();
  const login = useAuthStore((state) => state.login);
  const passwordInput = useRef<TextInput>(null);
  const submittingRef = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    try {
      await login(email, password);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 422) {
        setFieldErrors(error.errors);
        if (!error.errors.email?.length && !error.errors.password?.length) setFormError(t('login.failed'));
      } else if (error.status === 429) {
        setFormError(t('login.tooManyAttempts'));
      } else if (error.status === 0) {
        setFormError(t('login.network'));
      } else {
        setFormError(t('login.failed'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const emailError = fieldErrors.email?.[0];
  const passwordError = fieldErrors.password?.[0];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('login.title')}
          </Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('login.email')}</Text>
            <TextInput
              accessibilityLabel={t('login.email')}
              style={[styles.input, emailError ? styles.inputInvalid : null]}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordInput.current?.focus()}
              editable={!submitting}
            />
            {emailError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {emailError}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('login.password')}</Text>
            <TextInput
              ref={passwordInput}
              accessibilityLabel={t('login.password')}
              style={[styles.input, passwordError ? styles.inputInvalid : null]}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              editable={!submitting}
            />
            {passwordError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {passwordError}
              </Text>
            ) : null}
          </View>

          {formError ? (
            <Text accessibilityRole="alert" style={styles.error} testID="login-error">
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
            <Text style={styles.buttonText}>{submitting ? t('login.submitting') : t('login.submit')}</Text>
          </Pressable>

          <Pressable accessibilityRole="link" onPress={() => router.push('/register')} style={styles.linkButton}>
            <Text style={styles.link}>{t('login.toRegister')}</Text>
          </Pressable>

          <Text style={styles.hint}>{t('login.invited')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  form: { gap: 18, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, color: '#555' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
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
  linkButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  link: { fontSize: 14, color: '#555' },
  hint: { fontSize: 13, color: '#777', textAlign: 'center' },
});
