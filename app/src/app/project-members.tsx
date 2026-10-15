import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMemberDirectoryStore } from '@/projects/members';
import { useOrganizationStore } from '@/organization/store';
import { type ActionError, useProjectMembersStore } from '@/projects/projectMembers';
import { useProjectsStore } from '@/projects/store';
import { onReconnect, subscribeToProject } from '@/realtime/echo';

function errorText(error: ActionError, t: (key: string) => string): string {
  return error.kind === 'server' ? error.message : t(`projectMembers.${error.kind}`);
}

export default function ProjectMembers() {
  const { t } = useTranslation();
  const { projectId: rawId, name } = useLocalSearchParams<{ projectId?: string; name?: string }>();
  const projectId = rawId !== undefined && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const project = useProjectsStore((state) => state.projects.find((item) => item.id === projectId));
  const projectsLoaded = useProjectsStore((state) => state.loaded);
  const projectsFailed = useProjectsStore((state) => state.failed);
  const organizationId = useOrganizationStore((state) => state.activeId);
  const allowed = useOrganizationStore((state) => state.canCreateProject());
  const assigned = useProjectMembersStore((state) => state.assigned);
  const organization = useProjectMembersStore((state) => state.organization);
  const loading = useProjectMembersStore((state) => state.loading);
  const failed = useProjectMembersStore((state) => state.failed);
  const unavailable = useProjectMembersStore((state) => state.unavailable);
  const busy = useProjectMembersStore((state) => state.busy);
  const actionError = useProjectMembersStore((state) => state.actionError);
  const notice = useProjectMembersStore((state) => state.notice);
  const known = project !== undefined;
  const notFound = (projectId !== null && !known && projectsLoaded) || unavailable;
  const heading = project?.name ?? name;
  const assignedIds = new Set(assigned.map((member) => member.id));
  const candidates = organization.filter((member) => member.role === 'member' && !assignedIds.has(member.id));

  useEffect(() => {
    if (allowed && projectId !== null && known) void useProjectMembersStore.getState().open(projectId);
    return () => useProjectMembersStore.getState().clear();
  }, [allowed, projectId, known]);

  useEffect(() => {
    if (!allowed || projectId === null || organizationId === null) return;
    const unsubscribe = subscribeToProject(organizationId, projectId, {
      onMembersChanged: (changedId) => {
        useMemberDirectoryStore.getState().invalidate(changedId);
        if (changedId === projectId) void useProjectMembersStore.getState().refresh();
      },
    });
    const unsubscribeReconnect = onReconnect(() => void useProjectMembersStore.getState().refresh());
    return () => {
      unsubscribe();
      unsubscribeReconnect();
    };
  }, [allowed, projectId, organizationId]);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {heading ? `${t('projectMembers.title')} · ${heading}` : t('projectMembers.title')}
      </Text>
      {!allowed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('projectMembers.noPermission')}
        </Text>
      ) : projectId === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('projectMembers.invalid')}
        </Text>
      ) : notFound ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('projectMembers.notFound')}
        </Text>
      ) : !known && projectsFailed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('projectMembers.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void useProjectsStore.getState().load()} style={styles.button}>
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : failed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('projectMembers.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void useProjectMembersStore.getState().open(projectId)} style={styles.button}>
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : loading || !known ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : (
        <>
          {notice ? (
            <Text accessibilityRole="alert" style={styles.status}>
              {t(`projectMembers.${notice.kind}`, { name: notice.name })}
            </Text>
          ) : null}
          {actionError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {errorText(actionError, t)}
            </Text>
          ) : null}
          {assigned.map((member) => (
            <View key={member.id} style={styles.row}>
              <Text style={styles.memberName}>{member.name}</Text>
              {member.email ? <Text style={styles.meta}>{member.email}</Text> : null}
              {member.role === 'member' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('projectMembers.removeFor', { name: member.name })}
                  disabled={busy}
                  onPress={() => void useProjectMembersStore.getState().remove(member)}
                  style={styles.button}
                >
                  <Text style={[styles.buttonText, styles.danger]}>{t('projectMembers.remove')}</Text>
                </Pressable>
              ) : (
                <Text style={styles.meta}>{t('projectMembers.alwaysSees')}</Text>
              )}
            </View>
          ))}
          <Text accessibilityRole="header" style={styles.label}>
            {t('projectMembers.add')}
          </Text>
          {candidates.length === 0 ? (
            <Text style={styles.meta}>{t('projectMembers.noCandidates')}</Text>
          ) : (
            candidates.map((member) => (
              <View key={member.id} style={styles.row}>
                <Text style={styles.memberName}>{member.name}</Text>
                {member.email ? <Text style={styles.meta}>{member.email}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('projectMembers.addFor', { name: member.name })}
                  disabled={busy}
                  onPress={() => void useProjectMembersStore.getState().assign(member)}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{t('projectMembers.assign')}</Text>
                </Pressable>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  block: { gap: 10 },
  error: { color: '#c0392b', fontSize: 14 },
  meta: { fontSize: 12.5, color: '#555' },
  label: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  status: { fontSize: 13.5, fontWeight: '600' },
  row: { gap: 4, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  memberName: { fontSize: 16, fontWeight: '600' },
  button: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
  danger: { color: '#c0392b' },
});
