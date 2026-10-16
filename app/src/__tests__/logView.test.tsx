import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import '@/i18n';
import { router } from 'expo-router';

import { api } from '@/api/client';
import Log from '@/app/log';
import LogGroupDetail from '@/app/log-group';
import { useLogStore } from '@/log/store';
import { resetLogGroups } from '@/messages/logGroups';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import {
  disconnectRealtime,
  setRealtimeClientFactory,
  type RealtimeClient,
  type RealtimePayload,
} from '@/realtime/echo';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

let mockParams: Record<string, string> = { projectId: '3', name: 'Acme API' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function group(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    project_id: 3,
    level: 'error',
    title: `Group ${id}`,
    status: 'open',
    events_count: 4,
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-02T00:00:00Z',
    task: null,
    ...extra,
  };
}

function page(data: unknown[], current = 1, last = 1) {
  return { data, meta: { current_page: current, last_page: last } };
}

function project(archived: string | null = null) {
  useProjectsStore.setState({
    projects: [{ id: 3, name: 'Acme API', key: 'ACME', description: null, archived_at: archived }],
    channelByProject: {},
    loaded: true,
  });
}

beforeEach(() => {
  api.setTokenProvider(null);
  mockParams = { projectId: '3', name: 'Acme API' };
  useOrganizationStore.setState({ organizations: [], activeId: 7, loaded: true });
  useProjectsStore.getState().clear();
  useLogStore.getState().clear();
  resetLogGroups();
  (router.push as jest.Mock).mockClear();
});

function fakeClient() {
  const listeners = new Map<string, Map<string, (data: RealtimePayload) => void>>();
  const client: RealtimeClient = {
    private: (name) => {
      const channel = new Map<string, (data: RealtimePayload) => void>();
      listeners.set(name, channel);
      const handle = {
        listen: (event: string, callback: (data: RealtimePayload) => void) => {
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
    onConnectionChange: () => () => undefined,
  };
  return { client, emit: (name: string, event: string, data: RealtimePayload) => listeners.get(name)?.get(event)?.(data) };
}

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
});

describe('Log list', () => {
  it('loads open groups by default and sends the filters to the API', async () => {
    const fn = jest.fn(async (url: string) => json(page([group(1), group(2, { task: { id: 9, key: 'ACME-9', status: 'todo' } })])));
    globalThis.fetch = fn as never;
    await act(async () => {
      render(<Log />);
    });

    expect(await screen.findByText('Group 1')).toBeOnTheScreen();
    expect(screen.getByText('Task ACME-9')).toBeOnTheScreen();
    expect(fn.mock.calls[0][0]).toContain('status=open');
    expect(fn.mock.calls[0][0]).not.toContain('level=');

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Resolved' }));
    });
    expect(fn.mock.calls.at(-1)![0]).toContain('status=resolved');

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'error or higher' }));
    });
    const last = fn.mock.calls.at(-1)![0] as string;
    expect(last).toContain('status=resolved');
    expect(last).toContain('level=error');

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'All' }));
    });
    expect(fn.mock.calls.at(-1)![0]).not.toContain('status=');
  });

  it('appends the next page without duplicates', async () => {
    const fn = jest.fn(async (url: string) =>
      url.includes('page=2') ? json(page([group(2), group(3)], 2, 2)) : json(page([group(1), group(2)], 1, 2)),
    );
    globalThis.fetch = fn as never;
    await act(async () => {
      render(<Log />);
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('Show more'));
    });

    expect(screen.getAllByText(/^Group \d$/).map((node) => node.props.children)).toEqual(['Group 1', 'Group 2', 'Group 3']);
    expect(screen.queryByText('Show more')).toBeNull();
  });

  it('keeps the visible list when a later filter change fails', async () => {
    let fail = false;
    globalThis.fetch = jest.fn(async () => (fail ? json({ message: 'x' }, 500) : json(page([group(1)])))) as never;
    await act(async () => {
      render(<Log />);
    });
    expect(await screen.findByText('Group 1')).toBeOnTheScreen();
    fail = true;
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Resolved' }));
    });

    expect(screen.getByText('Group 1')).toBeOnTheScreen();
    expect(screen.getByText('Could not load the log groups.')).toBeOnTheScreen();
    expect(useLogStore.getState().status).toBe('open');
  });

  it('shows the empty state and opens a group', async () => {
    globalThis.fetch = jest.fn(async () => json(page([]))) as never;
    await act(async () => {
      render(<Log />);
    });
    expect(await screen.findByText('No log groups match these filters.')).toBeOnTheScreen();
  });

  it('shows not found without retry on a 404', async () => {
    globalThis.fetch = jest.fn(async () => json({ message: 'nf' }, 404)) as never;
    await act(async () => {
      render(<Log />);
    });
    expect(await screen.findByText('This project does not exist or you cannot access it.')).toBeOnTheScreen();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('refreshes when another user changes a group status', async () => {
    const fake = fakeClient();
    setRealtimeClientFactory(() => fake.client);
    useProjectsStore.setState({ projects: [], channelByProject: { 3: 50 }, loaded: true });
    const fn = jest.fn(async () => json(page([group(1)])));
    globalThis.fetch = fn as never;
    await act(async () => {
      render(<Log />);
    });
    await screen.findByText('Group 1');
    const before = fn.mock.calls.length;
    const message = {
      id: 90,
      channel_id: 50,
      kind: 'system',
      payload: { type: 'log.group_status_changed', log_group_id: 1, status: 'resolved', previous_status: 'open' },
    };
    await act(async () => fake.emit('organizations.7.channels.50', '.message.created', { message: message as never }));
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThan(before));
  });

  it('navigates to the detail', async () => {
    globalThis.fetch = jest.fn(async () => json(page([group(1)]))) as never;
    await act(async () => {
      render(<Log />);
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('group-1'));
    });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/log-group', params: { projectId: '3', id: '1' } });
  });
});

