import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import { api, ApiError } from '@/api/client';
import type { FieldErrors } from '@/api/types';
import { useAuthStore } from '@/session/auth';

type Status = 'loading' | 'open' | 'closed' | 'failed';

export default function Register() {
  const { t } = useTranslation();
  const register = useAuthStore((state) => state.register);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmationInput = useRef<TextInput>(null);
  const submittingRef = useRef(false);
  const statusGeneration = useRef(0);
  const [status, setStatus] = useState<Status>('loading');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const mine = ++statusGeneration.current;
    setStatus('loading');
    try {
      const response = await api.get<{ enabled: boolean }>('/api/auth/registration');
      if (mine === statusGeneration.current) setStatus(response.enabled ? 'open' : 'closed');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (mine === statusGeneration.current) setStatus('failed');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const generation = statusGeneration;
    return () => {
      generation.current++;
    };
  }, [loadStatus]);

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    try {
      await register(name, email, password, passwordConfirmation);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 422) {
        setFieldErrors(error.errors);
        if (error.errors.password?.length) {
          setPassword('');
          setPasswordConfirmation('');
        }
        const visible = (['name', 'email', 'password'] as const).some((field) => error.errors[field]?.length);
        if (!visible) setFormError(t('register.failed'));
      } else if (error.status === 403) {
        setFormError(t('register.closed'));
      } else if (error.status === 429) {
        setFormError(t('register.tooManyAttempts'));
      } else if (error.status === 0) {
        setFormError(t('register.network'));
      } else {
        setFormError(t('register.failed'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const toLogin = (
    <Pressable accessibilityRole="link" onPress={() => router.replace('/login')} style={styles.linkButton}>
      <Text style={styles.link}>{status === 'open' ? t('register.haveAccount') : t('register.toLogin')}</Text>
    </Pressable>
  );

  if (status !== 'open') {
    return (
      <View style={styles.centered}>
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('register.title')}
          </Text>
          {status === 'loading' ? (
            <Text accessibilityRole="progressbar" style={styles.subtitle}>
              {t('common.loading')}
            </Text>
          ) : null}
          {status === 'closed' ? <Text style={styles.subtitle}>{t('register.closed')}</Text> : null}
          {status === 'failed' ? (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                {t('register.statusError')}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void loadStatus()} style={styles.button}>
                <Text style={styles.buttonText}>{t('register.retry')}</Text>
              </Pressable>
            </>
          ) : null}
          {status === 'loading' ? null : toLogin}
        </View>
      </View>
    );
  }

  const nameError = fieldErrors.name?.[0];
  const emailError = fieldErrors.email?.[0];
  const passwordError = fieldErrors.password?.[0];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('register.title')}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('register.name')}</Text>
            <TextInput
              accessibilityLabel={t('register.name')}
              style={[styles.input, nameError ? styles.inputInvalid : null]}
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => emailInput.current?.focus()}
              editable={!submitting}
            />
            {nameError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {nameError}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('register.email')}</Text>
            <TextInput
              ref={emailInput}
              accessibilityLabel={t('register.email')}
              style={[styles.input, emailError ? styles.inputInvalid : null]}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
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
            <Text style={styles.label}>{t('register.password')}</Text>
            <TextInput
              ref={passwordInput}
              accessibilityLabel={t('register.password')}
              style={[styles.input, passwordError ? styles.inputInvalid : null]}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmationInput.current?.focus()}
              editable={!submitting}
            />
            {passwordError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {passwordError}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('register.passwordConfirmation')}</Text>
            <TextInput
              ref={confirmationInput}
              accessibilityLabel={t('register.passwordConfirmation')}
              style={styles.input}
              value={passwordConfirmation}
              onChangeText={setPasswordConfirmation}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              editable={!submitting}
            />
          </View>

          {formError ? (
            <Text accessibilityRole="alert" style={styles.error} testID="register-error">
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
            <Text style={styles.buttonText}>{submitting ? t('register.submitting') : t('register.submit')}</Text>
          </Pressable>

          {toLogin}
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
});
