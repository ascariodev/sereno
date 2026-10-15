import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { api } from '@/api/client';
import TaskScreen from '@/app/task';
import Tasks from '@/app/tasks';
import '@/i18n';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';
import { useTasksStore } from '@/tasks/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
let mockParams: Record<string, string> = { projectId: '3' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function task(id: number, status: string, position: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    project_id: 3,
    key: `ACME-${id}`,
    title: `Task ${id}`,
    description: null,
    status,
    position,
    created_by: 1,
    assignee: null,
    log_group: null,
    comments_count: 0,
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...extra,
  };
}

const board = [task(1, 'todo', 1, { assignee: { id: 1, name: 'Ana' } }), task(2, 'todo', 2), task(3, 'todo', 3), task(4, 'done', 1)];

function mockApi(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    if ((!init?.method || init.method === 'GET') && url.includes('/comments')) return json({ data: [], meta: { next_cursor: null } });
    if ((!init?.method || init.method === 'GET') && url.includes('/api/projects/3/tasks')) {
      return json({ data: board, meta: {} });
    }
    return handler(url, init);
  });
  globalThis.fetch = fn as never;
  return fn;
}

function bodyOf(fn: jest.Mock, suffix: string) {
  const call = fn.mock.calls.find(([url, init]) => String(url).endsWith(suffix) && init?.method === 'POST');
  return call ? JSON.parse(call[1].body as string) : null;
}

beforeEach(() => {
  jest.restoreAllMocks();
  (router.back as jest.Mock).mockClear();
  mockParams = { projectId: '3' };
  api.setTokenProvider(null);
  useOrganizationStore.setState({ organizations: [], activeId: 7, loaded: true });
  useProjectsStore.getState().clear();
  useMemberDirectoryStore.getState().clear();
  useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
  useTasksStore.getState().clear();
  useTasksStore.getState().setFilter('all');
});

describe('move menu', () => {
  async function openBoard() {
    await act(async () => {
      render(<Tasks />);
    });
    await screen.findByText('Task 2');
  }

  it('moves a task up with its neighbours and applies the server task', async () => {
    const fn = mockApi((url) =>
      url.endsWith('/tasks/2/move')
        ? json({ data: task(2, 'todo', 0.5, { updated_at: '2026-01-02T00:00:00.000000Z' }) })
        : json({}),
    );
    await openBoard();

    await fireEvent.press(screen.getByLabelText('Move ACME-2'));
    await act(async () => {
      await fireEvent.press(screen.getByText('Move up'));
    });

    expect(bodyOf(fn, '/tasks/2/move')).toEqual({ status: 'todo', after_id: null, before_id: 1 });
    expect(useTasksStore.getState().tasks.find((item) => item.id === 2)?.position).toBe(0.5);
  });

  it('moves to another column at the end, using the full column even with a filter', async () => {
    const fn = mockApi((url) => (url.endsWith('/tasks/1/move') ? json({ data: task(1, 'done', 2) }) : json({})));
    await openBoard();
    await act(async () => {
      useTasksStore.getState().setFilter('mine');
    });

    await fireEvent.press(screen.getByLabelText('Move ACME-1'));
    await act(async () => {
      await fireEvent.press(screen.getByText('Move to Done'));
    });

    expect(bodyOf(fn, '/tasks/1/move')).toEqual({ status: 'done', after_id: 4 });
    expect(useTasksStore.getState().tasks.find((item) => item.id === 1)?.status).toBe('done');
  });

  it('disables moving up the first task', async () => {
    mockApi(() => json({}));
    await openBoard();

    await fireEvent.press(screen.getByLabelText('Move ACME-1'));
    expect(screen.getByText('Move up')).toBeDisabled();
    expect(screen.getByText('Move down')).toBeEnabled();
  });

  it('shows the error and keeps the task where it was when the move fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockApi(() => json({ message: 'no' }, 403));
    await openBoard();

    await fireEvent.press(screen.getByLabelText('Move ACME-2'));
    await act(async () => {
      await fireEvent.press(screen.getByText('Move down'));
    });

    expect(alert).toHaveBeenCalledWith('You are not allowed to move this task.');
    expect(useTasksStore.getState().tasks.find((item) => item.id === 2)?.position).toBe(2);
  });

  it('offers no move menu in an archived project', async () => {
    useProjectsStore.setState({ projects: [{ id: 3, name: 'Acme', archived_at: '2026-01-01T00:00:00Z' }] as never });
    mockApi(() => json({}));
    await openBoard();

    expect(screen.queryByLabelText('Move ACME-1')).toBeNull();
  });
});

