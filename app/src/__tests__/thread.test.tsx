import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import Channel from '@/app/channel';
import Thread from '@/app/thread';
import { type Message, useMessagesStore } from '@/messages/store';
import { useThreadStore } from '@/messages/threadStore';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { disconnectRealtime, setRealtimeClientFactory, type ConnectionStatus, type RealtimeClient, type RealtimePayload } from '@/realtime/echo';
import { router } from 'expo-router';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
const mockParams: Record<string, string> = { id: '50', name: 'Acme API' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
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
    replies_count: 0,
    last_reply_at: null,
    recent_participants: [],
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
    leave: (name) => void listeners.delete(name),
    disconnect: () => undefined,
    resume: () => undefined,
    connectionStatus: () => 'connected',
    onConnectionChange: (callback) => {
      connectionCallbacks.add(callback);
      return () => connectionCallbacks.delete(callback);
    },
  };
  return {
    client,
    emit: (event: string, data: RealtimePayload) => listeners.get('organizations.7.channels.50')?.get(event)?.(data),
    setStatus: (next: ConnectionStatus) => connectionCallbacks.forEach((callback) => callback(next)),
  };
}

let fake: ReturnType<typeof fakeClient>;

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  useThreadStore.getState().clear();
  useProjectsStore.setState({ projects: [], channelByProject: {}, loading: false, failed: false, loaded: true });
  useOrganizationStore.setState({ activeId: 7 });
  fake = fakeClient();
  setRealtimeClientFactory(() => fake.client);
  jest.mocked(router.push).mockClear();
  mockParams.id = '50';
  mockParams.channelId = undefined as never;
});

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
});

describe('Thread screen', () => {
  it('opens the thread from the summary of a message', async () => {
    globalThis.fetch = jest.fn(async () =>
      json({ data: [message(1, { replies_count: 2, last_reply_at: '2026-01-01T10:00:00Z' })], meta: { next_cursor: null } }),
    ) as never;
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('2 replies'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/thread', params: { channelId: '50', id: '1' } });
  });

  it('shows the root and its replies and sends a reply', async () => {
    mockParams.channelId = '50';
    mockParams.id = '1';
    const root = message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' });
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json({ data: message(6, { parent_id: 1, body: 'My reply', created_at: '2026-01-01T11:00:00Z' }) }, 201);
      }
      return json({ data: [message(5, { parent_id: 1, body: 'First reply', created_at: '2026-01-01T10:00:00Z' })], meta: { next_cursor: null, root } });
    });
    globalThis.fetch = fetchMock as never;
    await render(<Thread />);

    expect(await screen.findByText('First reply')).toBeOnTheScreen();
    expect(screen.getByText('Body 1')).toBeOnTheScreen();
    expect(screen.getByText('1 reply')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Reply in thread'), 'My reply');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('My reply')).toBeOnTheScreen();
    expect(screen.getByText('2 replies')).toBeOnTheScreen();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ body: 'My reply', parent_id: 1 });
  });

  it('shows an error with retry when the thread cannot be loaded', async () => {
    mockParams.channelId = '50';
    mockParams.id = '1';
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls++;
      return calls === 1 ? json({}, 500) : json({ data: [], meta: { next_cursor: null, root: message(1) } });
    }) as never;
    await render(<Thread />);
    expect(await screen.findByText('Could not load the thread.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByText('No replies yet.')).toBeOnTheScreen();
  });

  it('shows not found for a missing thread', async () => {
    mockParams.channelId = '50';
    mockParams.id = '1';
    globalThis.fetch = jest.fn(async () => json({ message: 'x' }, 404)) as never;
    await render(<Thread />);
    expect(await screen.findByText('This thread does not exist or was removed.')).toBeOnTheScreen();
  });

  it('receives live replies, edits and deletions forwarded by the channel, and catches up on reconnect', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' })], meta: { next_cursor: null } })) as never;
    await render(<Channel />);
    await screen.findByText('1 reply');

    let calls = 0;
    const root = message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' });
    globalThis.fetch = jest.fn(async () => {
      calls++;
      return calls === 1
        ? json({ data: [message(5, { parent_id: 1, body: 'First reply', created_at: '2026-01-01T10:00:00Z' })], meta: { next_cursor: null, root } })
        : json({
            data: [message(8, { parent_id: 1, body: 'Missed reply', created_at: '2026-01-01T13:00:00Z' }), message(6, { parent_id: 1, body: 'Live reply', created_at: '2026-01-01T11:00:00Z' })],
            meta: { next_cursor: null, root: message(1, { replies_count: 3, last_reply_at: '2026-01-01T13:00:00Z' }) },
          });
    }) as never;
    await act(async () => {
      await useThreadStore.getState().open(50, 1);
    });

    await act(async () => fake.emit('.message.created', { message: message(6, { parent_id: 1, body: 'Live reply', created_at: '2026-01-01T11:00:00Z' }) }));
    expect(useThreadStore.getState().replies.map((r) => r.id)).toEqual([5, 6]);

    await act(async () => fake.emit('.message.updated', { message: message(6, { parent_id: 1, body: 'Edited reply', created_at: '2026-01-01T11:00:00Z', edited_at: '2026-01-02T00:00:00Z' }) }));
    expect(useThreadStore.getState().replies[1].body).toBe('Edited reply');

    await act(async () =>
      fake.emit('.message.deleted', { id: 5, channel_id: 50, parent_id: 1, deleted_at: '2026-01-03T00:00:00Z', root: { id: 1, replies_count: 1, last_reply_at: '2026-01-01T11:00:00Z' } }),
    );
    expect(useThreadStore.getState().replies.map((r) => r.id)).toEqual([6]);

    await act(async () => fake.setStatus('disconnected'));
    await act(async () => fake.setStatus('connected'));
    await waitFor(() => expect(useThreadStore.getState().replies.map((r) => r.id)).toEqual([6, 8]));
  });
});
