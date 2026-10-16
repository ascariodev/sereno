import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { config } from '@/config';
import { snippetsFor, type SnippetTab, tabsFor } from '@/integrations/snippets';
import { type ActionError, type IssuedSource, type LogSource, useIntegrationsStore } from '@/integrations/store';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { onReconnect, subscribeToProject } from '@/realtime/echo';

const NAME_MAX_LENGTH = 255;

function KeyNotice({ issued, connected }: { issued: IssuedSource; connected: boolean }) {
  const { t } = useTranslation();
  const ingestUrl = `${config.apiUrl}/api/ingest/events`;
  const tabs = tabsFor(issued.kind);
  const [selected, setSelected] = useState<SnippetTab>(tabs[0]);
  const activeTab = tabs.includes(selected) ? selected : tabs[0];
  const blocks = snippetsFor(activeTab, issued.key, config.apiUrl);
  return (
    <View style={styles.notice}>
      <Text accessibilityRole="header" style={styles.noticeTitle}>
        {t('integrations.keyTitle', { name: issued.name })}
      </Text>
      <Text accessibilityRole="alert" style={styles.warning}>
        {t('integrations.keyWarning')}
      </Text>
      <Text style={styles.status}>{connected ? t('integrations.connected') : t('integrations.waiting')}</Text>
      <Text style={styles.label}>{t('integrations.keyLabel')}</Text>
      <Text selectable testID="issued-key" style={styles.code}>
        {issued.key}
      </Text>
      <Text style={styles.label}>{t('integrations.endpoint')}</Text>
      <Text selectable style={styles.code}>
        {ingestUrl}
      </Text>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === activeTab }}
            onPress={() => setSelected(tab)}
            style={[styles.tab, tab === activeTab && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === activeTab && styles.tabTextActive]}>{t(`integrations.tab.${tab}`)}</Text>
          </Pressable>
        ))}
      </View>
      {activeTab === 'browser' ? (
        <Text testID="origin-notice" style={styles.meta}>
          {t('integrations.browserOrigin')} {issued.allowed_origins?.join(', ')}
        </Text>
      ) : null}
      {blocks.map((block) => (
        <View key={`${activeTab}-${block.id}`} style={styles.block}>
          <Text style={styles.label}>{t(`integrations.block.${block.id}`)}</Text>
          <Text selectable testID={`snippet-${block.id}`} style={styles.code}>
            {block.text}
          </Text>
        </View>
      ))}
      <Pressable accessibilityRole="button" onPress={() => useIntegrationsStore.getState().dismissIssued()} style={styles.primary}>
        <Text style={styles.primaryText}>{t('integrations.done')}</Text>
      </Pressable>
    </View>
  );
}

