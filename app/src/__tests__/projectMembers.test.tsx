import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import '@/i18n';

import { api } from '@/api/client';
import ProjectMembers from '@/app/project-members';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useProjectMembersStore } from '@/projects/projectMembers';
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

function person(id: number, role: string, name = `User ${id}`) {
  return { id, name, email: `user${id}@example.com`, role };
}

const OWNER = person(1, 'owner', 'Olivia Owner');
const ADMIN = person(2, 'admin', 'Adam Admin');
const ANA = person(10, 'member', 'Ana');
const BOB = person(11, 'member', 'Bob');
const CARL = person(12, 'member', 'Carl');

function isOrganizationList(url: string) {
  return String(url).endsWith('/api/members');
}

function setProject() {
  useProjectsStore.setState({
    projects: [{ id: 3, name: 'Acme API', key: 'ACME', description: null, archived_at: null }],
    channelByProject: {},
    loaded: true,
  });
}

function setRoles(roles: string[]) {
  useOrganizationStore.setState({ organizations: [{ id: 7, name: 'Org', slug: 'org', roles }], activeId: 7, loaded: true });
}

function backend(options: { assigned?: unknown[]; everyone?: unknown[]; write?: (init: RequestInit) => Response } = {}) {
  const { assigned = [OWNER, ADMIN, ANA], everyone = [OWNER, ADMIN, ANA, BOB, CARL], write } = options;
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'DELETE') return write ? write(init) : json({ data: BOB }, 201);
    return json({ data: isOrganizationList(url) ? everyone : assigned });
  });
  globalThis.fetch = fn as never;
  return fn;
}

function writes(fn: jest.Mock) {
  return fn.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'DELETE');
}

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

async function renderScreen() {
  await act(async () => {
    render(<ProjectMembers />);
  });
}

beforeEach(() => {
  api.setTokenProvider(null);
  mockParams = { projectId: '3', name: 'Acme API' };
  setRoles(['admin']);
  setProject();
  useProjectMembersStore.getState().clear();
  useMemberDirectoryStore.getState().clear();
});

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
  jest.restoreAllMocks();
});

