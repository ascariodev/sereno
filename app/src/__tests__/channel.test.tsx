import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { api } from '@/api/client';
import Channel from '@/app/channel';
import Projects from '@/app/(tabs)/index';
import { useMessagesStore } from '@/messages/store';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';

const mockPush = jest.fn();
let mockParams: { id?: string; name?: string } = { id: '50', name: 'Acme API' };
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function message(id: number, extra: Record<string, unknown> = {}) {
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

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  mockPush.mockClear();
  mockParams = { id: '50', name: 'Acme API' };
});

describe('Channel messages store', () => {
  it('loads the newest page and pages backwards by cursor', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      url.includes('cursor=c1')
        ? json({ data: [message(1), message(2)], meta: { next_cursor: null } })
        : json({ data: [message(4), message(3)], meta: { next_cursor: 'c1' } }),
    );
    globalThis.fetch = fetchMock as never;

    await act(() => useMessagesStore.getState().open(50));
    expect(useMessagesStore.getState().messages.map((m) => m.id)).toEqual([3, 4]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/channels/50/messages?per_page=50');

    await act(() => useMessagesStore.getState().loadOlder());
    expect(useMessagesStore.getState().messages.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(useMessagesStore.getState().nextCursor).toBeNull();

    await act(() => useMessagesStore.getState().loadOlder());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('flags a failed load', async () => {
    globalThis.fetch = jest.fn(async () => json({}, 500)) as never;
    await act(() => useMessagesStore.getState().open(50));

    expect(useMessagesStore.getState().failed).toBe(true);
  });
});

describe('Channel screen', () => {
  it('renders user messages as plain text and marks deleted ones', async () => {
    globalThis.fetch = jest.fn(async () =>
      json({
        data: [
          message(3, { body: '**raw** <@7>', mentions: [{ id: 7, name: 'Bea' }] }),
          message(2, { body: null, deleted_at: '2026-01-02T00:00:00Z' }),
          message(1, { kind: 'system', body: 'fallback', payload: { type: 'log.group_opened', title: 'DB down' } }),
        ],
        meta: { next_cursor: null },
      }),
    ) as never;
    await render(<Channel />);

    expect(await screen.findByText('**raw** @Bea')).toBeOnTheScreen();
    expect(screen.getByTestId('mention')).toBeOnTheScreen();
    expect(screen.getByText('Acme API')).toBeOnTheScreen();
    expect(screen.getByText('This message was deleted.')).toBeOnTheScreen();
    expect(screen.getByText('DB down')).toBeOnTheScreen();
  });

  it('pages through the list when the first page is only system notices', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      url.includes('cursor=c1')
        ? json({ data: [message(1, { body: 'Older' })], meta: { next_cursor: null } })
        : json({ data: [message(2, { kind: 'system', body: 'Opened' })], meta: { next_cursor: 'c1' } }),
    );
    globalThis.fetch = fetchMock as never;
    await render(<Channel />);

    expect(await screen.findByText('Opened')).toBeOnTheScreen();
    await act(async () => {
      fireEvent(screen.getByTestId('messages-list'), 'endReached');
    });

    expect(await screen.findByText('Older')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a retry footer when loading older messages fails', async () => {
    let failOlder = true;
    globalThis.fetch = jest.fn(async (url: string) => {
      if (!url.includes('cursor=c1')) return json({ data: [message(2)], meta: { next_cursor: 'c1' } });
      return failOlder ? json({}, 500) : json({ data: [message(1, { body: 'Older' })], meta: { next_cursor: null } });
    }) as never;
    await render(<Channel />);
    await screen.findByText('Body 2');

    await act(async () => {
      fireEvent(screen.getByTestId('messages-list'), 'endReached');
    });
    const retry = await screen.findByText('Could not load older messages. Retry');
    failOlder = false;
    fireEvent.press(retry);

    expect(await screen.findByText('Older')).toBeOnTheScreen();
  });

  it('shows an error when the channel id is missing or invalid', async () => {
    mockParams = { id: 'abc' };
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as never;
    await render(<Channel />);

    expect(screen.getByText('This channel does not exist.')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the empty state', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [], meta: { next_cursor: null } })) as never;
    await render(<Channel />);

    expect(await screen.findByText('No messages yet.')).toBeOnTheScreen();
  });
});

describe('Project card link', () => {
  it('opens the channel of the project', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [], meta: { last_page: 1, next_cursor: null } })) as never;
    useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
    useOrganizationStore.setState({
      organizations: [{ id: 7, name: 'Acme', slug: 'acme', roles: ['member'] }],
      activeId: 7,
      loaded: true,
    });
    await act(() => useProjectsStore.getState().load());
    useProjectsStore.setState({
      projects: [{ id: 1, name: 'Project 1', key: 'P1', description: null, archived_at: null }],
      channelByProject: { 1: 50 },
      loaded: true,
    });
    await render(<Projects />);

    fireEvent.press(screen.getByLabelText('Open channel Project 1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/channel', params: { id: '50', name: 'Project 1' } });
  });
});
