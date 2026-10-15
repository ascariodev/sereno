import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { api } from '@/api/client';
import Tasks from '@/app/tasks';
import { router } from 'expo-router';
import { forgetGroupTask, resetLogGroups, setGroupTask, useLogGroupsStore } from '@/messages/logGroups';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';
import { toColumns, useTasksStore } from '@/tasks/store';

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
    assignee: null,
    log_group: null,
    comments_count: 0,
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...extra,
  };
}

function mockTasks(data: unknown[], meta: Record<string, unknown> = {}) {
  const fn = jest.fn(async (url: string) => {
    if (url.includes('/api/projects/3/tasks')) return json({ data, meta });
    return json({});
  });
  globalThis.fetch = fn as never;
  return fn;
}

beforeEach(() => {
  api.setTokenProvider(null);
  useOrganizationStore.setState({ organizations: [], activeId: 7, loaded: true });
  useProjectsStore.getState().clear();
  useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
  useTasksStore.getState().clear();
  useTasksStore.getState().setFilter('all');
  resetLogGroups();
});

describe('toColumns', () => {
  it('groups by status and orders by position, then id', () => {
    const columns = toColumns([
      task(4, 'todo', 2),
      task(2, 'todo', -1),
      task(3, 'todo', 2),
      task(5, 'done', 1),
      task(6, 'unknown', 1),
    ] as never);
    expect(columns.todo.map((item) => item.id)).toEqual([2, 3, 4]);
    expect(columns.done.map((item) => item.id)).toEqual([5]);
    expect(columns.in_progress).toEqual([]);
  });

  it('filters mine and from notices', () => {
    const list = [
      task(1, 'todo', 1, { assignee: { id: 1, name: 'Ana' } }),
      task(2, 'todo', 2, { log_group: { id: 9, title: 'x' } }),
      task(3, 'todo', 3),
    ] as never;
    expect(toColumns(list, 'mine', 1).todo.map((item) => item.id)).toEqual([1]);
    expect(toColumns(list, 'from_notices', 1).todo.map((item) => item.id)).toEqual([2]);
    expect(toColumns(list, 'all', 1).todo).toHaveLength(3);
  });
});