describe('ProjectMembers', () => {
  it.each(['owner', 'admin'])('lets %s see the members and the candidates', async (role) => {
    setRoles([role]);
    backend();
    await renderScreen();
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByLabelText('Remove Ana from the project')).toBeTruthy();
    expect(screen.getAllByText('Sees every project')).toHaveLength(2);
    expect(screen.queryByLabelText('Remove Olivia Owner from the project')).toBeNull();
    expect(screen.getByLabelText('Add Bob to the project')).toBeTruthy();
    expect(screen.getByLabelText('Add Carl to the project')).toBeTruthy();
    expect(screen.queryByLabelText('Add Ana to the project')).toBeNull();
    expect(screen.queryByLabelText('Add Adam Admin to the project')).toBeNull();
  });

  it('blocks members and never requests the lists', async () => {
    setRoles(['member']);
    const fn = backend();
    await renderScreen();
    expect(screen.getByText('Only owners and admins can manage project members.')).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  it('shows not found when the project is not in the list', async () => {
    useProjectsStore.setState({ projects: [], channelByProject: {}, loaded: true });
    const fn = backend();
    await renderScreen();
    expect(screen.getByText('This project does not exist or you cannot access it.')).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  it('shows not found when the project members request is a 404', async () => {
    globalThis.fetch = jest.fn(async () => json({ message: 'Not found' }, 404)) as never;
    await renderScreen();
    expect(await screen.findByText('This project does not exist or you cannot access it.')).toBeTruthy();
  });

  it('offers a retry when the lists fail to load', async () => {
    globalThis.fetch = jest.fn(async () => json({ message: 'boom' }, 500)) as never;
    await renderScreen();
    expect(await screen.findByText('Could not load the project members.')).toBeTruthy();
    backend();
    await act(async () => {
      await fireEvent.press(screen.getByText('Retry'));
    });
    expect(await screen.findByText('Ana')).toBeTruthy();
  });

  it('adds a member, moves it to the list and invalidates the directory', async () => {
    const fn = backend();
    const invalidate = jest.spyOn(useMemberDirectoryStore.getState(), 'invalidate');
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Bob to the project'));
    });
    expect(await screen.findByText('Bob now has access to the project.')).toBeTruthy();
    const [url, init] = writes(fn)[0];
    expect(String(url)).toContain('/api/projects/3/members');
    expect(JSON.parse(String(init.body))).toEqual({ user_id: 11 });
    expect(screen.getByLabelText('Remove Bob from the project')).toBeTruthy();
    expect(screen.queryByLabelText('Add Bob to the project')).toBeNull();
    expect(invalidate).toHaveBeenCalledWith(3);
  });

  it('removes a member and offers it again as a candidate', async () => {
    const fn = backend({ write: () => new Response(null, { status: 204 }) });
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Remove Ana from the project'));
    });
    expect(await screen.findByText('Ana no longer has access to the project.')).toBeTruthy();
    const [url, init] = writes(fn)[0];
    expect(String(url)).toContain('/api/projects/3/members/10');
    expect(init.method).toBe('DELETE');
    expect(screen.getByLabelText('Add Ana to the project')).toBeTruthy();
    expect(screen.queryByLabelText('Remove Ana from the project')).toBeNull();
  });

  it('shows the server message on a 422 when adding', async () => {
    backend({ write: () => json({ message: 'Only users with the member role can be assigned to a project.' }, 422) });
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Bob to the project'));
    });
    expect(await screen.findByText('Only users with the member role can be assigned to a project.')).toBeTruthy();
    expect(screen.getByLabelText('Add Bob to the project')).toBeTruthy();
  });

  it('shows the server message on a 403 when removing', async () => {
    backend({ write: () => json({ message: 'This action is unauthorized.' }, 403) });
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Remove Ana from the project'));
    });
    expect(await screen.findByText('This action is unauthorized.')).toBeTruthy();
    expect(screen.getByLabelText('Remove Ana from the project')).toBeTruthy();
  });

  it('uses a generic message on a server error and a network message offline', async () => {
    const fn = backend({ write: () => json({ message: 'Server Error' }, 500) });
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Bob to the project'));
    });
    expect(await screen.findByText('Could not add the member. Try again.')).toBeTruthy();
    expect(screen.queryByText('Server Error')).toBeNull();

    fn.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new TypeError('Network request failed');
      return json({ data: isOrganizationList(url) ? [OWNER, ANA, BOB] : [OWNER, ANA] });
    });
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Remove Ana from the project'));
    });
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy();
  });

  it('reloads the lists when the target no longer exists (404)', async () => {
    const fn = backend({ write: () => json({ message: 'Not found' }, 404) });
    await renderScreen();
    await screen.findByText('Ana');
    const before = fn.mock.calls.length;
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Bob to the project'));
    });
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThan(before + 1));
    expect(screen.queryByText('Could not add the member. Try again.')).toBeNull();
  });

  it('ignores a second press while an action is in flight', async () => {
    let release: (response: Response) => void = () => undefined;
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>((resolve) => (release = resolve));
      return json({ data: isOrganizationList(url) ? [OWNER, ANA, BOB, CARL] : [OWNER, ANA] });
    });
    globalThis.fetch = fn as never;
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Bob to the project'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Carl to the project'));
    });
    expect(writes(fn)).toHaveLength(1);
    await act(async () => {
      release(json({ data: BOB }, 201));
    });
    expect(await screen.findByText('Bob now has access to the project.')).toBeTruthy();
  });

  it('keeps a local add when an older refresh answers afterwards', async () => {
    const { client, emit } = fakeClient();
    setRealtimeClientFactory(() => client);
    let releaseRefresh: () => void = () => undefined;
    let phase: 'load' | 'refresh' = 'load';
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ data: BOB }, 201);
      if (phase === 'refresh' && !isOrganizationList(url)) {
        await new Promise<void>((resolve) => (releaseRefresh = resolve));
      }
      return json({ data: isOrganizationList(url) ? [OWNER, ANA, BOB] : [OWNER, ANA] });
    });
    globalThis.fetch = fn as never;
    await renderScreen();
    await screen.findByText('Ana');
    phase = 'refresh';
    await act(async () => {
      emit('organizations.7.projects.3', '.project.members_changed', { project_id: 3 });
    });
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Add Bob to the project'));
    });
    expect(await screen.findByText('Bob now has access to the project.')).toBeTruthy();
    await act(async () => {
      releaseRefresh();
    });
    expect(screen.getByLabelText('Remove Bob from the project')).toBeTruthy();
  });

  it('refreshes and invalidates the directory on project.members_changed', async () => {
    const { client, emit } = fakeClient();
    setRealtimeClientFactory(() => client);
    backend();
    const invalidate = jest.spyOn(useMemberDirectoryStore.getState(), 'invalidate');
    await renderScreen();
    await screen.findByText('Ana');
    backend({ assigned: [OWNER, ADMIN, ANA, BOB], everyone: [OWNER, ADMIN, ANA, BOB, CARL] });
    await act(async () => {
      emit('organizations.7.projects.3', '.project.members_changed', { project_id: 3 });
    });
    expect(await screen.findByLabelText('Remove Bob from the project')).toBeTruthy();
    expect(screen.queryByLabelText('Add Bob to the project')).toBeNull();
    expect(invalidate).toHaveBeenCalledWith(3);
  });

  it('shows not found when the refresh says the project is no longer accessible', async () => {
    const { client, emit } = fakeClient();
    setRealtimeClientFactory(() => client);
    backend();
    await renderScreen();
    await screen.findByText('Ana');
    globalThis.fetch = jest.fn(async () => json({ message: 'Not found' }, 404)) as never;
    await act(async () => {
      emit('organizations.7.projects.3', '.project.members_changed', { project_id: 3 });
    });
    expect(await screen.findByText('This project does not exist or you cannot access it.')).toBeTruthy();
  });

  it('stops managing when the current user loses the admin role', async () => {
    backend();
    await renderScreen();
    await screen.findByText('Ana');
    await act(async () => {
      setRoles(['member']);
    });
    expect(screen.getByText('Only owners and admins can manage project members.')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
  });
});

describe('member directory invalidate', () => {
  it('forces the next ensureLoaded to refetch and ignores an older in-flight response', async () => {
    useOrganizationStore.setState({ organizations: [], activeId: 7, loaded: true });
    let calls = 0;
    let releaseFirst: () => void = () => undefined;
    globalThis.fetch = jest.fn(async () => {
      calls++;
      const mine = calls;
      if (mine === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
      return json({ data: [{ id: mine, name: `Run ${mine}` }] });
    }) as never;
    const store = useMemberDirectoryStore.getState();
    const first = store.ensureLoaded(3);
    store.invalidate(3);
    await store.ensureLoaded(3);
    releaseFirst();
    await first;
    expect(useMemberDirectoryStore.getState().entries[3].members).toEqual([{ id: 2, name: 'Run 2' }]);
    useMemberDirectoryStore.getState().invalidate(3);
    await useMemberDirectoryStore.getState().ensureLoaded(3);
    expect(calls).toBe(3);
  });
});
