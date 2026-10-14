import { router, useLocalSearchParams } from 'expo-router';
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
import { useProjectsStore } from '@/projects/store';

const NAME_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 5000;
const KEY_MAX_LENGTH = 10;
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

type Field = 'name' | 'key' | 'description';
const FIELDS: Field[] = ['name', 'key', 'description'];

function suggestKey(source: string): string {
  return source
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, KEY_MAX_LENGTH);
}

export default function ProjectForm() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const projectId = id === undefined ? null : Number(id);
  const canManage = useOrganizationStore((state) => state.canCreateProject());
  const existing = useProjectsStore((state) => state.projects.find((project) => project.id === projectId) ?? null);

  const [name, setName] = useState(existing?.name ?? '');
  const [key, setKey] = useState(existing?.key ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [keyEdited, setKeyEdited] = useState(projectId !== null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function onName(value: string) {
    setName(value);
    if (!keyEdited) setKey(suggestKey(value));
  }

  function onKey(value: string) {
    const upper = value.toUpperCase();
    setKeyEdited(upper !== '');
    setKey(upper === '' ? suggestKey(name) : upper);
  }

  function validate(): Partial<Record<Field, string>> {
    const found: Partial<Record<Field, string>> = {};
    const trimmed = name.trim();
    if (trimmed === '') found.name = t('projects.nameRequired');
    else if ([...trimmed].length > NAME_MAX_LENGTH) found.name = t('projects.nameTooLong', { max: NAME_MAX_LENGTH });
    if (!KEY_PATTERN.test(key.trim().toUpperCase())) found.key = t('projects.keyInvalid');
    if ([...description].length > DESCRIPTION_MAX_LENGTH) {
      found.description = t('projects.descriptionTooLong', { max: DESCRIPTION_MAX_LENGTH });
    }
    return found;
  }

  function failure(error: unknown, fallback: string) {
    if (!(error instanceof ApiError)) throw error;
    if (!mounted.current) return;
    if (error.status === 422) {
      const next: Partial<Record<Field, string>> = {};
      for (const field of FIELDS) {
        if (error.errors[field]?.length) next[field] = error.errors[field][0];
      }
      setErrors(next);
      if (Object.keys(next).length === 0) setFormError(error.message);
    } else if (error.status === 403) setFormError(t('projects.forbidden'));
    else if (error.status === 429) setFormError(t('projects.tooManyAttempts'));
    else if (error.status === 0) setFormError(t('projects.network'));
    else setFormError(fallback);
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      await action();
      if (mounted.current) close();
    } catch (error) {
      failure(error, fallback);
    } finally {
      busyRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  function submit() {
    if (busyRef.current) return;
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const trimmedDescription = description.trim();
    const input = {
      name: name.trim(),
      key: key.trim().toUpperCase(),
      description: trimmedDescription === '' ? null : trimmedDescription,
    };
    const store = useProjectsStore.getState();
    void run(() => (projectId === null ? store.create(input) : store.update(projectId, input)), t('projects.failed'));
  }

  if (!canManage || (projectId !== null && existing === null)) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.error}>
          {t('projects.forbidden')}
        </Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>{t('projects.cancel')}</Text>
        </Pressable>
      </View>
    );
  }

  const submitLabel =
    projectId === null
      ? submitting
        ? t('projects.creating')
        : t('projects.create')
      : submitting
        ? t('projects.saving')
        : t('projects.save');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.title}>
            {projectId === null ? t('projects.createTitle') : t('projects.editTitle')}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('projects.nameLabel')}</Text>
            <TextInput
              accessibilityLabel={t('projects.nameLabel')}
              style={[styles.input, errors.name ? styles.inputInvalid : null]}
              value={name}
              onChangeText={onName}
              editable={!submitting}
            />
            {errors.name ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errors.name}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('projects.keyLabel')}</Text>
            <TextInput
              accessibilityLabel={t('projects.keyLabel')}
              style={[styles.input, errors.key ? styles.inputInvalid : null]}
              value={key}
              onChangeText={onKey}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={KEY_MAX_LENGTH}
              editable={!submitting}
            />
            {errors.key ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errors.key}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('projects.descriptionLabel')}</Text>
            <TextInput
              accessibilityLabel={t('projects.descriptionLabel')}
              style={[styles.input, styles.multiline, errors.description ? styles.inputInvalid : null]}
              value={description}
              onChangeText={setDescription}
              multiline
              editable={!submitting}
            />
            {errors.description ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errors.description}
              </Text>
            ) : null}
          </View>

          {formError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {formError}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            disabled={submitting}
            onPress={submit}
            style={[styles.button, submitting ? styles.buttonDisabled : null]}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : null}
            <Text style={styles.buttonText}>{submitLabel}</Text>
          </Pressable>

          <Pressable accessibilityRole="button" disabled={submitting} onPress={close} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{t('projects.cancel')}</Text>
          </Pressable>

          {projectId !== null ? (
            confirmingArchive ? (
              <View style={styles.field}>
                <Text style={styles.label}>{t('projects.archiveConfirm')}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={submitting}
                  onPress={() => void run(() => useProjectsStore.getState().archive(projectId), t('projects.archiveFailed'))}
                  style={[styles.dangerButton, submitting ? styles.buttonDisabled : null]}
                >
                  <Text style={styles.buttonText}>{submitting ? t('projects.archiving') : t('projects.archiveYes')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={submitting}
                  onPress={() => setConfirmingArchive(false)}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryText}>{t('projects.cancel')}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => setConfirmingArchive(true)}
                style={styles.secondaryButton}
              >
                <Text style={styles.dangerText}>{t('projects.archive')}</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  form: { gap: 18, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  field: { gap: 8 },
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
  multiline: { minHeight: 96, textAlignVertical: 'top' },
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
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#c0392b',
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
  dangerText: { fontSize: 16, color: '#c0392b' },
});
