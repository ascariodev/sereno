import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { router } from 'expo-router';

import { api } from '@/api/client';
import Channel from '@/app/channel';
import { useMemberDirectoryStore } from '@/projects/members';
import { resetLogGroups } from '@/messages/logGroups';
import { useMessagesStore } from '@/messages/store';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';

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

function system(id: number, payload: Record<string, unknown>) {
  return {
    id,
    channel_id: 50,
    kind: 'system',
    body: null,
    payload,
    parent_id: null,
    replies_count: 0,
    last_reply_at: null,
    recent_participants: [],
    user: { id: 1, name: 'Ana' },
    mentions: [],
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
  };
}

const opened = { type: 'log.group_opened', log_group_id: 9, level: 'error', title: 'DB down', events_count: 3 };

function mockApi(handler: (url: string, init?: RequestInit) => Response | undefined, list: unknown[] = [system(1, opened)]) {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const custom = handler(String(url), init);
    if (custom) return custom;
    if (String(url).includes('/members')) return json({ data: [{ id: 21, name: 'Bea' }] });
    return json({ data: list, meta: { next_cursor: null } });
  });
  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

function calls(fetchMock: jest.Mock, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === method);
}

function setProject(archivedAt: string | null = null) {
  useProjectsStore.setState({
    projects: [{ id: 7, name: 'Acme', key: 'ACME', description: null, archived_at: archivedAt }],
    channelByProject: { 7: 50 },
  });
}

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  resetLogGroups();
  useOrganizationStore.setState({ organizations: [{ id: 3, name: 'Acme', slug: 'acme', roles: ['member'] }], activeId: 3 });
  useMemberDirectoryStore.getState().clear();
  useProjectsStore.setState({ projects: [], channelByProject: {} });
  jest.restoreAllMocks();
});

describe('log group actions', () => {
  it('shows no actions when the channel has no known project', async () => {
    mockApi(() => undefined);
    await render(<Channel />);
    expect(await screen.findByText('DB down')).toBeOnTheScreen();
    expect(screen.queryByText('Resolve')).toBeNull();
  });

  it('resolves a group and shows the shared status', async () => {
    setProject();
    const fetchMock = mockApi((url, init) =>
      init?.method === 'PATCH' ? json({ data: { id: 9, status: 'resolved' } }) : undefined,
    );
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Resolve'));

    expect(await screen.findByText('Marked as resolved')).toBeOnTheScreen();
    const [url, init] = calls(fetchMock, 'PATCH')[0];
    expect(url).toContain('/api/projects/7/log-groups/9');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'resolved' });
    expect(screen.queryByText('Resolve')).toBeNull();
  });

  it('ignores a group', async () => {
    setProject();
    const fetchMock = mockApi((url, init) => (init?.method === 'PATCH' ? json({ data: { id: 9 } }) : undefined));
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Ignore'));

    expect(await screen.findByText('Marked as ignored')).toBeOnTheScreen();
    expect(JSON.parse(String(calls(fetchMock, 'PATCH')[0][1].body))).toEqual({ status: 'ignored' });
  });

  it('shows the forbidden message and keeps the actions', async () => {
    setProject();
    mockApi((url, init) => (init?.method === 'PATCH' ? json({ message: 'No' }, 403) : undefined));
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Resolve'));

    expect(await screen.findByText('You are not allowed to change this log group.')).toBeOnTheScreen();
    expect(screen.getByText('Resolve')).toBeOnTheScreen();
  });

  it('follows status changes arriving live and ignores older ones loaded later', async () => {
    setProject();
    mockApi(() => undefined);
    await render(<Channel />);
    await screen.findByText('Resolve');

    await act(async () => {
      useMessagesStore.getState().insert(
        system(5, { type: 'log.group_status_changed', log_group_id: 9, title: 'DB down', status: 'ignored', previous_status: 'open' }) as never,
      );
    });
    expect(await screen.findByText('Marked as ignored')).toBeOnTheScreen();

    await act(async () => {
      useMessagesStore.getState().insert(
        system(3, { type: 'log.group_status_changed', log_group_id: 9, title: 'DB down', status: 'resolved', previous_status: 'open' }) as never,
      );
    });
    expect(screen.getByText('Marked as ignored')).toBeOnTheScreen();
    expect(screen.queryByText('Marked as resolved')).toBeNull();
  });
});

describe('live and edge cases', () => {
  it('shows the task chip when task.created_from_group arrives live', async () => {
    setProject();
    mockApi(() => undefined);
    await render(<Channel />);
    await screen.findByText('Create task');

    await act(async () => {
      useMessagesStore.getState().insert(
        system(4, { type: 'task.created_from_group', log_group_id: 9, task_id: 8, task_key: 'ACME-8', task_status: 'todo' }) as never,
      );
    });

    expect(await screen.findByTestId('notice-task-chip')).toHaveTextContent('Task ACME-8');
    expect(screen.queryByText('Create task')).toBeNull();
  });

  it('opens the task from the task chip', async () => {
    setProject();
    mockApi(() => undefined);
    await render(<Channel />);
    await screen.findByText('Create task');
    await act(async () => {
      useMessagesStore.getState().insert(
        system(4, { type: 'task.created_from_group', log_group_id: 9, task_id: 8, task_key: 'ACME-8', task_status: 'todo' }) as never,
      );
    });

    await fireEvent.press(await screen.findByTestId('notice-task-chip'));

    expect(router.push).toHaveBeenCalledWith({ pathname: '/task', params: { projectId: '7', id: '8' } });
  });

  it('keeps a live status change that arrives while the PATCH is in flight', async () => {
    setProject();
    let release: (response: Response) => void = () => undefined;
    mockApi((url, init) => (init?.method === 'PATCH' ? ((new Promise<Response>((resolve) => (release = resolve))) as never) : undefined));
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Resolve'));

    await act(async () => {
      useMessagesStore.getState().insert(
        system(5, { type: 'log.group_status_changed', log_group_id: 9, title: 'DB down', status: 'ignored', previous_status: 'open' }) as never,
      );
    });
    expect(await screen.findByText('Marked as ignored')).toBeOnTheScreen();

    await act(async () => {
      release(json({ data: { id: 9, status: 'resolved' } }));
    });
    await waitFor(() => expect(screen.getByText('Marked as resolved')).toBeOnTheScreen());
  });

  it('shows the status error of a 422', async () => {
    setProject();
    mockApi((url, init) =>
      init?.method === 'PATCH' ? json({ message: 'Invalid', errors: { status: ['The group is archived.'] } }, 422) : undefined,
    );
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Ignore'));

    expect(await screen.findByText('The group is archived.')).toBeOnTheScreen();
  });
});

