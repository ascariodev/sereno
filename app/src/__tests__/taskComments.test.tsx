import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { api } from '@/api/client';
import { TaskComments } from '@/components/TaskComments';
import '@/i18n';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useAuthStore } from '@/session/auth';
import { useTaskCommentsStore } from '@/tasks/comments';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function comment(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    task_id: 5,
    body: `Comment ${id}`,
    user: { id: 1, name: 'Ana' },
    mentions: [],
    attachments: [],
    created_at: '2026-01-01T00:00:00.000000Z',
    edited_at: null,
    ...extra,
  };
}

const members = [
  { id: 1, name: 'Ana' },
  { id: 2, name: 'Bea' },
];

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockApi(handler: Handler) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects/3/members')) return json({ data: members });
    return handler(url, init);
  });
  globalThis.fetch = fn as never;
  return fn;
}

const page = (data: unknown[], next: string | null = null) => json({ data, meta: { next_cursor: next } });
const calls = (fn: jest.Mock, method: string) => fn.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);
const ids = () => useTaskCommentsStore.getState().comments.map((item) => item.id);

async function mount() {
  await act(async () => {
    render(<TaskComments projectId={3} taskId={5} />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.setTokenProvider(null);
  useAuthStore.setState({
    user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null },
  });
  useOrganizationStore.setState({
    organizations: [{ id: 7, name: 'Org', roles: ['member'] } as never],
    activeId: 7,
    loaded: true,
  });
  useMemberDirectoryStore.getState().clear();
  useTaskCommentsStore.getState().clear();
});

describe('thread of comments', () => {
  it('lists comments oldest first', async () => {
    mockApi(() => page([comment(2), comment(1)]));
    await mount();
    expect(screen.getAllByTestId('task-comment')).toHaveLength(2);
    expect(ids()).toEqual([1, 2]);
    expect(screen.getByText('Comment 1')).toBeOnTheScreen();
  });

  it('shows the empty message when there are none', async () => {
    mockApi(() => page([]));
    await mount();
    expect(screen.getByText('No comments yet.')).toBeOnTheScreen();
  });

  it('loads earlier comments with the cursor and keeps the list when that fails', async () => {
    let fail = true;
    const fn = mockApi((url) => {
      if (url.includes('cursor=c1')) return fail ? json({ message: 'x' }, 500) : page([comment(1)]);
      return page([comment(2)], 'c1');
    });
    await mount();

    await act(async () => {
      await fireEvent.press(screen.getByText('Load earlier comments'));
    });
    expect(await screen.findByText('Could not load the comments.')).toBeOnTheScreen();
    expect(ids()).toEqual([2]);

    fail = false;
    await act(async () => {
      await fireEvent.press(screen.getByText('Retry'));
    });
    expect(ids()).toEqual([1, 2]);
    expect(useTaskCommentsStore.getState().nextCursor).toBeNull();
    expect(fn.mock.calls.filter(([url]) => String(url).includes('cursor=c1'))).toHaveLength(2);
  });

  it('drops a page of older comments requested before the list was replaced', async () => {
    let release: (response: Response) => void = () => undefined;
    mockApi((url) =>
      url.includes('cursor=c1') ? new Promise<Response>((resolve) => (release = resolve)) : page([comment(2)], 'c1'),
    );
    await mount();
    await act(async () => {
      void useTaskCommentsStore.getState().loadOlder();
    });
    await act(async () => {
      useTaskCommentsStore.getState().clear();
      release(page([comment(1)]));
    });
    expect(ids()).toEqual([]);
  });

  it('sends a comment with the mention token and clears the field', async () => {
    const fn = mockApi((url, init) => {
      if (init?.method === 'POST') return json({ data: comment(9, { body: 'Hi <@2>', mentions: [members[1]] }) }, 201);
      return page([]);
    });
    await mount();

    const field = screen.getByLabelText('Add a comment');
    await fireEvent.changeText(field, 'Hi @Be');
    await fireEvent(field, 'selectionChange', {
      nativeEvent: { selection: { start: 6, end: 6 } },
    });
    await act(async () => {
      await fireEvent.press(await screen.findByLabelText('Mention Bea'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText('Comment'));
    });

    const post = calls(fn, 'POST')[0];
    expect(post[0]).toContain('/api/projects/3/tasks/5/comments');
    expect(JSON.parse(String(post[1]?.body))).toEqual({ body: 'Hi <@2>' });
    expect(ids()).toEqual([9]);
    expect(screen.getByLabelText('Add a comment').props.value).toBe('');
  });

  it('keeps the draft and shows the server error when sending fails', async () => {
    mockApi((url, init) =>
      init?.method === 'POST' ? json({ message: 'bad', errors: { body: ['Body is invalid.'] } }, 422) : page([]),
    );
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Hello');
    await act(async () => {
      await fireEvent.press(screen.getByText('Comment'));
    });
    expect(await screen.findByText('Body is invalid.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Add a comment').props.value).toBe('Hello');
  });

  it('blocks empty and too long comments', async () => {
    const fn = mockApi(() => page([]));
    await mount();
    await fireEvent.press(screen.getByText('Comment'));
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'x'.repeat(10001));
    expect(screen.getByText('The comment cannot exceed 10000 characters.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Comment'));
    expect(calls(fn, 'POST')).toHaveLength(0);
  });
});

describe('edit and delete', () => {
  it('offers edit only on own comments and delete on own ones to members', async () => {
    mockApi(() => page([comment(1), comment(2, { user: { id: 2, name: 'Bea' } })]));
    await mount();
    expect(screen.getAllByText('Edit')).toHaveLength(1);
    expect(screen.getAllByText('Delete')).toHaveLength(1);
    expect(screen.queryByLabelText('Delete comment by Bea')).toBeNull();
  });

  it('lets a moderator delete but not edit comments of others', async () => {
    useOrganizationStore.setState({
      organizations: [{ id: 7, name: 'Org', roles: ['admin'] } as never],
    });
    mockApi(() => page([comment(2, { user: { id: 2, name: 'Bea' } })]));
    await mount();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.getByLabelText('Delete comment by Bea')).toBeOnTheScreen();
  });

  it('edits a comment restoring mention names and saves the tokens', async () => {
    const fn = mockApi((url, init) => {
      if (init?.method === 'PATCH') {
        return json({
          data: comment(1, {
            body: 'Hey <@2>',
            mentions: [members[1]],
            edited_at: '2026-01-02T00:00:00.000000Z',
          }),
        });
      }
      return page([comment(1, { body: 'Hi <@2>', mentions: [members[1]] })]);
    });
    await mount();

    await fireEvent.press(screen.getByLabelText('Edit comment by Ana'));
    const field = screen.getByLabelText('Edit comment');
    expect(field.props.value).toBe('Hi @Bea');
    await fireEvent.changeText(field, 'Hey @Bea');
    await act(async () => {
      await fireEvent.press(screen.getByText('Save'));
    });

    const patch = calls(fn, 'PATCH')[0];
    expect(patch[0]).toContain('/api/projects/3/tasks/5/comments/1');
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ body: 'Hey <@2>' });
    expect(useTaskCommentsStore.getState().comments[0].body).toBe('Hey <@2>');
    expect(screen.queryByLabelText('Edit comment')).toBeNull();
    expect(screen.getByText('(edited)')).toBeOnTheScreen();
  });

  it('does not save an unchanged comment and shows edit errors', async () => {
    const fn = mockApi((url, init) => (init?.method === 'PATCH' ? json({ message: 'no' }, 403) : page([comment(1)])));
    await mount();
    await fireEvent.press(screen.getByLabelText('Edit comment by Ana'));
    await fireEvent.press(screen.getByText('Save'));
    expect(calls(fn, 'PATCH')).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Edit comment'), 'Changed');
    await act(async () => {
      await fireEvent.press(screen.getByText('Save'));
    });
    expect(await screen.findByText('You cannot edit this comment.')).toBeOnTheScreen();
  });

  async function confirmDeletion() {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    alert.mockClear();
    await fireEvent.press(screen.getAllByLabelText('Delete comment by Ana')[0]);
    const buttons = alert.mock.calls[0][2]!;
    await act(async () => {
      buttons.find((button) => button.style === 'destructive')!.onPress!();
    });
    return alert;
  }

  it('deletes after confirming', async () => {
    const fn = mockApi((url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : page([comment(1), comment(2)]),
    );
    await mount();
    await confirmDeletion();
    expect(calls(fn, 'DELETE')[0][0]).toContain('/api/projects/3/tasks/5/comments/1');
    expect(ids()).toEqual([2]);
  });

  it('removes the comment when the server says it is gone and reports other failures', async () => {
    let status = 404;
    mockApi((url, init) => (init?.method === 'DELETE' ? json({ message: 'x' }, status) : page([comment(1)])));
    await mount();
    await confirmDeletion();
    expect(ids()).toEqual([]);

    await act(async () => {
      useTaskCommentsStore.setState({ comments: [comment(1) as never] });
    });
    status = 403;
    const alert = await confirmDeletion();
    expect(alert).toHaveBeenLastCalledWith('You cannot delete this comment.');
    expect(ids()).toEqual([1]);
  });
});

