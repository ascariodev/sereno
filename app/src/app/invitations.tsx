import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  canRevokeInvitation,
  type Invitation,
  type InvitationRole,
  invitableRolesFor,
  useInvitationsStore,
} from '@/organization/invitations';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';

const NO_ROLES: string[] = [];

export default function Invitations() {
  const { t, i18n } = useTranslation();
  const organizationId = useOrganizationStore((state) => state.activeId);
  const roles = useOrganizationStore((state) => state.active()?.roles ?? NO_ROLES);
  const invitations = useInvitationsStore((state) => state.invitations);
  const loading = useInvitationsStore((state) => state.loading);
  const failed = useInvitationsStore((state) => state.failed);
  const submitting = useInvitationsStore((state) => state.submitting);
  const revoking = useInvitationsStore((state) => state.revoking);
  const fieldErrors = useInvitationsStore((state) => state.fieldErrors);
  const formError = useInvitationsStore((state) => state.formError);
  const notice = useInvitationsStore((state) => state.notice);
  const projects = useProjectsStore((state) => state.projects);
  const projectsFailed = useProjectsStore((state) => state.failed);
  const projectsLoading = useProjectsStore((state) => state.loading);
  const [email, setEmail] = useState('');
  const [chosenRole, setRole] = useState<InvitationRole>('member');
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const invitable = invitableRolesFor(roles);
  const role = invitable.includes(chosenRole) ? chosenRole : 'member';
  const allowed = invitable.length > 0;
  const busy = loading || submitting || revoking;

  useEffect(() => {
    if (!allowed) {
      router.replace('/');
      return;
    }
    if (organizationId !== null) void useInvitationsStore.getState().open();
    return () => useInvitationsStore.getState().clear();
  }, [organizationId, allowed]);

  function toggleProject(id: number) {
    setProjectIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submit() {
    const sent = await useInvitationsStore
      .getState()
      .invite(email.trim(), role, projects.map((project) => project.id).filter((id) => projectIds.includes(id)));
    if (sent) {
      setEmail('');
      setRole('member');
      setProjectIds([]);
    }
  }

  function confirmRevoke(invitation: Invitation) {
    Alert.alert(t('invitations.revokeTitle'), t('invitations.revokeConfirm', { email: invitation.email }), [
      { text: t('invitations.cancel'), style: 'cancel' },
      {
        text: t('invitations.revokeAction'),
        style: 'destructive',
        onPress: () => void useInvitationsStore.getState().revoke(invitation),
      },
    ]);
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  }

  if (!allowed) return null;

  const emailError = fieldErrors.email?.[0];
  const roleError = fieldErrors.role?.[0];
  const projectError = Object.entries(fieldErrors).find(([key]) => key.startsWith('project_ids'))?.[1][0];

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {t('invitations.title')}
      </Text>

      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('invitations.invite')}
        </Text>
        <TextInput
          accessibilityLabel={t('invitations.email')}
          style={[styles.input, emailError ? styles.inputInvalid : null]}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!submitting}
        />
        {emailError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {emailError}
          </Text>
        ) : null}
        {invitable.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: role === option }}
            accessibilityLabel={t('invitations.roleOption', { role: t(`invitations.roles.${option}`) })}
            disabled={submitting}
            onPress={() => setRole(option)}
            style={[styles.button, role === option && styles.selected]}
          >
            <Text style={styles.buttonText}>{t(`invitations.roles.${option}`)}</Text>
          </Pressable>
        ))}
        {roleError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {roleError}
          </Text>
        ) : null}
        {role === 'member' ? (
          <View style={styles.projects}>
            <Text style={styles.label}>{t('invitations.projects')}</Text>
            <Text style={styles.meta}>{t('invitations.projectsHint')}</Text>
            {projectsFailed ? (
              <View style={styles.block}>
                <Text accessibilityRole="alert" style={styles.error}>
                  {t('invitations.projectsFailed')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={projectsLoading}
                  onPress={() => void useProjectsStore.getState().load(true)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{t('common.retry')}</Text>
                </Pressable>
              </View>
            ) : null}
            {projects.map((project) => (
              <Pressable
                key={project.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: projectIds.includes(project.id) }}
                accessibilityLabel={project.name}
                disabled={submitting}
                onPress={() => toggleProject(project.id)}
                style={[styles.button, projectIds.includes(project.id) && styles.selected]}
              >
                <Text style={styles.buttonText}>
                  {project.name} ({project.key})
                </Text>
              </Pressable>
            ))}
            {projectError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {projectError}
              </Text>
            ) : null}
          </View>
        ) : null}
        {formError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {formError.kind === 'server' ? formError.message : t(`invitations.form.${formError.kind}`)}
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.button}>
          <Text style={styles.buttonText}>{submitting ? t('invitations.sending') : t('invitations.submit')}</Text>
        </Pressable>
      </View>

      {failed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('invitations.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void useInvitationsStore.getState().open()} style={styles.button}>
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : (
        <>
          {notice ? (
            <Text accessibilityRole="alert" style={'email' in notice ? styles.status : styles.error}>
              {t(`invitations.notice.${notice.kind}`, { email: 'email' in notice ? notice.email : '' })}
            </Text>
          ) : null}
          {invitations.length === 0 ? <Text style={styles.meta}>{t('invitations.empty')}</Text> : null}
          {invitations.map((invitation) => (
            <View key={invitation.id} style={styles.row}>
              <Text style={styles.name}>{invitation.email}</Text>
              <Text style={styles.meta}>
                {t('invitations.role')}: {t(`invitations.roles.${invitation.role}`)}
              </Text>
              <Text style={styles.meta}>
                {t('invitations.invitedBy')}: {invitation.invited_by?.name ?? t('invitations.unknownInviter')}
              </Text>
              {invitation.role === 'member' && invitation.projects.length > 0 ? (
                <Text style={styles.meta}>
                  {t('invitations.projects')}: {invitation.projects.map((project) => project.name).join(', ')}
                </Text>
              ) : null}
              <Text style={styles.meta}>
                {t('invitations.expires')}: {formatDate(invitation.expires_at)}
              </Text>
              {canRevokeInvitation(roles, invitation.role) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('invitations.revokeFor', { email: invitation.email })}
                  disabled={busy}
                  onPress={() => confirmRevoke(invitation)}
                  style={styles.button}
                >
                  <Text style={[styles.buttonText, styles.danger]}>{t('invitations.revoke')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600' },
  block: { gap: 10 },
  projects: { gap: 6 },
  error: { color: '#c0392b', fontSize: 14 },
  meta: { fontSize: 12.5, color: '#555' },
  status: { fontSize: 13.5, fontWeight: '600' },
  row: { gap: 6, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  name: { fontSize: 16, fontWeight: '600' },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#888', fontSize: 16 },
  inputInvalid: { borderColor: '#c0392b' },
  button: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  selected: { borderWidth: 2, borderColor: '#000' },
  buttonText: { fontSize: 16 },
  danger: { color: '#c0392b' },
});
