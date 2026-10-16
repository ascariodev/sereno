import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { api } from '@/api/client';
import Channel from '@/app/channel';
import { useMessagesStore } from '@/messages/store';
import { useOrganizationStore } from '@/organization/store';
import { useAuthStore } from '@/session/auth';
import { parseMentionDraft } from '@/mentionToken';

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

function message(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: 50,
    kind: 'user',
    body: `Body ${id}`,
    payload: null,
    parent_id: null,
    replies_count: 0,
    last_reply_at: null,
    recent_participants: [],
    user: { id: 1, name: 'Ana' },
    mentions: [],
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
    ...extra,
  };
}

function mockApi(list: unknown[], handler?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const custom = handler?.(String(url), init);
    if (custom) return custom;
    return json({ data: list, meta: { next_cursor: null } });
  });
  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

function setRoles(roles: string[]) {
  useOrganizationStore.setState({ organizations: [{ id: 3, name: 'Acme', slug: 'acme', roles }], activeId: 3 });
}

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  useAuthStore.setState({ user: { id: 1, name: 'Ana' } as never });
  setRoles(['member']);
  jest.restoreAllMocks();
});

describe('parseMentionDraft', () => {
  it('turns known tokens into @Name with ranges and keeps unknown ones literal', () => {
    const draft = parseMentionDraft('Hi <@7> and <@9>!', [{ id: 7, name: 'Bea' }]);
    expect(draft.text).toBe('Hi @Bea and <@9>!');
    expect(draft.mentions).toEqual([{ id: 7, name: 'Bea', start: 3, end: 7 }]);
  });
});

describe('message actions permissions', () => {
  it('offers the menu on own messages only to a member', async () => {
    mockApi([message(2, { user: { id: 2, name: 'Bea' } }), message(1)]);
    await render(<Channel />);
    await screen.findByText('Body 1');

    expect(screen.getAllByRole('button', { name: 'Message actions' })).toHaveLength(1);
  });

  it('lets an admin delete but not edit another user message', async () => {
    setRoles(['admin']);
    mockApi([message(2, { user: { id: 2, name: 'Bea' } })]);
    await render(<Channel />);
    await screen.findByText('Body 2');

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('hides actions on system and deleted messages', async () => {
    mockApi([message(2, { kind: 'system', user: null, payload: { type: 'other.thing' } }), message(1, { deleted_at: '2026-01-02T00:00:00Z' })]);
    await render(<Channel />);
    await screen.findByText('This message was deleted.');

    expect(screen.queryByRole('button', { name: 'Message actions' })).toBeNull();
  });
});

describe('editing', () => {
  it('prefills mentions as @Name, saves with tokens and replaces the message', async () => {
    const fetchMock = mockApi(
      [message(1, { body: 'Hi <@7>', mentions: [{ id: 7, name: 'Bea' }] })],
      (url, init) =>
        init?.method === 'PATCH'
          ? json({ data: message(1, { body: 'Hello <@7>', mentions: [{ id: 7, name: 'Bea' }], edited_at: '2026-01-03T00:00:00Z' }) })
          : undefined,
    );
    await render(<Channel />);
    await screen.findByText(/Hi/);

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Edit message');
    expect(input.props.value).toBe('Hi @Bea');

    await fireEvent.changeText(input, 'Hello @Bea');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByLabelText('Edit message')).toBeNull());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(String(patch[0])).toContain('/api/channels/50/messages/1');
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ body: 'Hello <@7>' });
    expect(useMessagesStore.getState().messages[0].body).toBe('Hello <@7>');
    expect(screen.getByText('(edited)')).toBeOnTheScreen();
  });

  it('shows the error and stays in edit mode when the API rejects', async () => {
    mockApi([message(1)], (url, init) => (init?.method === 'PATCH' ? json({ message: 'no' }, 403) : undefined));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.changeText(screen.getByLabelText('Edit message'), 'Changed');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('You cannot edit this message.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Edit message')).toBeOnTheScreen();
  });

  it('reports a 404 on save and catches up with the server', async () => {
    const fetchMock = mockApi([message(1)], (url, init) => (init?.method === 'PATCH' ? json({ message: 'gone' }, 404) : undefined));
    await render(<Channel />);
    await screen.findByText('Body 1');
    const listCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'PATCH').length;
    const before = listCalls();

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.changeText(screen.getByLabelText('Edit message'), 'Changed');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The message no longer exists.')).toBeOnTheScreen();
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });

  it('cancels without calling the API and blocks an empty body', async () => {
    const fetchMock = mockApi([message(1)]);
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.changeText(screen.getByLabelText('Edit message'), '  ');
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Body 1')).toBeOnTheScreen();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
});

