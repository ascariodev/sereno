import { act } from '@testing-library/react-native';

import { api } from '@/api/client';
import { useNotificationsStore } from '@/notifications/store';
import { useOrganizationStore } from '@/organization/store';
import {
  disconnectRealtime,
  setRealtimeClientFactory,
  type ConnectionStatus,
  type RealtimeClient,
  type RealtimePayload,
} from '@/realtime/echo';

jest.mock('@/config', () => ({
  config: { apiUrl: 'http://api.test', reverb: { key: 'app-key', host: 'ws.test', port: 8086, scheme: 'http' } },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const acme = { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] };
const NOW = '2026-10-14T10:00:00Z';

const mention = (id: number, messageId: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'chat_mention',
  project_id: 1,
  data: {
    channel_id: 50,
    channel_name: 'General',
    message_id: messageId,
    parent_id: null,
    message_excerpt: 'hello',
    actor_id: 2,
    actor_name: 'Bea',
  },
  read_at: null,
  created_at: NOW,
  ...extra,
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const page = (data: unknown[], unread: number, next: string | null = null) =>
  json({ data, meta: { next_cursor: next, unread_count: unread } });

interface Deferred {
  url: string;
  resolve(response: Response): void;
}

function deferredApi() {
  const pending: Deferred[] = [];
  globalThis.fetch = jest.fn(
    (url: string) => new Promise<Response>((resolve) => pending.push({ url, resolve })),
  ) as never;
  return pending;
}

function fakeClient() {
  const listeners = new Map<string, (data: RealtimePayload) => void>();
  const connection: { callback: ((status: ConnectionStatus) => void) | null; status: ConnectionStatus } = {
    callback: null,
    status: 'connected',
  };
  const client: RealtimeClient = {
    private: () => ({
      listen(event, callback) {
        listeners.set(event, callback);
        return undefined;
      },
      error: () => undefined,
    }),
    leave: () => undefined,
    disconnect: () => undefined,
    resume: () => undefined,
    connectionStatus: () => connection.status,
    onConnectionChange: (callback) => {
      connection.callback = callback;
      return () => {
        connection.callback = null;
      };
    },
  };
  return {
    client,
    emit: (event: string, data: RealtimePayload) => listeners.get(event)?.(data),
    setStatus: (status: ConnectionStatus) => {
      connection.status = status;
      connection.callback?.(status);
    },
  };
}

const flush = () => act(async () => {});
const state = () => useNotificationsStore.getState();
const ids = () => state().notifications.map((row) => row.id);

let realtime: ReturnType<typeof fakeClient>;

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useOrganizationStore.getState().clear();
  useOrganizationStore.setState({ organizations: [acme], activeId: 7, loaded: true });
  state().stop();
  realtime = fakeClient();
  setRealtimeClientFactory(() => realtime.client);
});

afterEach(() => {
  state().stop();
  disconnectRealtime();
  setRealtimeClientFactory(null);
});

describe('live notifications', () => {
  it('adds a created notification once and bumps the counter', async () => {
    globalThis.fetch = jest.fn(async () => page([mention(1, 90)], 1)) as never;
    state().start(1);
    await flush();

    const created = { organization_id: 7, notification: mention(2, 91) };
    await act(async () => realtime.emit('.notification.created', created));
    await act(async () => realtime.emit('.notification.created', created));

    expect(ids()).toEqual([2, 1]);
    expect(state().unreadCount).toBe(2);
  });

  it('ignores events of another organization and malformed rows', async () => {
    globalThis.fetch = jest.fn(async () => page([], 0)) as never;
    state().start(1);
    await flush();

    await act(async () => realtime.emit('.notification.created', { organization_id: 8, notification: mention(2, 91) }));
    await act(async () => realtime.emit('.notification.created', { organization_id: 7, notification: { id: 'x' } }));

    expect(ids()).toEqual([]);
    expect(state().unreadCount).toBe(0);
  });

  it('keeps a notification that arrives while the refresh is in flight, and its count', async () => {
    const pending = deferredApi();
    state().start(1);
    await flush();

    await act(async () => realtime.emit('.notification.created', { organization_id: 7, notification: mention(5, 95) }));
    await act(async () => pending[0].resolve(page([mention(1, 90)], 1)));
    await flush();

    expect(ids()).toEqual([5, 1]);
    expect(state().unreadCount).toBe(2);
  });

  it('does not top up the count when the refresh page already has the live row', async () => {
    const pending = deferredApi();
    state().start(1);
    await flush();

    await act(async () => realtime.emit('.notification.created', { organization_id: 7, notification: mention(5, 95) }));
    await act(async () => pending[0].resolve(page([mention(5, 95), mention(1, 90)], 2)));
    await flush();

    expect(ids()).toEqual([5, 1]);
    expect(state().unreadCount).toBe(2);
  });

  it('removes a loaded notification when its mention is removed and adjusts the counter', async () => {
    globalThis.fetch = jest.fn(async () => page([mention(2, 91), mention(1, 90, { read_at: NOW })], 1)) as never;
    state().start(1);
    await flush();

    await act(async () => realtime.emit('.mention.removed', { organization_id: 7, message_id: 91 }));
    expect(ids()).toEqual([1]);
    expect(state().unreadCount).toBe(0);

    await act(async () => realtime.emit('.mention.removed', { organization_id: 7, message_id: 90 }));
    expect(ids()).toEqual([]);
    expect(state().unreadCount).toBe(0);
  });

  it('resyncs from the server when the removed mention is not loaded', async () => {
    let unread = 3;
    const fn = jest.fn(async () => page([mention(9, 99)], unread));
    globalThis.fetch = fn as never;
    state().start(1);
    await flush();

    unread = 2;
    await act(async () => realtime.emit('.mention.removed', { organization_id: 7, message_id: 12 }));
    await flush();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(state().unreadCount).toBe(2);
  });

  it('does not bring back a removed mention from a refresh that started before', async () => {
    const pending = deferredApi();
    state().start(1);
    await flush();

    await act(async () => realtime.emit('.mention.removed', { organization_id: 7, message_id: 90 }));
    await flush();
    const stale = pending[0];
    await act(async () => stale.resolve(page([mention(1, 90), mention(3, 92)], 2)));
    await flush();

    expect(ids()).toEqual([3]);
    expect(state().unreadCount).toBe(1);
  });

  it('shows the row of a mention added back after it was removed', async () => {
    globalThis.fetch = jest.fn(async () => page([], 0)) as never;
    state().start(1);
    await flush();

    await act(async () => realtime.emit('.mention.removed', { organization_id: 7, message_id: 90 }));
    await act(async () => realtime.emit('.notification.created', { organization_id: 7, notification: mention(4, 90) }));
    await flush();

    expect(ids()).toEqual([4]);
    expect(state().unreadCount).toBe(1);
  });

  it('does not bring back a removed mention on a later page', async () => {
    const fn = jest.fn(async (url: string) =>
      url.includes('cursor') ? page([mention(2, 91), mention(1, 90)], 2) : page([mention(3, 92)], 3, 'c1'),
    );
    globalThis.fetch = fn as never;
    state().start(1);
    await flush();

    const more = state().loadMore();
    await act(async () => realtime.emit('.mention.removed', { organization_id: 7, message_id: 90 }));
    await act(async () => more);
    await flush();

    expect(ids()).toEqual([3, 2]);
  });

  it('refreshes on organization change only while started', async () => {
    const fn = jest.fn(async () => page([mention(1, 90)], 1));
    globalThis.fetch = fn as never;
    state().start(1);
    await flush();
    fn.mockClear();

    await act(async () => useOrganizationStore.setState({ activeId: 8 }));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);

    state().stop();
    fn.mockClear();
    await act(async () => useOrganizationStore.setState({ activeId: 7 }));
    await flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('refreshes after a reconnection', async () => {
    let rows = [mention(1, 90)];
    const fn = jest.fn(async () => page(rows, rows.length));
    globalThis.fetch = fn as never;
    state().start(1);
    await flush();

    rows = [mention(2, 91), mention(1, 90)];
    await act(async () => realtime.setStatus('disconnected'));
    await act(async () => realtime.setStatus('connected'));
    await flush();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual([2, 1]);
    expect(state().unreadCount).toBe(2);
  });

  it('stops listening and clears on stop', async () => {
    globalThis.fetch = jest.fn(async () => page([mention(1, 90)], 1)) as never;
    state().start(1);
    await flush();

    state().stop();

    expect(ids()).toEqual([]);
    expect(state().unreadCount).toBe(0);
  });
});