describe('Tasks board', () => {
  it('shows tasks grouped by status in position order', async () => {
    mockTasks([task(2, 'todo', 5), task(1, 'todo', 1), task(3, 'in_review', 1), task(4, 'done', 1)], {
      done_total: 1,
      has_more_done: false,
    });
    await act(async () => {
      render(<Tasks />);
    });

    const todo = within(await screen.findByTestId('column-todo'));
    expect(todo.getAllByText(/^Task \d$/).map((node) => node.props.children)).toEqual(['Task 1', 'Task 2']);
    expect(within(screen.getByTestId('column-in_review')).getByText('Task 3')).toBeOnTheScreen();
    expect(within(screen.getByTestId('column-in_progress')).getByText('No tasks')).toBeOnTheScreen();
    expect(within(screen.getByTestId('column-done')).getByText('Task 4')).toBeOnTheScreen();
  });

  it('applies the mine filter', async () => {
    mockTasks([task(1, 'todo', 1, { assignee: { id: 1, name: 'Ana' } }), task(2, 'todo', 2)]);
    await act(async () => {
      render(<Tasks />);
    });
    await screen.findByText('Task 2');

    await fireEvent.press(screen.getByText('Mine'));

    expect(screen.getByText('Task 1')).toBeOnTheScreen();
    expect(screen.queryByText('Task 2')).toBeNull();
  });

  it('shows more done tasks by raising done_limit', async () => {
    const fn = mockTasks([task(1, 'done', 1)], { done_total: 80, has_more_done: true });
    await act(async () => {
      render(<Tasks />);
    });
    expect(await screen.findByText('Done (80)')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Show more done tasks'));

    const urls = fn.mock.calls.map((call) => call[0] as string);
    expect(urls[0]).toContain('done_limit=50');
    expect(urls[1]).toContain('done_limit=100');
  });

  it('retries after a failed load', async () => {
    globalThis.fetch = jest.fn(async () => json({}, 500)) as never;
    await act(async () => {
      render(<Tasks />);
    });
    expect(await screen.findByText('Could not load the tasks.')).toBeOnTheScreen();

    mockTasks([task(1, 'todo', 1)]);
    await fireEvent.press(screen.getByText('Retry'));

    expect(await screen.findByText('Task 1')).toBeOnTheScreen();
  });
});

describe('failed reloads', () => {
  it('keeps the loaded board and reverts done_limit when show more fails', async () => {
    const fn = mockTasks([task(1, 'done', 1), task(2, 'todo', 1)], { done_total: 80, has_more_done: true });
    await act(async () => {
      render(<Tasks />);
    });
    await screen.findByText('Task 2');

    fn.mockImplementation(async () => json({}, 500));
    await fireEvent.press(screen.getByText('Show more done tasks'));

    expect(screen.getByText('Task 2')).toBeOnTheScreen();
    expect(screen.queryByText('Could not load the tasks.')).toBeNull();
    expect(useTasksStore.getState().failed).toBe(false);

    fn.mockImplementation(async () => json({ data: [task(1, 'done', 1)], meta: { done_total: 80, has_more_done: true } }));
    await fireEvent.press(screen.getByText('Show more done tasks'));
    expect(fn.mock.calls[fn.mock.calls.length - 1][0]).toContain('done_limit=100');
  });

  it('lets the last launched load win over an older overlapping one', async () => {
    let releaseFirst: (response: Response) => void = () => undefined;
    let calls = 0;
    globalThis.fetch = jest.fn(() => {
      calls++;
      if (calls === 1) return new Promise<Response>((resolve) => (releaseFirst = resolve));
      return Promise.resolve(json({ data: [task(2, 'todo', 1)], meta: {} }));
    }) as never;
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = useTasksStore.getState().open(3);
    });
    await act(async () => {
      await useTasksStore.getState().open(3);
    });
    await act(async () => {
      releaseFirst(json({ data: [task(1, 'todo', 1)], meta: {} }));
      await first;
    });

    expect(useTasksStore.getState().tasks.map((item) => item.id)).toEqual([2]);
  });
});

describe('forgetGroupTask', () => {
  it('drops the group links of a task and the store removal calls it', async () => {
    setGroupTask(9, { id: 5, key: 'ACME-5', status: 'todo' });
    setGroupTask(10, { id: 6, key: 'ACME-6', status: 'todo' });
    forgetGroupTask(5);
    expect(Object.keys(useLogGroupsStore.getState().tasks)).toEqual(['10']);

    mockTasks([task(6, 'todo', 1)]);
    await act(async () => {
      await useTasksStore.getState().open(3);
    });
    useTasksStore.getState().remove(3, 6);
    expect(useLogGroupsStore.getState().tasks).toEqual({});
    expect(useTasksStore.getState().tasks).toEqual([]);
  });
});

describe('new task button', () => {
  const project = { id: 3, name: 'Acme API', key: 'ACME', description: null, archived_at: null };

  it('opens the create form for the project', async () => {
    useProjectsStore.setState({ projects: [project] });
    mockTasks([task(1, 'todo', 1)]);
    await act(async () => {
      render(<Tasks />);
    });

    await fireEvent.press(await screen.findByText('New task'));

    expect(router.push).toHaveBeenCalledWith({ pathname: '/task', params: { projectId: '3' } });
  });

  it('is hidden in an archived project', async () => {
    useProjectsStore.setState({ projects: [{ ...project, archived_at: '2026-01-01T00:00:00Z' }] });
    mockTasks([task(1, 'todo', 1)]);
    await act(async () => {
      render(<Tasks />);
    });

    await screen.findByText('Task 1');
    expect(screen.queryByText('New task')).toBeNull();
  });
});