describe('deleting', () => {
  function confirmDelete() {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    return alert;
  }

  it('removes a deleted message without replies from the list', async () => {
    const alert = confirmDelete();
    mockApi([message(1)], (url, init) =>
      init?.method === 'DELETE' ? json({ data: message(1, { body: null, deleted_at: '2026-01-04T00:00:00Z' }) }) : undefined,
    );
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => alert.mock.calls[0][2]![1].onPress?.());

    expect(screen.queryByText('Body 1')).toBeNull();
    expect(screen.queryByText('This message was deleted.')).toBeNull();
  });

  it('asks for confirmation and marks a message with replies as deleted', async () => {
    const alert = confirmDelete();
    const fetchMock = mockApi([message(1, { replies_count: 2, last_reply_at: '2026-01-03T00:00:00Z' })], (url, init) =>
      init?.method === 'DELETE'
        ? json({
            data: message(1, { body: null, deleted_at: '2026-01-04T00:00:00Z', replies_count: 2 }),
            meta: { root: { id: 1, replies_count: 2, last_reply_at: '2026-01-03T00:00:00Z' } },
          })
        : undefined,
    );
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(alert.mock.calls[0][0]).toBe('Delete message');

    const buttons = alert.mock.calls[0][2]!;
    await act(async () => buttons[1].onPress?.());

    expect(await screen.findByText('This message was deleted.')).toBeOnTheScreen();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!;
    expect(String(call[0])).toContain('/api/channels/50/messages/1');
  });

  it('reports a 403 and keeps the message', async () => {
    const alert = confirmDelete();
    mockApi([message(1)], (url, init) => (init?.method === 'DELETE' ? json({ message: 'no' }, 403) : undefined));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => alert.mock.calls[0][2]![1].onPress?.());

    await waitFor(() => expect(alert).toHaveBeenCalledWith('You cannot delete this message.'));
    expect(screen.getByText('Body 1')).toBeOnTheScreen();
  });

  it.each([
    [422, 'This channel is archived; messages cannot be deleted.'],
    [429, 'Too many requests. Try again in a moment.'],
  ])('reports a %i, keeps the message and does not catch up', async (status, text) => {
    const alert = confirmDelete();
    const fetchMock = mockApi([message(1)], (url, init) => (init?.method === 'DELETE' ? json({ message: 'no' }, status) : undefined));
    await render(<Channel />);
    await screen.findByText('Body 1');
    const listCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'DELETE').length;
    const before = listCalls();

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => alert.mock.calls[0][2]![1].onPress?.());

    await waitFor(() => expect(alert).toHaveBeenCalledWith(text));
    expect(screen.getByText('Body 1')).toBeOnTheScreen();
    expect(listCalls()).toBe(before);
  });

  it('reports a 404 and catches up with the server', async () => {
    const alert = confirmDelete();
    const fetchMock = mockApi([message(1)], (url, init) => (init?.method === 'DELETE' ? json({ message: 'gone' }, 404) : undefined));
    await render(<Channel />);
    await screen.findByText('Body 1');
    const listCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'DELETE').length;
    const before = listCalls();

    await fireEvent.press(screen.getByRole('button', { name: 'Message actions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => alert.mock.calls[0][2]![1].onPress?.());

    await waitFor(() => expect(alert).toHaveBeenCalledWith('The message was already deleted.'));
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });
});
