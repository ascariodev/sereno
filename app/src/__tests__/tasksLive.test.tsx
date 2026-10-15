import { act, render, screen } from '@testing-library/react-native';

import { api } from '@/api/client';
import Tasks from '@/app/tasks';
import { resetLogGroups } from '@/messages/logGroups';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import {
  disconnectRealtime,
  setRealtimeClientFactory,
  type ConnectionStatus,
  type RealtimeClient,
  type RealtimePayload,
} from '@/realtime/echo';
import { useAuthStore } from '@/session/auth';
import { type TaskComment, useTaskCommentsStore } from '@/tasks/comments';
import { type Task, useTasksStore } from '@/tasks/store';
import { useProjectLive } from '@/tasks/useProjectLive';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ projectId: '3', name: 'Acme API' }),
}));

const CHANNEL = 'organizations.7.projects.3';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function task(id: number, status: string, position: number, extra: Record<string, unknown> = {}): Task {
  return {
    id,
    project_id: 3,
    key: `ACME-${id}`,
    title: `Task ${id}`,
    description: null,
    status,
    position,
    assignee: null,
    log_group: null,
    comments_count: 0,
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...extra,
  } as Task;
}

function comment(id: number, extra: Partial<TaskComment> = {}): TaskComment {
  return {
    id,
    task_id: 11,
    body: `Comment ${id}`,
    user: { id: 1, name: 'Ana' },
    mentions: [],
    attachments: [],
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
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
    emit: (event: string, data: RealtimePayload) => listeners.get(CHANNEL)?.get(event)?.(data),
    reconnect: () => {
      for (const next of ['disconnected', 'connected'] as ConnectionStatus[]) {
        status = next;
        connectionCallbacks.forEach((callback) => callback(next));
      }
    },
  };
}

function LiveProbe() {
  useProjectLive(3);
  return null;
}

let fake: ReturnType<typeof fakeClient>;

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useOrganizationStore.setState({ organizations: [], activeId: 7, loaded: true });
  useProjectsStore.getState().clear();
  useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
  useTasksStore.getState().clear();
  useTasksStore.getState().setFilter('all');
  useTaskCommentsStore.getState().clear();
  resetLogGroups();
  fake = fakeClient();
  setRealtimeClientFactory(() => fake.client);
});

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
});

const ids = () => useTasksStore.getState().tasks.map((item) => item.id).sort((a, b) => a - b);

describe('Tasks live on the board', () => {
  it('applies task and comment events and leaves the project channel on exit', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [task(1, 'todo', 1)], meta: {} })) as never;
    const view = await render(<Tasks />);
    expect(await screen.findByText('Task 1')).toBeOnTheScreen();

    await act(async () => fake.emit('.task.created', { task: task(2, 'in_progress', 1) }));
    expect(screen.getByText('Task 2')).toBeOnTheScreen();

    await act(async () =>
      fake.emit('.task.updated', { task: task(2, 'done', 1, { title: 'Moved', updated_at: '2026-01-02T00:00:00.000002Z' }) }),
    );
    expect(screen.getByText('Moved')).toBeOnTheScreen();
    await act(async () =>
      fake.emit('.task.updated', { task: task(2, 'todo', 1, { title: 'Stale', updated_at: '2026-01-02T00:00:00.000001Z' }) }),
    );
    expect(screen.queryByText('Stale')).toBeNull();

    await act(async () => fake.emit('.task.comment.created', { comment: comment(5, { task_id: 1 }), comments_count: 3 }));
    expect(screen.getByText('3 comments')).toBeOnTheScreen();
    await act(async () => fake.emit('.task.comment.deleted', { id: 5, task_id: 1, comments_count: 1 }));
    expect(screen.getByText('1 comment')).toBeOnTheScreen();

    await act(async () => fake.emit('.task.deleted', { id: 2, project_id: 3 }));
    expect(screen.queryByText('Moved')).toBeNull();
    await act(async () => fake.emit('.task.updated', { task: task(2, 'todo', 1, { updated_at: '2026-01-05T00:00:00Z' }) }));
    expect(screen.queryByText('Task 2')).toBeNull();

    await act(async () => fake.emit('.task.created', { task: task(9, 'todo', 1, { project_id: 4 }) }));
    await act(async () => fake.emit('.task.created', { task: { id: 10, project_id: 3 } as never }));
    expect(ids()).toEqual([1]);

    await act(async () => view.unmount());
    expect(fake.left).toEqual([CHANNEL]);
  });

  it('keeps live changes that arrive while the board loads', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    let opened!: Promise<void>;
    await act(async () => {
      opened = useTasksStore.getState().open(3);
    });

    useTasksStore.getState().insert(task(4, 'todo', 4));
    useTasksStore.getState().replace(task(1, 'in_review', 1, { title: 'Live', updated_at: '2026-01-02T00:00:00Z' }));
    useTasksStore.getState().remove(3, 2);

    await act(async () => {
      pending.resolve(json({ data: [task(1, 'todo', 1), task(2, 'todo', 2), task(3, 'todo', 3)], meta: {} }));
      await opened;
    });

    expect(ids()).toEqual([1, 3, 4]);
    expect(useTasksStore.getState().tasks.find((item) => item.id === 1)?.title).toBe('Live');
  });

  it('drops on refresh the tasks deleted while disconnected and keeps those created during it', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [task(1, 'todo', 1), task(2, 'todo', 2)], meta: {} })) as never;
    await useTasksStore.getState().open(3);

    const pending = deferred<Response>();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    let refreshed!: Promise<boolean>;
    await act(async () => {
      refreshed = useTasksStore.getState().refresh();
    });
    useTasksStore.getState().insert(task(5, 'todo', 5));
    await act(async () => {
      pending.resolve(json({ data: [task(1, 'todo', 1, { title: 'Server' })], meta: {} }));
      await refreshed;
    });

    expect(ids()).toEqual([1, 5]);
    expect(useTasksStore.getState().tasks.find((item) => item.id === 1)?.title).toBe('Server');
  });

  it('refreshes tasks and comments once on reconnection, even with two screens mounted', async () => {
    const fetchMock = jest.fn(async (url: string) =>
      url.includes('/comments') ? json({ data: [], meta: { next_cursor: null } }) : json({ data: [task(1, 'todo', 1)], meta: {} }),
    );
    globalThis.fetch = fetchMock as never;
    await useTasksStore.getState().open(3);
    await useTaskCommentsStore.getState().open(3, 11);
    await render(
      <>
        <LiveProbe />
        <LiveProbe />
      </>,
    );
    fetchMock.mockClear();

    await act(async () => fake.reconnect());

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes('/api/projects/3/tasks?'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/api/projects/3/tasks/11/comments'))).toHaveLength(1);
  });
});