describe('create task from a log group', () => {
  it('creates the task from the form and shows the chip', async () => {
    setProject();
    const fetchMock = mockApi((url, init) =>
      init?.method === 'POST' ? json({ data: { id: 31, key: 'ACME-31', status: 'todo' } }, 201) : undefined,
    );
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));

    const title = await screen.findByLabelText('Title');
    expect(title.props.value).toBe('DB down');
    expect(screen.getByLabelText('Description').props.value).toContain('- **Level:** error');
    await fireEvent.changeText(title, '  Fix DB  ');
    await fireEvent.press(screen.getAllByText('Create task')[1]);

    expect(await screen.findByTestId('notice-task-chip')).toHaveTextContent('Task ACME-31');
    const [url, init] = calls(fetchMock, 'POST')[0];
    expect(url).toContain('/api/projects/7/tasks');
    expect(JSON.parse(String(init.body))).toMatchObject({ title: 'Fix DB', log_group_id: 9, status: 'todo' });
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(screen.queryByText('Create task')).toBeNull();
  });

  it('sends the chosen assignee', async () => {
    setProject();
    const fetchMock = mockApi((url, init) =>
      init?.method === 'POST' ? json({ data: { id: 31, key: 'ACME-31', status: 'todo' } }, 201) : undefined,
    );
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));
    await fireEvent.press(await screen.findByText('Bea'));
    await fireEvent.press(screen.getAllByText('Create task')[1]);

    expect(await screen.findByTestId('notice-task-chip')).toBeOnTheScreen();
    expect(JSON.parse(String(calls(fetchMock, 'POST')[0][1].body))).toMatchObject({ assignee_id: 21 });
  });

  it('omits the assignee when none is chosen', async () => {
    setProject();
    const fetchMock = mockApi((url, init) =>
      init?.method === 'POST' ? json({ data: { id: 31, key: 'ACME-31', status: 'todo' } }, 201) : undefined,
    );
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));
    await screen.findByText('Unassigned');
    await fireEvent.press(screen.getAllByText('Create task')[1]);

    expect(await screen.findByTestId('notice-task-chip')).toBeOnTheScreen();
    expect(JSON.parse(String(calls(fetchMock, 'POST')[0][1].body))).not.toHaveProperty('assignee_id');
  });

  it('explains an assignee 422 in the form', async () => {
    setProject();
    mockApi((url, init) =>
      init?.method === 'POST' ? json({ message: 'Invalid', errors: { assignee_id: ['Not a member.'] } }, 422) : undefined,
    );
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));
    await fireEvent.press(await screen.findByText('Bea'));
    await fireEvent.press(screen.getAllByText('Create task')[1]);

    expect(await screen.findByText('Not a member.')).toBeOnTheScreen();
    expect(screen.queryByText('Invalid')).toBeNull();
    expect(screen.getByLabelText('Title')).toBeOnTheScreen();
  });

  it('validates the title before sending', async () => {
    setProject();
    const fetchMock = mockApi(() => undefined);
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));
    await fireEvent.changeText(await screen.findByLabelText('Title'), '   ');
    await fireEvent.press(screen.getAllByText('Create task')[1]);

    expect(await screen.findByText('Enter a title.')).toBeOnTheScreen();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });

  it('loads the existing task when the group was taken', async () => {
    setProject();
    mockApi((url, init) => {
      if (init?.method === 'POST') return json({ message: 'x', errors: { log_group_id: ['taken'] } }, 422);
      if (url.includes('/log-groups/9')) return json({ data: { id: 9, task: { id: 4, key: 'ACME-4', status: 'todo' } } });
      return undefined;
    });
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));
    await fireEvent.press((await screen.findAllByText('Create task'))[1]);

    expect(await screen.findByText('A task for this log group already exists: ACME-4.')).toBeOnTheScreen();
    expect(await screen.findByTestId('notice-task-chip')).toHaveTextContent('Task ACME-4');
  });

  it('shows a server error in the form', async () => {
    setProject();
    mockApi((url, init) => (init?.method === 'POST' ? json({ message: 'boom' }, 500) : undefined));
    await render(<Channel />);
    await fireEvent.press(await screen.findByText('Create task'));
    await fireEvent.press((await screen.findAllByText('Create task'))[1]);

    expect(await screen.findByText('Could not create the task. Try again.')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeOnTheScreen());
  });

  it('does not offer task creation in an archived project', async () => {
    setProject('2026-02-01T00:00:00Z');
    mockApi(() => undefined);
    await render(<Channel />);
    expect(await screen.findByText('Resolve')).toBeOnTheScreen();
    expect(screen.queryByText('Create task')).toBeNull();
  });
});
