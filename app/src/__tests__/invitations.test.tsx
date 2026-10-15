import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import '@/i18n';

import Invitations from '@/app/invitations';
import { useInvitationsStore } from '@/organization/invitations';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args) },
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function invitation(id: number, role: string, email: string, projects: unknown[] = []) {
  return {
    id,
    email,
    role,
    invited_by: { id: 1, name: 'Olivia Owner' },
    projects,
    expires_at: '2026-12-01T10:00:00Z',
  };
}

const MEMBER_INVITE = invitation(1, 'member', 'ana@example.com', [{ id: 5, name: 'Alpha', key: 'ALP' }]);
const ADMIN_INVITE = invitation(2, 'admin', 'adam@example.com');
const OWNER_INVITE = invitation(3, 'owner', 'olga@example.com');

function setRoles(roles: string[]) {
  useOrganizationStore.setState({ organizations: [{ id: 7, name: 'Acme', slug: 'acme', roles }], activeId: 7, loaded: true });
  useProjectsStore.setState({
    projects: [
      { id: 5, name: 'Alpha', key: 'ALP', description: null, archived_at: null },
      { id: 6, name: 'Beta', key: 'BET', description: null, archived_at: null },
    ],
    loaded: true,
    failed: false,
    loading: false,
  });
}

interface Backend {
  list?: unknown[];
  listStatus?: number;
  write?: (url: string, init: RequestInit) => Response;
}

function backend({ list = [MEMBER_INVITE, ADMIN_INVITE, OWNER_INVITE], listStatus = 200, write }: Backend = {}) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') return write ? write(String(url), init ?? {}) : json({ data: invitation(9, 'member', 'new@example.com') }, 201);
    return listStatus === 200 ? json({ data: list, meta: { next_cursor: null } }) : json({ message: 'boom' }, listStatus);
  });
  globalThis.fetch = fn as never;
  return fn;
}

function writes(fn: jest.Mock) {
  return fn.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
}

async function renderScreen() {
  await act(async () => {
    render(<Invitations />);
  });
}

async function press(label: string | RegExp) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

async function pressText(text: string) {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
  });
}

async function typeEmail(value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Email'), value);
  });
}

async function confirmRevoke() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { onPress?: () => void }[];
  await act(async () => {
    buttons[1].onPress?.();
  });
}

