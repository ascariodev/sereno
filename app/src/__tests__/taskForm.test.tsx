import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { api } from '@/api/client';
import TaskScreen from '@/app/task';
import '@/i18n';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useProjectsStore } from '@/projects/store';
import { useTasksStore } from '@/tasks/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function task(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    project_id: 3,
    key: `ACME-${id}`,
    title: `Task ${id}`,
    description: 'Some **bold** text',
    status: 'todo',
    position: 1,
    assignee: null,
    log_group: null,
    comments_count: 0,
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...extra,
  };
}

const members = [
  { id: 1, name: 'Ana' },
  { id: 2, name: 'Bea' },
];

function mockApi(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects/3/members')) return json({ data: members });
    if ((!init?.method || init.method === 'GET') && url.includes('/comments')) return json({ data: [], meta: { next_cursor: null } });
    return handler(url, init);
  });
  globalThis.fetch = fn as never;
  return fn;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.setTokenProvider(null);
  useOrganizationStore.setState({ organizations: [], activeId: 7, loaded: true });
  useMemberDirectoryStore.getState().clear();
  useTasksStore.getState().clear();
});

describe('create task', () => {
  beforeEach(() => {
    mockParams = { projectId: '3' };
  });

  it('validates the title and the description length', async () => {
    const fn = mockApi(() => json({}));
    await act(async () => {
      render(<TaskScreen />);
    });

    await fireEvent.press(screen.getByText('Create task'));
    expect(await screen.findByText('Enter a title.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Title'), 'x'.repeat(201));
    await fireEvent.press(screen.getByText('Create task'));
    expect(await screen.findByText('The title cannot exceed 200 characters.')).toBeOnTheScreen();
    expect(fn.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('creates the task with title, description and assignee and adds it to the board', async () => {
    const fn = mockApi((url, init) =>
      init?.method === 'POST' ? json({ data: task(9, { title: 'New one', assignee: members[1] }) }, 201) : json({}),
    );
    await act(async () => {
      useTasksStore.setState({ projectId: 3, tasks: [] });
      render(<TaskScreen />);
    });
    await screen.findByText('Bea');

    await fireEvent.changeText(screen.getByLabelText('Title'), '  New one ');
    await fireEvent.changeText(screen.getByLabelText('Description'), 'notes');
    await fireEvent.press(screen.getByText('Bea'));
    await act(async () => {
      await fireEvent.press(screen.getByText('Create task'));
    });

    const post = fn.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toContain('/api/projects/3/tasks');
    expect(JSON.parse(String(post[1]?.body))).toEqual({ title: 'New one', description: 'notes', status: 'todo', assignee_id: 2 });
    expect(useTasksStore.getState().tasks.map((item) => item.id)).toEqual([9]);
    expect(router.back).toHaveBeenCalled();
  });

  it('shows the server field errors and stays open', async () => {
    mockApi((url, init) => (init?.method === 'POST' ? json({ message: 'bad', errors: { title: ['Taken title.'] } }, 422) : json({})));
    await act(async () => {
      render(<TaskScreen />);
    });
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Dup');
    await act(async () => {
      await fireEvent.press(screen.getByText('Create task'));
    });

    expect(await screen.findByText('Taken title.')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('task detail and edit', () => {
  beforeEach(() => {
    mockParams = { projectId: '3', id: '5' };
  });

  it('opens the project, fetches a task the board lacks and shows it', async () => {
    const fn = mockApi((url) => {
      if (url.includes('/api/projects/3/tasks/5')) return json({ data: task(5, { assignee: members[0] }) });
      return json({ data: [], meta: {} });
    });
    await act(async () => {
      render(<TaskScreen />);
    });

    expect(await screen.findByText('Task 5')).toBeOnTheScreen();
    expect(screen.getByText('ACME-5')).toBeOnTheScreen();
    expect(screen.getByText('Assigned to Ana')).toBeOnTheScreen();
    expect(screen.getByTestId('task-description')).toBeOnTheScreen();
    expect(fn.mock.calls.some(([url]) => String(url).includes('/api/projects/3/tasks/5'))).toBe(true);
  });

  it('says the task no longer exists on a 404', async () => {
    mockApi((url) => (url.includes('/tasks/5') ? json({ message: 'nope' }, 404) : json({ data: [], meta: {} })));
    await act(async () => {
      render(<TaskScreen />);
    });

    expect(await screen.findByText('This task no longer exists.')).toBeOnTheScreen();
  });

  it('edits the task and refreshes the board entry', async () => {
    const original = task(5, { assignee: members[0] });
    const fn = mockApi((url, init) => {
      if (init?.method === 'PATCH') {
        return json({ data: task(5, { title: 'Renamed', assignee: null, description: null, updated_at: '2026-01-02T00:00:00.000000Z' }) });
      }
      return json({ data: [original], meta: {} });
    });
    await act(async () => {
      render(<TaskScreen />);
    });
    await fireEvent.press(await screen.findByText('Edit task'));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Renamed');
    await fireEvent.press(screen.getByText('Unassigned'));
    await fireEvent.changeText(screen.getByLabelText('Description'), '');
    await act(async () => {
      await fireEvent.press(screen.getByText('Save changes'));
    });

    const patch = fn.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(patch[0]).toContain('/api/projects/3/tasks/5');
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ title: 'Renamed', description: null, assignee_id: null });
    expect(await screen.findByText('Renamed')).toBeOnTheScreen();
    expect(useTasksStore.getState().tasks[0].title).toBe('Renamed');
  });

  it('keeps the form and shows an error when saving fails', async () => {
    mockApi((url, init) => (init?.method === 'PATCH' ? json({}, 500) : json({ data: [task(5)], meta: {} })));
    await act(async () => {
      render(<TaskScreen />);
    });
    await fireEvent.press(await screen.findByText('Edit task'));
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Other');
    await act(async () => {
      await fireEvent.press(screen.getByText('Save changes'));
    });

    expect(await screen.findByText('Could not save the task. Try again.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Title').props.value).toBe('Other');
  });

  it('ignores an older server version of the task', async () => {
    useTasksStore.setState({ projectId: 3, tasks: [task(5, { title: 'Newest', updated_at: '2026-02-01T00:00:00.000000Z' })] as never });
    mockApi(() => json({ data: task(5, { title: 'Old' }) }));
    await act(async () => {
      await useTasksStore.getState().update(3, 5, { title: 'Old' });
    });
    expect(useTasksStore.getState().tasks[0].title).toBe('Newest');
  });
});

describe('create in an archived project', () => {
  it('shows a notice instead of the form', async () => {
    mockParams = { projectId: '3' };
    useProjectsStore.setState({
      projects: [{ id: 3, name: 'Acme', key: 'ACME', description: null, archived_at: '2026-01-01T00:00:00Z' }],
    });
    mockApi(() => json({}));
    await act(async () => {
      render(<TaskScreen />);
    });

    expect(screen.getByText('This project is archived; you cannot create tasks.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Title')).toBeNull();
    await act(async () => useProjectsStore.getState().clear());
  });
});
