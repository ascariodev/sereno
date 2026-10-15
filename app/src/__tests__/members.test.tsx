import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import '@/i18n';

import { api } from '@/api/client';
import Members from '@/app/members';
import { useOrganizationMembersStore } from '@/organization/members';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { disconnectRealtime, setRealtimeClientFactory, type RealtimeClient, type RealtimePayload } from '@/realtime/echo';
import { useAuthStore } from '@/session/auth';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const mockReplace = jest.fn();
let mockPathname = '/members';
jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  router: { push: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args) },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function person(id: number, role: string, name: string) {
  return { id, name, email: `user${id}@example.com`, role, joined_at: '2026-01-05T10:00:00Z' };
}

const OWNER = person(1, 'owner', 'Olivia Owner');
const ADMIN = person(2, 'admin', 'Adam Admin');
const ANA = person(10, 'member', 'Ana');

type Roles = string[];

function setSession(userId: number, roles: Roles) {
  useAuthStore.setState({ user: { id: userId, name: 'Me', email: 'me@example.com', locale: null } });
  useOrganizationStore.setState({ organizations: [{ id: 7, name: 'Acme', slug: 'acme', roles }], activeId: 7, loaded: true });
}

interface Backend {
  list?: unknown[];
  write?: (url: string, init: RequestInit) => Response;
  listStatus?: number;
  organizations?: unknown[];
  organizationsStatus?: number;
}

function backend({ list = [OWNER, ADMIN, ANA], write, listStatus = 200, organizations, organizationsStatus = 200 }: Backend = {}) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') return write ? write(String(url), init ?? {}) : json({ data: ANA });
    if (String(url).endsWith('/api/organizations')) {
      if (organizationsStatus !== 200) return json({ message: 'boom' }, organizationsStatus);
      return json({ data: organizations ?? [{ id: 7, name: 'Acme', slug: 'acme', roles: ['admin'] }] });
    }
    return listStatus === 200 ? json({ data: list }) : json({ message: 'boom' }, listStatus);
  });
  globalThis.fetch = fn as never;
  return fn;
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
  return { client, listeners, emit: (name: string, event: string, data: RealtimePayload) => listeners.get(name)?.get(event)?.(data) };
}

function writes(fn: jest.Mock) {
  return fn.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
}

async function renderScreen() {
  await act(async () => {
    render(<Members />);
  });
}

async function press(label: string) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

async function confirm(index: number) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { onPress?: () => void }[];
  await act(async () => {
    buttons[index].onPress?.();
  });
}

beforeEach(() => {
  api.setTokenProvider(null);
  mockReplace.mockClear();
  mockPathname = '/members';
  useOrganizationMembersStore.getState().clear();
  useMemberDirectoryStore.getState().clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
  jest.restoreAllMocks();
});

