import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useOrganizationStore } from '@/organization/store';
import { type Project, useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';

const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

function ProjectCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const { t } = useTranslation();
  const channelId = useProjectsStore((state) => state.channelByProject[project.id]);
  const count = project.open_groups_count;
  const level = project.open_max_level && LEVELS.includes(project.open_max_level) ? project.open_max_level : 'debug';
  const health =
    typeof count !== 'number'
      ? null
      : count <= 0
        ? t('projects.healthCalm')
        : `${t('projects.healthOpen', { count })} · ${t(`projects.level.${level}`)}`;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.key}>{project.key}</Text>
        <Text numberOfLines={1} style={styles.name}>
          {project.name}
        </Text>
      </View>
      {project.description ? (
        <Text numberOfLines={3} style={styles.description}>
          {project.description}
        </Text>
      ) : null}
      {health ? <Text style={styles.health}>{health}</Text> : null}
      {channelId !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('projects.openChannel')} ${project.name}`}
          onPress={() => router.push({ pathname: '/channel', params: { id: String(channelId), name: project.name } })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{t('projects.openChannel')}</Text>
        </Pressable>
      ) : null}
      {canManage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('projects.edit')} ${project.name}`}
          onPress={() => router.push({ pathname: '/project-form', params: { id: String(project.id) } })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{t('projects.edit')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Projects() {
  const { t } = useTranslation();
  const userName = useAuthStore((state) => state.user?.name ?? null);
  const activeId = useOrganizationStore((state) => state.activeId);
  const canManage = useOrganizationStore((state) => state.canCreateProject());
  const { projects, loading, failed, loaded, load } = useProjectsStore();

  useEffect(() => {
    const state = useProjectsStore.getState();
    if (activeId !== null && !state.loaded && !state.loading && !state.failed) void state.load();
  }, [activeId]);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {userName ? t('projects.greeting', { name: userName }) : t('projects.title')}
      </Text>
      <Text style={styles.heading}>{t('projects.title')}</Text>
      {canManage ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/project-form')} style={styles.button}>
          <Text style={styles.buttonText}>{t('projects.new')}</Text>
        </Pressable>
      ) : null}
      {failed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('projects.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}>
            <Text style={styles.buttonText}>{t('projects.retry')}</Text>
          </Pressable>
        </View>
      ) : !loaded ? (
        <View style={styles.block}>
          <ActivityIndicator />
          <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.block}>
          <Text style={styles.emptyTitle}>{t('projects.empty')}</Text>
          <Text style={styles.description}>{t('projects.emptyHint')}</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(project) => String(project.id)}
          renderItem={({ item }) => <ProjectCard project={item} canManage={canManage} />}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={() => void load()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '600', color: '#555' },
  list: { gap: 12, paddingBottom: 24 },
  block: { gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 14 },
  card: { gap: 10, padding: 16, borderRadius: 10, borderWidth: 1, borderColor: '#ccc' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  key: { fontSize: 12, fontWeight: '700', color: '#555' },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  description: { fontSize: 14, color: '#555' },
  health: { fontSize: 13, color: '#555' },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#888',
  },
  buttonText: { fontSize: 16 },
});