describe('delete task', () => {
  async function openTask(id: string, tasks: unknown[] = board) {
    mockParams = { projectId: '3', id };
    await act(async () => {
      useTasksStore.setState({ projectId: 3, tasks: tasks as never });
      render(<TaskScreen />);
    });
  }

  function confirm(alert: jest.SpyInstance) {
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    return buttons.find((button) => button.text === 'Delete')?.onPress;
  }

  it('asks for confirmation, deletes, forgets the task and closes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const fn = mockApi(() => new Response(null, { status: 204 }));
    await openTask('2');

    await fireEvent.press(screen.getByText('Delete task'));
    expect(alert.mock.calls[0][0]).toBe('Delete task');
    expect(fn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await act(async () => {
      confirm(alert)?.();
    });

    expect(fn.mock.calls.some(([url, init]) => String(url).endsWith('/tasks/2') && init?.method === 'DELETE')).toBe(true);
    expect(useTasksStore.getState().tasks.some((item) => item.id === 2)).toBe(false);
    expect(router.back).toHaveBeenCalled();
  });

  it('does not bring a deleted task back through ensure or a late response', async () => {
    mockApi(() => new Response(null, { status: 204 }));
    await act(async () => {
      useTasksStore.setState({ projectId: 3, tasks: board as never });
      await useTasksStore.getState().destroy(3, 2);
    });
    await act(async () => {
      expect(await useTasksStore.getState().ensure(3, 2)).toBeNull();
    });
    expect(useTasksStore.getState().tasks.some((item) => item.id === 2)).toBe(false);
  });

  it('keeps the task and reports a forbidden delete', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockApi(() => json({ message: 'no' }, 403));
    await openTask('2');

    await fireEvent.press(screen.getByText('Delete task'));
    await act(async () => {
      confirm(alert)?.();
    });

    expect(alert).toHaveBeenLastCalledWith('You are not allowed to delete this task.');
    expect(useTasksStore.getState().tasks.some((item) => item.id === 2)).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('hides delete for a member who did not create the task', async () => {
    mockApi(() => json({}));
    useOrganizationStore.setState({ organizations: [{ id: 7, name: 'O', slug: 'o', roles: ['member'] }] });
    await openTask('2', [task(2, 'todo', 2, { created_by: 9 })]);

    expect(screen.getByText('Edit task')).toBeOnTheScreen();
    expect(screen.queryByText('Delete task')).toBeNull();
  });

  it('shows delete to an admin for a task of someone else, but not in an archived project', async () => {
    mockApi(() => json({}));
    useOrganizationStore.setState({ organizations: [{ id: 7, name: 'O', slug: 'o', roles: ['admin'] }] });
    const others = [task(2, 'todo', 2, { created_by: 9 })];
    const view = await act(async () => {
      mockParams = { projectId: '3', id: '2' };
      useTasksStore.setState({ projectId: 3, tasks: others as never });
      return render(<TaskScreen />);
    });
    expect(screen.getByText('Delete task')).toBeOnTheScreen();
    view.unmount();

    await act(async () => {
      useProjectsStore.setState({ projects: [{ id: 3, name: 'Acme', archived_at: '2026-01-01T00:00:00Z' }] as never });
      useTasksStore.setState({ projectId: 3, tasks: others as never });
      render(<TaskScreen />);
    });
    expect(screen.queryByText('Delete task')).toBeNull();
  });
});
