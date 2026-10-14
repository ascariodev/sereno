import { api } from '@/api/client';
import { type Message, useMessagesStore } from '@/messages/store';

function message(id: number, extra: Partial<Message> = {}): Message {
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

function reply(id: number, parent: number, createdAt: string): Message {
  return message(id, { parent_id: parent, created_at: createdAt, user: { id: 2, name: 'Beto' } });
}

function page(data: Message[], nextCursor: string | null = null) {
  return new Response(JSON.stringify({ data, meta: { next_cursor: nextCursor } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function root(id: number) {
  return useMessagesStore.getState().messages.find((m) => m.id === id)!;
}

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
});

describe('messages store thread counters', () => {
  it('counts live replies that arrive while the first page loads', async () => {
    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const opening = useMessagesStore.getState().open(50);

    useMessagesStore.getState().insert(reply(5, 1, '2026-01-01T11:00:00Z'));
    useMessagesStore.getState().insert(reply(4, 1, '2026-01-01T09:00:00Z'));
    pending.resolve(page([message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' })]));
    await opening;

    expect(root(1).replies_count).toBe(2);
    expect(root(1).last_reply_at).toBe('2026-01-01T11:00:00Z');
  });

  it('counts live replies that arrive while an older page loads', async () => {
    globalThis.fetch = jest.fn(async () => page([message(3)], 'c1')) as never;
    await useMessagesStore.getState().open(50);
    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const loading = useMessagesStore.getState().loadOlder();

    useMessagesStore.getState().insert(reply(8, 2, '2026-01-01T11:00:00Z'));
    pending.resolve(page([message(2, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' })]));
    await loading;

    expect(root(2).replies_count).toBe(2);
  });

  it('keeps the local edit but takes server counters and later live replies on catch-up', async () => {
    globalThis.fetch = jest.fn(async () => page([message(1, { body: 'Edited', edited_at: '2026-01-02T00:00:00Z' })])) as never;
    await useMessagesStore.getState().open(50);

    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const catching = useMessagesStore.getState().catchUp();
    useMessagesStore.getState().insert(reply(7, 1, '2026-01-01T12:00:00Z'));
    pending.resolve(
      page([message(1, { body: 'Old', edited_at: '2026-01-01T01:00:00Z', replies_count: 3, last_reply_at: '2026-01-01T10:00:00Z' })]),
    );
    await catching;

    expect(root(1).body).toBe('Edited');
    expect(root(1).replies_count).toBe(4);
    expect(root(1).last_reply_at).toBe('2026-01-01T12:00:00Z');
  });

  it('does not restore counters from a page that predates a live deletion', async () => {
    globalThis.fetch = jest.fn(async () => page([message(3)], 'c1')) as never;
    await useMessagesStore.getState().open(50);
    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const loading = useMessagesStore.getState().loadOlder();

    useMessagesStore.getState().remove({
      id: 9,
      channel_id: 50,
      parent_id: 2,
      deleted_at: '2026-01-01T12:00:00Z',
      root: { id: 2, replies_count: 1, last_reply_at: '2026-01-01T09:00:00Z' },
    });
    pending.resolve(page([message(2, { replies_count: 2, last_reply_at: '2026-01-01T10:00:00Z' })]));
    await loading;

    expect(root(2).replies_count).toBe(1);
    expect(root(2).last_reply_at).toBe('2026-01-01T09:00:00Z');
  });

  it('drops a deleted root without replies and keeps a marker when it has replies', async () => {
    globalThis.fetch = jest.fn(async () =>
      page([
        message(2, {
          replies_count: 2,
          last_reply_at: '2026-01-01T10:00:00Z',
          attachments: [{ id: 9, original_name: 'a.png', mime: 'image/png', size: 1, created_at: '2026-01-01T00:00:00Z', url: 'https://files.test/9' }],
        }),
        message(1),
      ]),
    ) as never;
    await useMessagesStore.getState().open(50);
    const store = useMessagesStore.getState();

    store.remove({ id: 1, channel_id: 50, parent_id: null, deleted_at: '2026-01-02T00:00:00Z', root: { id: 1, replies_count: 0, last_reply_at: null } });
    store.remove({
      id: 2,
      channel_id: 50,
      parent_id: null,
      deleted_at: '2026-01-02T00:00:00Z',
      root: { id: 2, replies_count: 2, last_reply_at: '2026-01-01T10:00:00Z' },
    });

    const list = useMessagesStore.getState().messages;
    expect(list.map((m) => m.id)).toEqual([2]);
    expect(list[0].deleted_at).toBe('2026-01-02T00:00:00Z');
    expect(list[0].body).toBeNull();
    expect(list[0].attachments).toEqual([]);
  });
});
