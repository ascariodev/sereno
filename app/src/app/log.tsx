import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useLogGroupsStore } from '@/messages/logGroups';
import { isLogGroupOpenedPayload, isLogGroupStatusChangedPayload, levelTone } from '@/messages/payload';
import { type LogGroup, LOG_LEVELS, STATUS_FILTERS, useLogStore } from '@/log/store';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { onReconnect, subscribeToChannel } from '@/realtime/echo';

const LIVE_RELOAD_DELAY_MS = 300;

function GroupRow({ group, projectId }: { group: LogGroup; projectId: number }) {
  const { t, i18n } = useTranslation();
  const sharedTask = useLogGroupsStore((state) => state.tasks[group.id]);
  const status = useLogGroupsStore((state) => state.statuses[group.id]) ?? group.status;
  const task = group.task ?? sharedTask ?? null;
  const tone = levelTone(group.level);
  return (
    <View style={styles.row}>
      <Pressable
        testID={`group-${group.id}`}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/log-group', params: { projectId: String(projectId), id: String(group.id) } })}
        style={styles.rowMain}
      >
        <View style={styles.rowHead}>
          <Text style={styles.pill}>{t(`notice.level.${tone}`)}</Text>
          <Text style={styles.meta}>{t(`notice.status.${status}`)}</Text>
        </View>
        <Text style={styles.groupTitle}>{group.title}</Text>
        <Text style={styles.meta}>
          {group.events_count} {t('notice.eventsWord', { count: group.events_count })} ·{' '}
          {new Date(group.last_seen_at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
        </Text>
      </Pressable>
      {task ? (
        <Pressable
          testID={`group-task-${group.id}`}
          accessibilityRole="link"
          onPress={() => router.push({ pathname: '/task', params: { projectId: String(projectId), id: String(task.id) } })}
        >
          <Text style={styles.chip}>{t('notice.taskChip', { key: task.key })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Log() {
  const { t } = useTranslation();
  const { projectId: rawId, name } = useLocalSearchParams<{ projectId?: string; name?: string }>();
  const projectId = rawId !== undefined && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const projectName = useProjectsStore((state) => state.projects.find((item) => item.id === projectId)?.name);
  const channelId = useProjectsStore((state) => (projectId === null ? undefined : state.channelByProject[projectId]));
  const organizationId = useOrganizationStore((state) => state.activeId);
  const groups = useLogStore((state) => state.groups);
  const status = useLogStore((state) => state.status);
  const level = useLogStore((state) => state.level);
  const page = useLogStore((state) => state.page);
  const lastPage = useLogStore((state) => state.lastPage);
  const loading = useLogStore((state) => state.loading);
  const loadingMore = useLogStore((state) => state.loadingMore);
  const failed = useLogStore((state) => state.failed);
  const notFound = useLogStore((state) => state.notFound);
  const actionFailed = useLogStore((state) => state.actionFailed);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (projectId !== null) void useLogStore.getState().open(projectId);
    return () => useLogStore.getState().clear();
  }, [projectId]);

  useEffect(() => {
    if (channelId === undefined || organizationId === null) return;
    const scheduleReload = () => {
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null;
        void useLogStore.getState().refresh();
      }, LIVE_RELOAD_DELAY_MS);
    };
    const unsubscribe = subscribeToChannel(organizationId, channelId, {
      onCreated: (message) => {
        const payload = message.payload;
        if (isLogGroupOpenedPayload(payload) || isLogGroupStatusChangedPayload(payload)) {
          useProjectsStore.getState().refreshCounts();
        }
        if (!isLogGroupStatusChangedPayload(payload)) return;
        const row = useLogStore.getState().groups.find((item) => item.id === payload.log_group_id);
        if (row?.status !== payload.status) scheduleReload();
      },
      onMembersChanged: (projectId) => useMemberDirectoryStore.getState().invalidate(projectId),
    });
    const unsubscribeReconnect = onReconnect(() => {
      void useLogStore.getState().refresh();
      useProjectsStore.getState().refreshCounts();
    });
    return () => {
      unsubscribe();
      unsubscribeReconnect();
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    };
  }, [channelId, organizationId]);

  const { setFilters, loadMore, open } = useLogStore.getState();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {projectName ?? name ?? t('log.title')}
      </Text>
      {projectId === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('log.invalid')}
        </Text>
      ) : (
        <>
          <View accessibilityLabel={t('log.statusFilter.label')} style={styles.filters}>
            {STATUS_FILTERS.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: status === item }}
                onPress={() => void setFilters(item, level)}
                style={[styles.chipButton, status === item && styles.chipActive]}
              >
                <Text style={status === item ? styles.chipActiveText : undefined}>{t(`log.statusFilter.${item}`)}</Text>
              </Pressable>
            ))}
          </View>
          <View accessibilityLabel={t('log.level.label')} style={styles.filters}>
            {(['all', ...LOG_LEVELS] as const).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={item === 'all' ? t('log.level.all') : t('log.level.atLeast', { level: t(`notice.level.${item}`) })}
                accessibilityState={{ selected: level === item }}
                onPress={() => void setFilters(status, item)}
                style={[styles.chipButton, level === item && styles.chipActive]}
              >
                <Text style={level === item ? styles.chipActiveText : undefined}>
                  {item === 'all' ? t('log.level.all') : t(`notice.level.${item}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          {actionFailed ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t('log.loadFailed')}
            </Text>
          ) : null}
          {notFound ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t('log.notFound')}
            </Text>
          ) : failed ? (
            <View style={styles.block}>
              <Text accessibilityRole="alert" style={styles.error}>
                {t('log.loadFailed')}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void open(projectId)} style={styles.button}>
                <Text style={styles.buttonText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : loading && groups.length === 0 ? (
            <View style={styles.block}>
              <ActivityIndicator />
              <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
            </View>
          ) : groups.length === 0 ? (
            <Text style={styles.meta}>{t('log.empty')}</Text>
          ) : (
            <>
              {groups.map((group) => (
                <GroupRow key={group.id} group={group} projectId={projectId} />
              ))}
              {page < lastPage ? (
                <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.button}>
                  <Text style={styles.buttonText}>{t('log.showMore')}</Text>
                </Pressable>
              ) : null}
            </>
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipButton: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#888' },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipActiveText: { color: '#fff', fontWeight: '600' },
  row: { gap: 6, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  rowMain: { gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { fontSize: 11, fontWeight: '700', color: '#fff', backgroundColor: '#555', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  groupTitle: { fontSize: 13, fontWeight: '500', fontFamily: 'monospace' },
  meta: { fontSize: 12.5, color: '#555' },
  chip: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '500', backgroundColor: '#eef', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
});