describe('comments store', () => {
  it('ignores inserts of other tasks and older edits', async () => {
    mockApi(() => page([comment(1, { edited_at: '2026-01-03T00:00:00.000000Z', body: 'new' })]));
    await mount();
    const store = useTaskCommentsStore.getState();
    expect(store.insert(comment(4, { task_id: 6 }) as never)).toBe(false);
    expect(store.insert(comment(1) as never)).toBe(false);
    expect(
      store.replace(
        comment(1, {
          body: 'old',
          edited_at: '2026-01-02T00:00:00.000000Z',
        }) as never,
      ),
    ).toBe(false);
    expect(useTaskCommentsStore.getState().comments[0].body).toBe('new');
  });
});

describe('races and errors', () => {
  it('does not insert a comment whose send resolves after clear', async () => {
    let release: (response: Response) => void = () => undefined;
    mockApi((url, init) =>
      init?.method === 'POST' ? new Promise<Response>((resolve) => (release = resolve)) : page([]),
    );
    await mount();
    let sent: Promise<number | null> = Promise.resolve(null);
    await act(async () => {
      sent = useTaskCommentsStore.getState().send('late');
    });
    await act(async () => {
      useTaskCommentsStore.getState().clear();
      release(json({ data: comment(9) }, 201));
      await sent;
    });
    expect(await sent).toBeNull();
    expect(ids()).toEqual([]);
  });

  it('does not insert a comment whose send resolves after another task was opened', async () => {
    let release: (response: Response) => void = () => undefined;
    mockApi((url, init) =>
      init?.method === 'POST' ? new Promise<Response>((resolve) => (release = resolve)) : page([]),
    );
    await mount();
    let sent: Promise<number | null> = Promise.resolve(null);
    await act(async () => {
      sent = useTaskCommentsStore.getState().send('late');
    });
    await act(async () => {
      await useTaskCommentsStore.getState().open(3, 6);
      release(json({ data: comment(9) }, 201));
      await sent;
    });
    expect(ids()).toEqual([]);
  });

  it('applies an update or a delete answered after another task was opened only to its own task', async () => {
    let releasePatch: (response: Response) => void = () => undefined;
    let releaseDelete: (response: Response) => void = () => undefined;
    mockApi((url, init) => {
      if (init?.method === 'PATCH') return new Promise<Response>((resolve) => (releasePatch = resolve));
      if (init?.method === 'DELETE') return new Promise<Response>((resolve) => (releaseDelete = resolve));
      return page([comment(1)]);
    });
    await mount();
    const store = useTaskCommentsStore.getState();
    let patch: Promise<unknown> = Promise.resolve();
    let del: Promise<unknown> = Promise.resolve();
    await act(async () => {
      patch = store.update(3, 5, 1, 'edited');
      del = store.destroy(3, 5, 1);
    });
    await act(async () => {
      await useTaskCommentsStore.getState().open(3, 6);
      useTaskCommentsStore.setState({ comments: [comment(1, { task_id: 6, body: 'other task' }) as never] });
      releasePatch(json({ data: comment(1, { body: 'edited', edited_at: '2026-01-02T00:00:00.000000Z' }) }));
      releaseDelete(new Response(null, { status: 204 }));
      await patch;
      await del;
    });
    expect(useTaskCommentsStore.getState().comments.map((item) => item.body)).toEqual(['other task']);
  });

  it('asks for the first page again when the open failed and the user retries', async () => {
    let fail = true;
    const fn = mockApi(() => (fail ? json({ message: 'x' }, 500) : page([comment(1)], 'c1')));
    await mount();
    expect(await screen.findByText('Could not load the comments.')).toBeOnTheScreen();
    expect(ids()).toEqual([]);

    fail = false;
    await act(async () => {
      await fireEvent.press(screen.getByText('Retry'));
    });
    expect(ids()).toEqual([1]);
    expect(screen.queryByText('Could not load the comments.')).toBeNull();
    const listCalls = fn.mock.calls.filter(([url]) => String(url).includes('/comments'));
    expect(listCalls).toHaveLength(2);
    expect(listCalls.every(([url]) => !String(url).includes('cursor='))).toBe(true);
  });

  it('shows rate limit and network errors when sending', async () => {
    let mode: 'limit' | 'network' = 'limit';
    mockApi((url, init) => {
      if (init?.method !== 'POST') return page([]);
      if (mode === 'network') throw new TypeError('Network request failed');
      return json({ message: 'slow down' }, 429);
    });
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Hello');
    await act(async () => {
      await fireEvent.press(screen.getByText('Comment'));
    });
    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeOnTheScreen();

    mode = 'network';
    await act(async () => {
      await fireEvent.press(screen.getByText('Comment'));
    });
    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Add a comment').props.value).toBe('Hello');
  });

  it('shows rate limit and network errors when editing', async () => {
    let mode: 'limit' | 'network' = 'limit';
    mockApi((url, init) => {
      if (init?.method !== 'PATCH') return page([comment(1)]);
      if (mode === 'network') throw new TypeError('Network request failed');
      return json({ message: 'slow down' }, 429);
    });
    await mount();
    await fireEvent.press(screen.getByLabelText('Edit comment by Ana'));
    await fireEvent.changeText(screen.getByLabelText('Edit comment'), 'Changed');
    await act(async () => {
      await fireEvent.press(screen.getByText('Save'));
    });
    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeOnTheScreen();

    mode = 'network';
    await act(async () => {
      await fireEvent.press(screen.getByText('Save'));
    });
    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });
});