describe('Log group detail', () => {
  const detail = (extra: Record<string, unknown> = {}) =>
    group(5, {
      events: [{ id: 1, level: 'error', message: 'Boom', context: { user: 'ana' }, occurred_at: '2026-01-02T00:00:00Z', source: 'api' }],
      ...extra,
    });

  beforeEach(() => {
    mockParams = { projectId: '3', id: '5' };
  });

  it('shows the group, resolves it and updates the list', async () => {
    project();
    useLogStore.setState({ projectId: 3, groups: [group(5)] as never, status: 'open', everLoaded: true });
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({ data: detail({ status: 'resolved' }) });
      return json({ data: detail() });
    });
    globalThis.fetch = fn as never;
    await act(async () => {
      render(<LogGroupDetail />);
    });

    expect(await screen.findByText('Group 5')).toBeOnTheScreen();
    expect(screen.getByTestId('latest-event').props.children).toContain('Boom');
    expect(screen.getByText('Create task')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Resolve'));
    });

    expect(await screen.findByText('Marked as resolved')).toBeOnTheScreen();
    expect(screen.queryByText('Resolve')).toBeNull();
    expect(useLogStore.getState().groups).toEqual([]);
  });

  it('does not skip rows on the next page after resolving one', async () => {
    project();
    const resolved = new Set<number>();
    const all = [1, 2, 3, 4];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        resolved.add(1);
        return json({ data: detail({ id: 1, status: 'resolved' }) });
      }
      if (/log-groups\/1$/.test(url)) return json({ data: detail({ id: 1 }) });
      const open = all.filter((id) => !resolved.has(id));
      const at = url.includes('page=2') ? 2 : 1;
      return json(page(open.slice((at - 1) * 2, at * 2).map((id) => group(id)), at, Math.ceil(open.length / 2)));
    }) as never;
    await act(async () => {
      await useLogStore.getState().open(3);
    });
    mockParams = { projectId: '3', id: '1' };
    await act(async () => {
      render(<LogGroupDetail />);
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('Resolve'));
    });
    await screen.findByText('Marked as resolved');
    await waitFor(() => expect(useLogStore.getState().groups.map((item) => item.id)).toEqual([2, 3]));
    await act(async () => {
      await useLogStore.getState().loadMore();
    });

    expect(useLogStore.getState().groups.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it('hides create task in an archived project and links the existing task', async () => {
    project('2026-01-01T00:00:00Z');
    globalThis.fetch = jest.fn(async () => json({ data: detail() })) as never;
    await act(async () => {
      render(<LogGroupDetail />);
    });
    expect(await screen.findByText('Group 5')).toBeOnTheScreen();
    expect(screen.queryByText('Create task')).toBeNull();
  });

  it('links the task when the group has one', async () => {
    project();
    globalThis.fetch = jest.fn(async () => json({ data: detail({ task: { id: 9, key: 'ACME-9', status: 'todo' } }) })) as never;
    await act(async () => {
      render(<LogGroupDetail />);
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('View ACME-9'));
    });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/task', params: { projectId: '3', id: '9' } });
    expect(screen.queryByText('Create task')).toBeNull();
  });

  it('reports a missing group', async () => {
    project();
    globalThis.fetch = jest.fn(async () => json({ message: 'nf' }, 404)) as never;
    await act(async () => {
      render(<LogGroupDetail />);
    });
    expect(await screen.findByText('This log group does not exist or you cannot access it.')).toBeOnTheScreen();
  });
});