describe('Task comments live', () => {
  it('applies comment events of the open task only', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [comment(1)], meta: { next_cursor: null } })) as never;
    await useTaskCommentsStore.getState().open(3, 11);
    await render(<LiveProbe />);

    await act(async () => fake.emit('.task.comment.created', { comment: comment(2), comments_count: 2 }));
    await act(async () => fake.emit('.task.comment.created', { comment: comment(3, { task_id: 12 }), comments_count: 1 }));
    await act(async () =>
      fake.emit('.task.comment.updated', { comment: comment(1, { body: 'Edited', edited_at: '2026-01-02T00:00:00Z' }) }),
    );
    await act(async () =>
      fake.emit('.task.comment.updated', { comment: comment(1, { body: 'Older', edited_at: '2026-01-01T12:00:00Z' }) }),
    );
    await act(async () => fake.emit('.task.comment.created', { comment: { id: 4, task_id: 11 } as never }));

    const { comments } = useTaskCommentsStore.getState();
    expect(comments.map((item) => [item.id, item.body])).toEqual([
      [1, 'Edited'],
      [2, 'Comment 2'],
    ]);

    await act(async () => fake.emit('.task.comment.deleted', { id: 2, task_id: 11, comments_count: 1 }));
    expect(useTaskCommentsStore.getState().comments.map((item) => item.id)).toEqual([1]);
  });

  it('keeps live comments and deletions that arrive while the list loads', async () => {
    const pending = deferred<Response>();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    let opened!: Promise<void>;
    await act(async () => {
      opened = useTaskCommentsStore.getState().open(3, 11);
    });

    useTaskCommentsStore.getState().insert(comment(4));
    useTaskCommentsStore.getState().remove(2);

    await act(async () => {
      pending.resolve(json({ data: [comment(1), comment(2), comment(3)], meta: { next_cursor: null } }));
      await opened;
    });

    expect(useTaskCommentsStore.getState().comments.map((item) => item.id)).toEqual([1, 3, 4]);
    useTaskCommentsStore.getState().insert(comment(2));
    expect(useTaskCommentsStore.getState().comments.map((item) => item.id)).toEqual([1, 3, 4]);
  });

  it('merges the newest page on refresh and replaces the list when it does not reach the loaded comments', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [comment(1), comment(2)], meta: { next_cursor: 'c1' } })) as never;
    await useTaskCommentsStore.getState().open(3, 11);

    globalThis.fetch = jest.fn(async () => json({ data: [comment(2), comment(3)], meta: { next_cursor: 'c2' } })) as never;
    await useTaskCommentsStore.getState().refresh();
    expect(useTaskCommentsStore.getState().comments.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(useTaskCommentsStore.getState().nextCursor).toBe('c1');

    globalThis.fetch = jest.fn(async () => json({ data: [comment(40), comment(41)], meta: { next_cursor: 'c40' } })) as never;
    await useTaskCommentsStore.getState().refresh();
    expect(useTaskCommentsStore.getState().comments.map((item) => item.id)).toEqual([40, 41]);
    expect(useTaskCommentsStore.getState().nextCursor).toBe('c40');
  });

  it('waits for the first load and skips the refresh if it failed', async () => {
    const pending = deferred<Response>();
    const fetchMock = jest.fn(() => pending.promise);
    globalThis.fetch = fetchMock as never;
    let opened!: Promise<void>;
    await act(async () => {
      opened = useTaskCommentsStore.getState().open(3, 11);
    });
    let refreshed!: Promise<void>;
    await act(async () => {
      refreshed = useTaskCommentsStore.getState().refresh();
    });
    await act(async () => {
      pending.resolve(json({ message: 'Server Error' }, 500));
      await opened;
      await refreshed;
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useTaskCommentsStore.getState().failed).toBe(true);
  });
});
