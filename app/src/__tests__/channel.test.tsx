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

function opened(title: string, extra: Record<string, unknown> = {}) {
  return { type: 'log.group_opened', log_group_id: 9, level: 'error', title, events_count: 3, ...extra };
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
  it('renders each system payload type and a generic fallback', async () => {
    globalThis.fetch = jest.fn(async () =>
      json({
        data: [
          message(6, { kind: 'system', user: null, payload: { type: 'other.thing' } }),
          message(5, { kind: 'system', user: null, payload: opened('Bad', { type: 'log.group_opened', events_count: 'x' }) }),
          message(4, {
            kind: 'system',
            payload: { type: 'task.group_reopened', log_group_id: 9, task_id: 2, task_key: 'ACME-2' },
          }),
          message(3, {
            kind: 'system',
            payload: { type: 'task.created_from_group', log_group_id: 9, task_id: 2, task_key: 'ACME-2', task_status: 'todo' },
          }),
          message(2, {
            kind: 'system',
            payload: { type: 'log.group_status_changed', log_group_id: 9, title: 'DB down', status: 'resolved', previous_status: 'open' },
          }),
          message(1, { kind: 'system', payload: opened('Cache miss', { type: 'log.group_reopened' }) }),
        ],
        meta: { next_cursor: null },
      }),
    ) as never;
    await render(<Channel />);

    expect(await screen.findByText('Cache miss')).toBeOnTheScreen();
    expect(screen.getByText('error')).toBeOnTheScreen();
    expect(screen.getByText('Log group reopened')).toBeOnTheScreen();
    expect(screen.getByText('3 events')).toBeOnTheScreen();
    expect(screen.getByText('Ana marked DB down as resolved')).toBeOnTheScreen();
    expect(screen.getByText('Ana created task ACME-2 from this log group')).toBeOnTheScreen();
    expect(screen.getByText('The log group of task ACME-2 was reopened')).toBeOnTheScreen();
    expect(screen.getAllByText('System notice')).toHaveLength(2);
  });

  it('renders user messages as plain text and marks deleted ones', async () => {
    globalThis.fetch = jest.fn(async () =>
      json({
        data: [
          message(3, { body: '**raw** <@7>', mentions: [{ id: 7, name: 'Bea' }] }),
          message(2, { body: null, deleted_at: '2026-01-02T00:00:00Z' }),
          message(1, { kind: 'system', body: 'fallback', payload: opened('DB down') }),
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
        : json({ data: [message(2, { kind: 'system', body: null, payload: opened('Opened') })], meta: { next_cursor: 'c1' } }),
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

describe('Message composer', () => {
  function mockChannel(post: (body: unknown) => Response) {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? post(JSON.parse(String(init.body)))
        : json({ data: [message(1)], meta: { next_cursor: null } }),
    );
    globalThis.fetch = fetchMock as never;
    return fetchMock;
  }

  it('sends the body, inserts the returned message once and clears the field', async () => {
    const fetchMock = mockChannel((body) => json({ data: message(2, { body: (body as { body: string }).body }) }, 201));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'Hello there');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Hello there')).toBeOnTheScreen();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(String(post[0])).toContain('/api/channels/50/messages');
    expect(JSON.parse(String(post[1]?.body))).toEqual({ body: 'Hello there' });
    expect(screen.getByLabelText('Write a message').props.value).toBe('');

    await act(async () => {
      expect(useMessagesStore.getState().insert(message(2) as never)).toBe(false);
    });
    expect(useMessagesStore.getState().messages.map((m) => m.id)).toEqual([1, 2]);
  });

  it('keeps the text and shows the error when sending fails', async () => {
    mockChannel(() => json({ message: 'x' }, 500));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'Keep me');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Could not send the message.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Write a message').props.value).toBe('Keep me');
  });

  it('shows the rate limit and validation errors', async () => {
    let status = 429;
    mockChannel(() =>
      status === 429 ? json({ message: 'slow' }, 429) : json({ message: 'bad', errors: { body: ['Body is invalid.'] } }, 422),
    );
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.changeText(screen.getByLabelText('Write a message'), 'Hi');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('You are sending messages too fast. Try again in a moment.')).toBeOnTheScreen();

    status = 422;
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Body is invalid.')).toBeOnTheScreen();
  });

  it('disables sending when empty or over 4000 characters counted as characters', async () => {
    mockChannel(() => json({ data: message(2) }, 201));
    await render(<Channel />);
    await screen.findByText('Body 1');
    const input = screen.getByLabelText('Write a message');

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await fireEvent.changeText(input, '😀'.repeat(4000));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await fireEvent.changeText(input, '😀'.repeat(4001));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('The message cannot exceed 4000 characters.')).toBeOnTheScreen();
  });

  it('ignores a send answered after the channel was cleared and foreign-channel messages', async () => {
    let release: (() => void) | undefined;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return json({ data: message(2) }, 201);
      }
      return json({ data: [message(1)], meta: { next_cursor: null } });
    }) as never;
    await act(() => useMessagesStore.getState().open(50));

    let pending!: Promise<void>;
    await act(async () => {
      pending = useMessagesStore.getState().send('late');
    });
    await act(async () => useMessagesStore.getState().clear());
    release?.();
    await act(() => pending);

    expect(useMessagesStore.getState().messages).toEqual([]);
    await act(() => useMessagesStore.getState().open(50));
    await act(async () => {
      expect(useMessagesStore.getState().insert(message(9, { channel_id: 99 }) as never)).toBe(false);
    });
    expect(useMessagesStore.getState().messages.map((m) => m.id)).toEqual([1]);
  });
});
