import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  type ActionError,
  assignableRolesFor,
  canRemoveMember,
  type OrganizationMember,
  type Role,
  useOrganizationMembersStore,
} from '@/organization/members';
import { useOrganizationStore } from '@/organization/store';
import { onReconnect, subscribeToOrganizationMembers } from '@/realtime/echo';
import { useAuthStore } from '@/session/auth';

const NO_ROLES: string[] = [];

function errorText(error: ActionError, t: (key: string) => string): string {
  return error.kind === 'server' ? error.message : t(`members.${error.kind}`);
}

export default function Members() {
  const { t, i18n } = useTranslation();
  const organizationId = useOrganizationStore((state) => state.activeId);
  const organizationName = useOrganizationStore((state) => state.active()?.name ?? '');
  const roles = useOrganizationStore((state) => state.active()?.roles ?? NO_ROLES);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const members = useOrganizationMembersStore((state) => state.members);
  const loading = useOrganizationMembersStore((state) => state.loading);
  const failed = useOrganizationMembersStore((state) => state.failed);
  const busy = useOrganizationMembersStore((state) => state.busy);
  const actionError = useOrganizationMembersStore((state) => state.actionError);
  const notice = useOrganizationMembersStore((state) => state.notice);
  const isOwner = roles.includes('owner');
  const canWatch = isOwner || roles.includes('admin');
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (organizationId !== null) void useOrganizationMembersStore.getState().open();
    return () => useOrganizationMembersStore.getState().clear();
  }, [organizationId]);

  useEffect(() => {
    if (organizationId === null || !canWatch) return;
    return subscribeToOrganizationMembers(organizationId, () => void useOrganizationMembersStore.getState().refresh());
  }, [organizationId, canWatch]);

  useEffect(() => onReconnect(() => void useOrganizationMembersStore.getState().refresh()), []);

  function confirmRemove(member: OrganizationMember, self: boolean) {
    Alert.alert(
      self ? t('members.leaveTitle') : t('members.removeTitle'),
      self ? t('members.leaveConfirm', { organization: organizationName }) : t('members.removeConfirm', { name: member.name }),
      [
        { text: t('members.cancel'), style: 'cancel' },
        {
          text: self ? t('members.leaveAction') : t('members.removeAction'),
          style: 'destructive',
          onPress: () => {
            void useOrganizationMembersStore
              .getState()
              .remove(member)
              .then((left) => {
                if (left && pathnameRef.current === '/members') router.replace('/');
              });
          },
        },
      ],
    );
  }

  function confirmTransfer(member: OrganizationMember) {
    Alert.alert(t('members.transferTitle'), t('members.transferConfirm', { name: member.name }), [
      { text: t('members.cancel'), style: 'cancel' },
      {
        text: t('members.transferAction'),
        style: 'destructive',
        onPress: () => void useOrganizationMembersStore.getState().transfer(member),
      },
    ]);
  }

  function formatDate(value: string | null): string {
    return value ? new Date(value).toLocaleDateString(i18n.language, { dateStyle: 'medium' }) : '-';
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('members.title')}
      </Text>
      {failed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('members.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void useOrganizationMembersStore.getState().open()} style={styles.button}>
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
            <Text accessibilityRole="alert" style={styles.status}>
              {t(`members.${notice.kind}`, { name: notice.name })}
            </Text>
          ) : null}
          {actionError && !members.some((member) => member.id === actionError.id) ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {errorText(actionError, t)}
            </Text>
          ) : null}
          {members.length === 0 ? <Text style={styles.meta}>{t('members.empty')}</Text> : null}
          {members.map((member) => {
            const self = member.id === userId;
            const assignable = assignableRolesFor(roles, member.role).filter((role) => role !== member.role);
            const canRemove = self || canRemoveMember(roles, member.role);
            return (
              <View key={member.id} style={styles.row}>
                <Text style={styles.memberName}>{self ? `${member.name} (${t('members.you')})` : member.name}</Text>
                {member.email ? <Text style={styles.meta}>{member.email}</Text> : null}
                <Text style={styles.meta}>
                  {t('members.role')}: {member.role ? t(`members.roles.${member.role}`) : t('members.noRole')}
                </Text>
                <Text style={styles.meta}>
                  {t('members.joined')}: {formatDate(member.joined_at)}
                </Text>
                {actionError?.id === member.id ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {errorText(actionError, t)}
                  </Text>
                ) : null}
                {assignable.map((role: Role) => (
                  <Pressable
                    key={role}
                    accessibilityRole="button"
                    accessibilityLabel={t('members.changeRoleFor', { name: member.name, role: t(`members.roles.${role}`) })}
                    disabled={busy || loading}
                    onPress={() => void useOrganizationMembersStore.getState().changeRole(member, role)}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>{t('members.makeRole', { role: t(`members.roles.${role}`) })}</Text>
                  </Pressable>
                ))}
                {isOwner && !self ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('members.transferFor', { name: member.name })}
                    disabled={busy || loading}
                    onPress={() => confirmTransfer(member)}
                    style={styles.button}
                  >
                    <Text style={styles.buttonText}>{t('members.transfer')}</Text>
                  </Pressable>
                ) : null}
                {canRemove ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={self ? t('members.leaveTitle') : t('members.removeFor', { name: member.name })}
                    disabled={busy || loading}
                    onPress={() => confirmRemove(member, self)}
                    style={styles.button}
                  >
                    <Text style={[styles.buttonText, styles.danger]}>{self ? t('members.leave') : t('members.remove')}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
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
  status: { fontSize: 13.5, fontWeight: '600' },
  row: { gap: 6, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  memberName: { fontSize: 16, fontWeight: '600' },
  button: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
  danger: { color: '#c0392b' },
});