beforeEach(() => {
  mockReplace.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useInvitationsStore.getState().clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('invitations screen', () => {
  it('lists the invitations and lets an owner revoke any of them', async () => {
    setRoles(['owner']);
    backend();
    await renderScreen();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText('Projects: Alpha')).toBeTruthy();
    expect(screen.getByLabelText('Revoke invitation for olga@example.com')).toBeTruthy();
    expect(screen.getByLabelText('Invite as Owner')).toBeTruthy();
  });

  it('hides revoking an owner invitation and the owner role from an admin', async () => {
    setRoles(['admin']);
    backend();
    await renderScreen();
    expect(screen.getByLabelText('Revoke invitation for adam@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('Revoke invitation for olga@example.com')).toBeNull();
    expect(screen.queryByLabelText('Invite as Owner')).toBeNull();
    expect(screen.getByLabelText('Invite as Admin')).toBeTruthy();
  });

  it('sends a member away without requesting anything', async () => {
    setRoles(['member']);
    const fn = backend();
    await renderScreen();
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(fn).not.toHaveBeenCalled();
    expect(screen.queryByText('Invitations')).toBeNull();
  });

  it('refuses to invite or revoke from the store without the role', async () => {
    setRoles(['member']);
    const fn = backend();
    expect(await useInvitationsStore.getState().invite('a@example.com', 'member', [])).toBe(false);
    await act(async () => {
      await useInvitationsStore.getState().revoke(MEMBER_INVITE as never);
    });
    expect(writes(fn)).toHaveLength(0);
    setRoles(['admin']);
    await act(async () => {
      await useInvitationsStore.getState().revoke(OWNER_INVITE as never);
    });
    expect(await useInvitationsStore.getState().invite('a@example.com', 'owner', [])).toBe(false);
    expect(writes(fn)).toHaveLength(0);
  });

  it('invites a member with the selected projects and puts it first in the list', async () => {
    setRoles(['admin']);
    const fn = backend({ write: () => json({ data: invitation(9, 'member', 'new@example.com', [{ id: 6, name: 'Beta', key: 'BET' }]) }, 201) });
    await renderScreen();
    await typeEmail('  new@example.com ');
    await press('Beta');
    await pressText('Send invitation');
    const [[url, init]] = writes(fn);
    expect(String(url)).toContain('/api/invitations');
    expect(JSON.parse(init.body)).toEqual({ email: 'new@example.com', role: 'member', project_ids: [6] });
    expect(screen.getByText('new@example.com')).toBeTruthy();
    expect(screen.getByLabelText('Email').props.value).toBe('');
    expect(screen.getByText('Invitation sent to new@example.com.')).toBeTruthy();
  });

  it('does not send projects when inviting an admin and replaces a duplicate email', async () => {
    setRoles(['owner']);
    const fn = backend({ write: () => json({ data: invitation(9, 'admin', 'ANA@example.com') }, 201) });
    await renderScreen();
    await typeEmail('ANA@example.com');
    await press('Alpha');
    await press('Invite as Admin');
    await pressText('Send invitation');
    expect(JSON.parse(writes(fn)[0][1].body)).toEqual({ email: 'ANA@example.com', role: 'admin' });
    expect(screen.queryByText('ana@example.com')).toBeNull();
    expect(screen.getByText('ANA@example.com')).toBeTruthy();
  });

  it('shows validation errors from a 422 and keeps the typed email', async () => {
    setRoles(['admin']);
    backend({ write: () => json({ message: 'invalid', errors: { email: ['The email field must be a valid email address.'] } }, 422) });
    await renderScreen();
    await typeEmail('nope');
    await pressText('Send invitation');
    expect(screen.getByText('The email field must be a valid email address.')).toBeTruthy();
    expect(screen.getByLabelText('Email').props.value).toBe('nope');
  });

  it('shows the server message of a 422 without field errors', async () => {
    setRoles(['admin']);
    backend({ write: () => json({ message: 'Already a member.', errors: { other: ['x'] } }, 422) });
    await renderScreen();
    await typeEmail('a@example.com');
    await pressText('Send invitation');
    expect(screen.getByText('Already a member.')).toBeTruthy();
  });

  it.each([
    [429, 'Too many attempts. Try again in a minute.'],
    [403, 'You are not allowed to send this invitation.'],
    [500, 'Could not send the invitation. Try again.'],
  ])('shows a message for a %s on invite', async (status, text) => {
    setRoles(['admin']);
    backend({ write: () => json({ message: 'x' }, status) });
    await renderScreen();
    await typeEmail('a@example.com');
    await pressText('Send invitation');
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('reports a network failure on invite', async () => {
    setRoles(['admin']);
    const fn = backend();
    await renderScreen();
    fn.mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return json({ data: [], meta: { next_cursor: null } });
      throw new TypeError('network');
    });
    await typeEmail('a@example.com');
    await pressText('Send invitation');
    expect(screen.getByText('Could not reach the server.')).toBeTruthy();
  });

  it('disables inviting and revoking while the list loads', async () => {
    setRoles(['admin']);
    let release: (response: Response) => void = () => undefined;
    const fn = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    globalThis.fetch = fn as never;
    await renderScreen();
    await typeEmail('a@example.com');
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
    await pressText('Send invitation');
    await act(async () => {
      expect(await useInvitationsStore.getState().invite('a@example.com', 'member', [])).toBe(false);
      await useInvitationsStore.getState().revoke(MEMBER_INVITE as never);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(writes(fn)).toHaveLength(0);
    await act(async () => {
      release(json({ data: [MEMBER_INVITE], meta: { next_cursor: null } }));
    });
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled();
    expect(screen.getByLabelText('Revoke invitation for ana@example.com')).toBeEnabled();
  });

  it('loads every page of the list following the cursor', async () => {
    setRoles(['admin']);
    const fn = jest.fn(async (url: string) =>
      String(url).includes('cursor=c2')
        ? json({ data: [ADMIN_INVITE], meta: { next_cursor: null } })
        : json({ data: [MEMBER_INVITE], meta: { next_cursor: 'c2' } }),
    );
    globalThis.fetch = fn as never;
    await renderScreen();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(String(fn.mock.calls[1][0])).toContain('cursor=c2');
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText('adam@example.com')).toBeTruthy();
  });

  it('keeps following the cursor after an empty page', async () => {
    setRoles(['admin']);
    const fn = jest.fn(async (url: string) =>
      String(url).includes('cursor=c2')
        ? json({ data: [ADMIN_INVITE], meta: { next_cursor: null } })
        : json({ data: [], meta: { next_cursor: 'c2' } }),
    );
    globalThis.fetch = fn as never;
    await renderScreen();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(screen.getByText('adam@example.com')).toBeTruthy();
    expect(screen.queryByText('There are no pending invitations.')).toBeNull();
  });

  it('revokes after confirming and removes the row', async () => {
    setRoles(['admin']);
    const fn = backend({ write: () => new Response(null, { status: 204 }) });
    await renderScreen();
    await press('Revoke invitation for ana@example.com');
    expect(Alert.alert).toHaveBeenCalled();
    expect(writes(fn)).toHaveLength(0);
    await confirmRevoke();
    expect(String(writes(fn)[0][0])).toContain('/api/invitations/1');
    expect(screen.queryByText('ana@example.com')).toBeNull();
    expect(screen.getByText('Invitation for ana@example.com revoked.')).toBeTruthy();
  });

  it('drops the row on a 404 when revoking', async () => {
    setRoles(['admin']);
    backend({ write: () => json({ message: 'gone' }, 404) });
    await renderScreen();
    await press('Revoke invitation for ana@example.com');
    await confirmRevoke();
    expect(screen.queryByText('ana@example.com')).toBeNull();
    expect(screen.getByText('That invitation no longer exists.')).toBeTruthy();
  });

  it.each([
    [403, 'You are not allowed to revoke this invitation.'],
    [500, 'Could not revoke the invitation. Try again.'],
  ])('keeps the row on a %s when revoking', async (status, text) => {
    setRoles(['admin']);
    backend({ write: () => json({ message: 'x' }, status) });
    await renderScreen();
    await press('Revoke invitation for ana@example.com');
    await confirmRevoke();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('shows an error with retry when the list fails', async () => {
    setRoles(['admin']);
    backend({ listStatus: 500 });
    await renderScreen();
    expect(screen.getByText('Could not load the invitations.')).toBeTruthy();
    backend();
    await pressText('Retry');
    expect(screen.getByText('ana@example.com')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    setRoles(['owner']);
    backend({ list: [] });
    await renderScreen();
    expect(screen.getByText('There are no pending invitations.')).toBeTruthy();
  });
});
