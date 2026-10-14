import { act, render, screen } from '@testing-library/react-native';

import { api } from '@/api/client';
import Channel from '@/app/channel';
import { type Message, useMessagesStore } from '@/messages/store';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { disconnectRealtime, setRealtimeClientFactory, type ConnectionStatus, type RealtimeClient, type RealtimePayload } from '@/realtime/echo';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: '50', name: 'Acme API' }),
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function message(id: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    channel_id: 50,
    kind: 'user',
    body: `Body ${id}`,
    payload: null,
    parent_id: null,
    user: { id: 1, name: 'Ana' },
    mentions: [],
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
    ...extra,
  };
}

type Listener = (data: RealtimePayload) => void;

function fakeClient() {
  const listeners = new Map<string, Map<string, Listener>>();
  const connectionCallbacks = new Set<(status: ConnectionStatus) => void>();
  const left: string[] = [];
  let status: ConnectionStatus = 'connected';
  const client: RealtimeClient = {
    private: (name) => {
      const channel = new Map<string, Listener>();
      listeners.set(name, channel);
      const handle = {
        listen: (event: string, callback: Listener) => {
          channel.set(event, callback);
          return handle;
        },
        error: () => handle,
      };
      return handle;
    },
    leave: (name) => {
      left.push(name);
      listeners.delete(name);
    },
    disconnect: () => undefined,
    resume: () => undefined,
    connectionStatus: () => status,
    onConnectionChange: (callback) => {
      connectionCallbacks.add(callback);
      return () => connectionCallbacks.delete(callback);
    },
  };
  return {
    client,
    left,
    emit: (event: string, data: RealtimePayload) => listeners.get('organizations.7.channels.50')?.get(event)?.(data),
    isOpen: () => listeners.has('organizations.7.channels.50'),
    setStatus: (next: ConnectionStatus) => {
      status = next;
      connectionCallbacks.forEach((callback) => callback(next));
    },
  };
}

let fake: ReturnType<typeof fakeClient>;

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  useProjectsStore.setState({ projects: [], channelByProject: {}, loading: false, failed: false, loaded: true });
  useOrganizationStore.setState({ activeId: 7 });
  fake = fakeClient();
  setRealtimeClientFactory(() => fake.client);
});

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
});

describe('Channel live messages', () => {
  it('applies created, updated and deleted events and leaves the channel on exit', async () => {
    globalThis.fetch = jest.fn(async () =>
      json({ data: [message(2), message(1)], meta: { next_cursor: null } }),
    ) as never;
    const view = await render(<Channel />);
    expect(await screen.findByText('Body 2')).toBeOnTheScreen();

    await act(async () => fake.emit('.message.created', { message: message(3) }));
    expect(screen.getByText('Body 3')).toBeOnTheScreen();
    await act(async () => fake.emit('.message.created', { message: message(3) }));
    expect(screen.getAllByText('Body 3')).toHaveLength(1);

    await act(async () =>
      fake.emit('.message.updated', { message: message(3, { body: 'Changed', edited_at: '2026-01-02T00:00:00Z' }) }),
    );
    expect(screen.getByText('Changed')).toBeOnTheScreen();
    await act(async () =>
      fake.emit('.message.updated', { message: message(3, { body: 'Stale', edited_at: '2026-01-01T12:00:00Z' }) }),
    );
    expect(screen.queryByText('Stale')).toBeNull();

    await act(async () =>
      fake.emit('.message.deleted', { id: 2, channel_id: 50, parent_id: null, deleted_at: '2026-01-03T00:00:00Z' }),
    );
    expect(screen.getByText('This message was deleted.')).toBeOnTheScreen();
    expect(screen.queryByText('Body 2')).toBeNull();

    await act(async () => view.unmount());
    expect(fake.left).toEqual(['organizations.7.channels.50']);
  });

  it('keeps an early deletion for a message that arrives later', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [message(1)], meta: { next_cursor: null } })) as never;
    await render(<Channel />);
    await screen.findByText('Body 1');

    await act(async () =>
      fake.emit('.message.deleted', { id: 9, channel_id: 50, parent_id: null, deleted_at: '2026-01-03T00:00:00Z' }),
    );
    await act(async () => fake.emit('.message.created', { message: message(9) }));

    expect(screen.queryByText('Body 9')).toBeNull();
    expect(screen.getByText('This message was deleted.')).toBeOnTheScreen();
  });

  it('ignores events of other channels and replies', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [message(1)], meta: { next_cursor: null } })) as never;
    await render(<Channel />);
    await screen.findByText('Body 1');

    await act(async () => fake.emit('.message.created', { message: message(5, { channel_id: 51 }) }));
    await act(async () => fake.emit('.message.created', { message: message(6, { parent_id: 1 }) }));
    await act(async () => fake.emit('.message.created', {}));

    expect(useMessagesStore.getState().messages.map((m) => m.id)).toEqual([1]);
  });

  it('catches up after a reconnection', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls++;
      return calls === 1
        ? json({ data: [message(2), message(1)], meta: { next_cursor: null } })
        : json({ data: [message(4), message(2)], meta: { next_cursor: null } });
    }) as never;
    await render(<Channel />);
    await screen.findByText('Body 2');

    await act(async () => fake.setStatus('disconnected'));
    await act(async () => fake.setStatus('connected'));

    expect(useMessagesStore.getState().messages.map((m) => m.id)).toEqual([2, 4]);
  });
});