function SourceRow({ source, canChange, busy }: { source: LogSource; canChange: boolean; busy: boolean }) {
  const { t, i18n } = useTranslation();
  const format = (value: string) => new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  function confirm(kind: 'rotate' | 'revoke') {
    useIntegrationsStore.getState().clearFeedback();
    const rotate = kind === 'rotate';
    Alert.alert(
      rotate ? t('integrations.rotateTitle') : t('integrations.revokeTitle'),
      rotate ? t('integrations.rotateConfirm', { name: source.name }) : t('integrations.revokeConfirm', { name: source.name }),
      [
        { text: t('integrations.cancel'), style: 'cancel' },
        {
          text: rotate ? t('integrations.rotate') : t('integrations.revoke'),
          style: 'destructive',
          onPress: () => void (rotate ? useIntegrationsStore.getState().rotate(source) : useIntegrationsStore.getState().revoke(source)),
        },
      ],
    );
  }

  return (
    <View style={styles.row}>
      <Text style={styles.sourceName}>{source.name}</Text>
      <Text style={styles.meta}>{source.key_prefix}…</Text>
      <Text testID="source-kind" style={styles.meta}>
        {t('integrations.kind')}: {source.kind === 'browser' ? t('integrations.kindBrowser') : t('integrations.kindServer')}
      </Text>
      {source.kind === 'browser' && source.allowed_origins?.length ? (
        <Text testID="source-origins" style={styles.meta}>
          {t('integrations.origins')}: {source.allowed_origins.join(', ')}
        </Text>
      ) : null}
      <Text style={styles.meta}>
        {t('integrations.lastUsed')}: {source.last_used_at ? format(source.last_used_at) : t('integrations.neverUsed')}
      </Text>
      <Text style={styles.meta}>
        {t('integrations.created')}: {format(source.created_at)}
      </Text>
      {source.revoked_at ? (
        <Text style={styles.meta}>
          {t('integrations.revoked')}: {format(source.revoked_at)}
        </Text>
      ) : canChange ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('integrations.rotate')} ${source.name}`}
            disabled={busy}
            onPress={() => confirm('rotate')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t('integrations.rotate')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('integrations.revoke')} ${source.name}`}
            disabled={busy}
            onPress={() => confirm('revoke')}
            style={styles.button}
          >
            <Text style={[styles.buttonText, styles.danger]}>{t('integrations.revoke')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CreateForm({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting || disabled) return;
    const trimmed = name.trim();
    if (trimmed === '') return setError(t('integrations.nameRequired'));
    if ([...trimmed].length > NAME_MAX_LENGTH) return setError(t('integrations.nameTooLong', { max: NAME_MAX_LENGTH }));
    setError(null);
    setSubmitting(true);
    try {
      await useIntegrationsStore.getState().create(trimmed);
      setName('');
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      if (caught.status === 422) setError(Object.values(caught.errors).flat()[0] ?? caught.message);
      else if (caught.status === 403) setError(t('integrations.createForbidden'));
      else if (caught.status === 0) setError(t('integrations.network'));
      else setError(t('integrations.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>{t('integrations.nameLabel')}</Text>
      <TextInput
        accessibilityLabel={t('integrations.nameLabel')}
        style={styles.input}
        value={name}
        onChangeText={setName}
        editable={!submitting && !disabled}
        autoCorrect={false}
      />
      <Text style={styles.meta}>{t('integrations.nameHint')}</Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" disabled={submitting || disabled} onPress={() => void submit()} style={styles.primary}>
        <Text style={styles.primaryText}>{submitting ? t('integrations.creating') : t('integrations.create')}</Text>
      </Pressable>
    </View>
  );
}

const ACTION_ERRORS: Record<ActionError, string> = {
  conflict: 'integrations.rotateConflict',
  archived: 'integrations.rotateProjectArchived',
  revoked: 'integrations.rotateSourceRevoked',
  unavailable: 'integrations.rotateUnavailable',
  forbidden: 'integrations.actionForbidden',
  failed: 'integrations.actionFailed',
};

export default function Integrations() {
  const { t } = useTranslation();
  const { projectId: rawId, name } = useLocalSearchParams<{ projectId?: string; name?: string }>();
  const projectId = rawId !== undefined && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const project = useProjectsStore((state) => state.projects.find((item) => item.id === projectId));
  const projectsLoaded = useProjectsStore((state) => state.loaded);
  const projectsFailed = useProjectsStore((state) => state.failed);
  const organizationId = useOrganizationStore((state) => state.activeId);
  const allowed = useOrganizationStore((state) => state.canModerate());
  const sources = useIntegrationsStore((state) => state.sources);
  const issued = useIntegrationsStore((state) => state.issued);
  const loading = useIntegrationsStore((state) => state.loading);
  const failed = useIntegrationsStore((state) => state.failed);
  const actionError = useIntegrationsStore((state) => state.actionError);
  const revokedName = useIntegrationsStore((state) => state.revokedName);
  const busy = useIntegrationsStore((state) => state.busy);
  const known = project !== undefined;
  const archived = project?.archived_at != null;
  const notFound = projectId !== null && !known && projectsLoaded;
  const heading = project?.name ?? name;

  useEffect(() => {
    if (allowed && projectId !== null && known) void useIntegrationsStore.getState().open(projectId);
    return () => useIntegrationsStore.getState().clear();
  }, [allowed, projectId, known]);

  useEffect(() => {
    if (!allowed || projectId === null || organizationId === null) return;
    const unsubscribe = subscribeToProject(organizationId, projectId, {
      onLogSourceConnected: (event) => useIntegrationsStore.getState().applyConnected(event.id, event.last_used_at),
    });
    const unsubscribeReconnect = onReconnect(() => void useIntegrationsStore.getState().refresh());
    return () => {
      unsubscribe();
      unsubscribeReconnect();
    };
  }, [allowed, projectId, organizationId]);

  const issuedConnected = issued !== null && sources.find((item) => item.id === issued.id)?.last_used_at != null;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {heading ? `${t('integrations.title')} · ${heading}` : t('integrations.title')}
      </Text>
      {!allowed ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('integrations.noPermission')}
        </Text>
      ) : projectId === null ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('integrations.invalid')}
        </Text>
      ) : notFound ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('integrations.notFound')}
        </Text>
      ) : !known && projectsFailed ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('integrations.loadFailed')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void useProjectsStore.getState().load()} style={styles.button}>
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.meta}>{t('integrations.description')}</Text>
          {issued ? <KeyNotice issued={issued} connected={issuedConnected} /> : null}
          {actionError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t(ACTION_ERRORS[actionError])}
            </Text>
          ) : null}
          {revokedName ? (
            <Text accessibilityRole="alert" style={styles.status}>
              {t('integrations.revokedNotice', { name: revokedName })}
            </Text>
          ) : null}
          {known && !archived ? <CreateForm disabled={loading} /> : null}
          {failed ? (
            <View style={styles.block}>
              <Text accessibilityRole="alert" style={styles.error}>
                {t('integrations.loadFailed')}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void useIntegrationsStore.getState().open(projectId)} style={styles.button}>
                <Text style={styles.buttonText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : loading || !known ? (
            <View style={styles.block}>
              <ActivityIndicator />
              <Text accessibilityRole="progressbar">{t('common.loading')}</Text>
            </View>
          ) : sources.length === 0 ? (
            <Text style={styles.meta}>{t('integrations.empty')}</Text>
          ) : (
            sources.map((source) => <SourceRow key={source.id} source={source} canChange={!archived} busy={busy} />)
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
  label: { fontSize: 14, fontWeight: '600' },
  form: { gap: 6 },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#888', fontSize: 16 },
  row: { gap: 4, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  sourceName: { fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  button: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  buttonText: { fontSize: 16 },
  danger: { color: '#c0392b' },
  primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#111' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  notice: { gap: 6, padding: 12, borderRadius: 8, backgroundColor: '#fffbe6', borderWidth: 1, borderColor: '#e0c200' },
  noticeTitle: { fontSize: 16, fontWeight: '700' },
  warning: { fontSize: 13.5 },
  status: { fontSize: 13.5, fontWeight: '600' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { minHeight: 36, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#888' },
  tabActive: { backgroundColor: '#111', borderColor: '#111' },
  tabText: { fontSize: 14 },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  code: { padding: 8, borderRadius: 6, backgroundColor: '#f2f2f2', fontFamily: 'monospace', fontSize: 12.5 },
});