describe('Members as owner', () => {
  beforeEach(() => setSession(1, ['owner']));

  it('lists members, offers every action on others and only leave on herself', async () => {
    backend();
    await renderScreen();
    expect(screen.getByText('Olivia Owner (You)')).toBeTruthy();
    expect(screen.getByText('user10@example.com')).toBeTruthy();
    expect(screen.getByLabelText('Make Ana Admin')).toBeTruthy();
    expect(screen.getByLabelText('Make Ana Owner')).toBeTruthy();
    expect(screen.getByLabelText('Transfer ownership to Ana')).toBeTruthy();
    expect(screen.getByLabelText('Remove Adam Admin')).toBeTruthy();
    expect(screen.queryByLabelText('Transfer ownership to Olivia Owner')).toBeNull();
    expect(screen.queryByLabelText('Make Olivia Owner Admin')).toBeTruthy();
    expect(screen.getByLabelText('Leave organization')).toBeTruthy();
  });

  it('changes a role and invalidates the directory', async () => {
    const fn = backend({ write: () => json({ data: { ...ANA, role: 'admin' } }) });
    const invalidate = jest.spyOn(useMemberDirectoryStore.getState(), 'invalidate');
    await renderScreen();
    await press('Make Ana Admin');
    const [call] = writes(fn);
    expect(String(call[0])).toContain('/api/members/10');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body as string)).toEqual({ role: 'admin' });
    expect(screen.getAllByText('Role: Admin').length).toBe(2);
    expect(invalidate).toHaveBeenCalled();
  });

  it('reloads the organizations when the owner changes her own role', async () => {
    const fn = backend({ write: () => json({ data: { ...OWNER, role: 'admin' } }) });
    await renderScreen();
    await press('Make Olivia Owner Admin');
    expect(fn.mock.calls.some(([url]) => String(url).endsWith('/api/organizations'))).toBe(true);
    expect(useOrganizationStore.getState().active()?.roles).toEqual(['admin']);
    expect(screen.queryByLabelText('Make Ana Owner')).toBeNull();
  });

  it('transfers ownership after confirming and reflects the new role', async () => {
    const fn = backend({ write: () => json({ data: { ...ANA, role: 'owner' } }) });
    await renderScreen();
    await press('Transfer ownership to Ana');
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[1]).toContain('You will become an admin');
    expect(writes(fn)).toHaveLength(0);
    await confirm(1);
    const [call] = writes(fn);
    expect(String(call[0])).toContain('/api/members/10/transfer-ownership');
    expect(useOrganizationStore.getState().active()?.roles).toEqual(['admin']);
    expect(screen.getByText('Ana is now the owner of the organization.')).toBeTruthy();
    expect(screen.queryByLabelText('Transfer ownership to Ana')).toBeNull();
  });

  it('does not transfer when the confirmation is cancelled', async () => {
    const fn = backend();
    await renderScreen();
    await press('Transfer ownership to Ana');
    await confirm(0);
    expect(writes(fn)).toHaveLength(0);
  });

  it('removes a member after confirming', async () => {
    const fn = backend({ write: () => new Response(null, { status: 204 }) });
    await renderScreen();
    await press('Remove Ana');
    await confirm(1);
    expect(writes(fn)[0][1].method).toBe('DELETE');
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Ana was removed from the organization.')).toBeTruthy();
  });

  it('drops a member that is already gone on a 404', async () => {
    backend({ write: () => json({ message: 'nope' }, 404) });
    await renderScreen();
    await press('Remove Ana');
    await confirm(1);
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Ana is no longer a member.')).toBeTruthy();
  });

  it('shows the server message on a 422 and a generic one on a 500', async () => {
    let status = 422;
    backend({ write: () => json({ message: 'The organization needs an owner.' }, status) });
    await renderScreen();
    await press('Make Ana Admin');
    expect(screen.getByText('The organization needs an owner.')).toBeTruthy();
    status = 500;
    await press('Make Ana Admin');
    expect(screen.getByText('Could not change the role. Try again.')).toBeTruthy();
    expect(screen.getAllByText('Role: Member').length).toBe(1);
  });

  it('leaves the organization and goes home', async () => {
    const fn = backend({
      write: () => new Response(null, { status: 204 }),
      organizations: [{ id: 8, name: 'Beta', slug: 'beta', roles: ['member'] }],
    });
    await renderScreen();
    await press('Leave organization');
    await confirm(1);
    expect(writes(fn)[0][0]).toContain('/api/members/1');
    expect(useOrganizationStore.getState().activeId).toBe(8);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('stays on the screen and shows the error when leaving fails', async () => {
    backend({ write: () => json({ message: 'boom' }, 500) });
    await renderScreen();
    await press('Leave organization');
    await confirm(1);
    expect(screen.getByText('Could not leave the organization. Try again.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('warns and stays when leaving succeeds but the organizations cannot be reloaded', async () => {
    backend({ write: () => new Response(null, { status: 204 }), organizationsStatus: 500 });
    await renderScreen();
    await press('Leave organization');
    await confirm(1);
    expect(screen.getByText('You left the organization, but your organizations could not be reloaded. Restart the app.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not navigate when the screen is no longer focused after leaving', async () => {
    backend({ write: () => new Response(null, { status: 204 }), organizations: [{ id: 8, name: 'Beta', slug: 'beta', roles: ['member'] }] });
    await renderScreen();
    mockPathname = '/tasks';
    await press('Leave organization');
    await confirm(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps no stale state and does not reload when leaving the last organization', async () => {
    const fn = backend({ write: () => new Response(null, { status: 204 }), organizations: [] });
    await renderScreen();
    await press('Leave organization');
    await confirm(1);
    expect(useOrganizationStore.getState().activeId).toBeNull();
    expect(fn.mock.calls.filter(([url, init]) => String(url).endsWith('/api/members') && (init?.method ?? 'GET') === 'GET')).toHaveLength(1);
    expect(useOrganizationMembersStore.getState().members).toEqual([]);
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('warns when the roles cannot be reloaded after a transfer', async () => {
    backend({ write: () => json({ data: { ...ANA, role: 'owner' } }), organizationsStatus: 500 });
    await renderScreen();
    await press('Transfer ownership to Ana');
    await confirm(1);
    expect(screen.getByText('Ana is now the owner of the organization.')).toBeTruthy();
    expect(screen.getByText('The change was saved, but your organizations could not be reloaded. Restart the app.')).toBeTruthy();
  });

  it('refreshes on a live event and keeps a local change made during the refresh', async () => {
    const { client, emit } = fakeClient();
    setRealtimeClientFactory(() => client);
    let phase: 'load' | 'refresh' = 'load';
    let releaseRefresh: () => void = () => undefined;
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({ data: { ...ANA, role: 'admin' } });
      if (phase === 'refresh') await new Promise<void>((resolve) => (releaseRefresh = resolve));
      return json({ data: [OWNER, ADMIN, ANA] });
    });
    globalThis.fetch = fn as never;
    await renderScreen();
    phase = 'refresh';
    await act(async () => {
      emit('organizations.7.members', '.organization.members_changed', {});
    });
    await press('Make Ana Admin');
    await act(async () => {
      releaseRefresh();
    });
    expect(screen.getAllByText('Role: Admin').length).toBe(2);
  });

  it('shows a retry when the list fails to load', async () => {
    backend({ listStatus: 500 });
    await renderScreen();
    expect(screen.getByText('Could not load the members.')).toBeTruthy();
    backend();
    await act(async () => {
      fireEvent.press(screen.getByText('Retry'));
    });
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('disables actions while a write is in flight', async () => {
    let release: (response: Response) => void = () => undefined;
    const fn = backend();
    const base = fn.getMockImplementation()!;
    fn.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? new Promise<Response>((resolve) => (release = resolve)) : base(url, init),
    );
    await renderScreen();
    await press('Make Ana Admin');
    await press('Make Ana Admin');
    expect(writes(fn)).toHaveLength(1);
    expect(screen.getByLabelText('Remove Ana').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      release(json({ data: { ...ANA, role: 'admin' } }));
    });
    expect(screen.getByLabelText('Remove Ana').props.accessibilityState.disabled).toBeFalsy();
  });
});

describe('Members as admin', () => {
  beforeEach(() => setSession(2, ['admin']));

  it('manages members but never the owner and cannot transfer', async () => {
    backend();
    await renderScreen();
    expect(screen.getByLabelText('Make Ana Admin')).toBeTruthy();
    expect(screen.queryByLabelText('Make Ana Owner')).toBeNull();
    expect(screen.getByLabelText('Remove Ana')).toBeTruthy();
    expect(screen.queryByLabelText('Remove Olivia Owner')).toBeNull();
    expect(screen.queryByLabelText(/Make Olivia Owner/)).toBeNull();
    expect(screen.queryByLabelText(/Transfer ownership/)).toBeNull();
    expect(screen.getByLabelText('Leave organization')).toBeTruthy();
  });

  it('subscribes to organization members for admins', async () => {
    const { client, listeners } = fakeClient();
    setRealtimeClientFactory(() => client);
    backend();
    await renderScreen();
    expect(listeners.has('organizations.7.members')).toBe(true);
  });

  it('shows the server message when the API refuses with 403', async () => {
    backend({ write: () => json({ message: 'You cannot do that.' }, 403) });
    await renderScreen();
    await press('Make Ana Admin');
    expect(screen.getByText('You cannot do that.')).toBeTruthy();
  });

  it('does not write when the admin tries to act on the owner through the store', async () => {
    const fn = backend();
    await renderScreen();
    await act(async () => {
      await useOrganizationMembersStore.getState().remove(OWNER as never);
      await useOrganizationMembersStore.getState().changeRole(OWNER as never, 'member');
      await useOrganizationMembersStore.getState().transfer(ANA as never);
    });
    expect(writes(fn)).toHaveLength(0);
  });
});

describe('Members as member', () => {
  beforeEach(() => setSession(10, ['member']));

  it('only sees the list and can leave', async () => {
    backend();
    await renderScreen();
    expect(screen.getByText('Ana (You)')).toBeTruthy();
    expect(screen.queryByLabelText(/^Make /)).toBeNull();
    expect(screen.queryByLabelText(/^Remove /)).toBeNull();
    expect(screen.queryByLabelText(/Transfer ownership/)).toBeNull();
    expect(screen.getByLabelText('Leave organization')).toBeTruthy();
  });

  it('does not subscribe to organization members', async () => {
    const { client, listeners } = fakeClient();
    setRealtimeClientFactory(() => client);
    backend();
    await renderScreen();
    expect(listeners.has('organizations.7.members')).toBe(false);
  });

  it('does not write when acting on others through the store', async () => {
    const fn = backend();
    await renderScreen();
    await act(async () => {
      await useOrganizationMembersStore.getState().remove(ADMIN as never);
      await useOrganizationMembersStore.getState().changeRole(ADMIN as never, 'member');
    });
    expect(writes(fn)).toHaveLength(0);
  });
});
