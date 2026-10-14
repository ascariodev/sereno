import { api } from '@/api/client';
import { type Message, useMessagesStore } from '@/messages/store';
import { useThreadStore } from '@/messages/threadStore';

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

function reply(id: number, createdAt = '2026-01-01T10:00:00Z', extra: Partial<Message> = {}): Message {
  return message(id, { parent_id: 1, created_at: createdAt, user: { id: 2, name: 'Beto' }, ...extra });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function page(data: Message[], nextCursor: string | null = null, rootMessage?: Message) {
  return json({ data, meta: { next_cursor: nextCursor, ...(rootMessage ? { root: rootMessage } : {}) } });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const thread = () => useThreadStore.getState();
const ids = () => thread().replies.map((r) => r.id);

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  thread().clear();
});

describe('thread store', () => {
  it('loads replies and the root from meta.root', async () => {
    const fetchMock = jest.fn(async (_url: string) =>
      page([reply(3), reply(2)], null, message(1, { replies_count: 2, last_reply_at: '2026-01-01T10:00:00Z' })),
    );
    globalThis.fetch = fetchMock as never;
    await thread().open(50, 1);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/channels/50/messages/1/replies');
    expect(ids()).toEqual([2, 3]);
    expect(thread().root?.replies_count).toBe(2);
    expect(thread().loading).toBe(false);
  });

  it('marks a missing thread as not found', async () => {
    globalThis.fetch = jest.fn(async () => json({ message: 'x' }, 404)) as never;
    await thread().open(50, 1);
    expect(thread().notFound).toBe(true);
    expect(thread().failed).toBe(true);
  });

  it('loads older pages without duplicating', async () => {
    globalThis.fetch = jest.fn(async (url: string) =>
      String(url).includes('cursor=c1') ? page([reply(2), reply(1000)]) : page([reply(4), reply(3)], 'c1'),
    ) as never;
    await thread().open(50, 1);
    await thread().loadOlder();
    expect(ids()).toEqual([2, 3, 4, 1000]);
    expect(thread().nextCursor).toBeNull();
  });

  it('counts a live reply that arrives while the first page loads, once', async () => {
    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const opening = thread().open(50, 1);

    thread().insert(reply(5, '2026-01-01T11:00:00Z'));
    thread().insert(reply(4, '2026-01-01T09:00:00Z'));
    pending.resolve(page([reply(4, '2026-01-01T09:00:00Z')], null, message(1, { replies_count: 1, last_reply_at: '2026-01-01T09:00:00Z' })));
    await opening;

    expect(ids()).toEqual([4, 5]);
    expect(thread().root?.replies_count).toBe(2);
  });

  it('does not double count a live reply already in the root snapshot', async () => {
    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const opening = thread().open(50, 1);
    thread().insert(reply(5, '2026-01-01T10:00:00Z'));
    pending.resolve(page([reply(5, '2026-01-01T10:00:00Z')], null, message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' })));
    await opening;
    expect(thread().root?.replies_count).toBe(1);
  });

  it('uses the counters of a live deletion over a stale in-flight snapshot', async () => {
    const pending = deferred();
    globalThis.fetch = jest.fn(() => pending.promise) as never;
    const opening = thread().open(50, 1);
    thread().remove({
      id: 6,
      channel_id: 50,
      parent_id: 1,
      deleted_at: '2026-01-01T12:00:00Z',
      root: { id: 1, replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' },
    });
    pending.resolve(page([reply(6), reply(2)], null, message(1, { replies_count: 2, last_reply_at: '2026-01-01T10:00:00Z' })));
    await opening;

    expect(ids()).toEqual([2]);
    expect(thread().root?.replies_count).toBe(1);
    expect(thread().insert(reply(6))).toBe(false);
  });

  it('keeps older edits from reverting a live edit and marks a deleted root', async () => {
    globalThis.fetch = jest.fn(async () => page([reply(2)], null, message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' }))) as never;
    await thread().open(50, 1);

    expect(thread().replace(reply(2, '2026-01-01T10:00:00Z', { body: 'New', edited_at: '2026-01-02T00:00:00Z' }))).toBe(true);
    expect(thread().replace(reply(2, '2026-01-01T10:00:00Z', { body: 'Old', edited_at: '2026-01-01T12:00:00Z' }))).toBe(false);
    expect(thread().replies[0].body).toBe('New');

    thread().replace(message(1, { body: 'Root edited', edited_at: '2026-01-02T00:00:00Z' }));
    expect(thread().root?.body).toBe('Root edited');
    expect(thread().root?.replies_count).toBe(1);

    thread().remove({
      id: 1,
      channel_id: 50,
      parent_id: null,
      deleted_at: '2026-01-03T00:00:00Z',
      root: { id: 1, replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' },
    });
    expect(thread().root?.deleted_at).toBe('2026-01-03T00:00:00Z');
    expect(thread().root?.body).toBeNull();
  });

  it('ignores events of other threads and channels', async () => {
    globalThis.fetch = jest.fn(async () => page([])) as never;
    await thread().open(50, 1);
    expect(thread().insert(message(9, { parent_id: 2 }))).toBe(false);
    expect(thread().insert(message(9, { parent_id: 1, channel_id: 51 }))).toBe(false);
    expect(thread().replace(message(9, { parent_id: 2 }))).toBe(false);
  });

  it('catches up with replies created and deleted while disconnected', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls++;
      return calls === 1
        ? page([reply(3), reply(2)], null, message(1, { replies_count: 2, last_reply_at: '2026-01-01T10:00:00Z' }))
        : page([reply(4, '2026-01-01T11:00:00Z'), reply(3)], null, message(1, { replies_count: 2, last_reply_at: '2026-01-01T11:00:00Z' }));
    }) as never;
    await thread().open(50, 1);
    await thread().catchUp();

    expect(ids()).toEqual([3, 4]);
    expect(thread().root?.replies_count).toBe(2);
    expect(thread().insert(reply(2))).toBe(false);
  });

  it('waits for an open in flight before catching up, and a stale catch up does not apply', async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    globalThis.fetch = jest.fn(() => queue.shift()!.promise) as never;
    const opening = thread().open(50, 1);
    const catching = thread().catchUp();
    first.resolve(page([reply(2)], null, message(1, { replies_count: 1, last_reply_at: '2026-01-01T10:00:00Z' })));
    await opening;
    await Promise.resolve();
    second.resolve(page([reply(3, '2026-01-01T11:00:00Z'), reply(2)], null, message(1, { replies_count: 2, last_reply_at: '2026-01-01T11:00:00Z' })));
    await catching;
    expect(ids()).toEqual([2, 3]);

    const late = deferred();
    globalThis.fetch = jest.fn(() => late.promise) as never;
    const stale = thread().catchUp();
    thread().clear();
    late.resolve(page([reply(9)]));
    await stale;
    expect(thread().replies).toEqual([]);
  });

  it('skips catch up when the open failed', async () => {
    const fetchMock = jest.fn(async () => json({}, 500));
    globalThis.fetch = fetchMock as never;
    await thread().open(50, 1);
    await thread().catchUp();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a reply to the thread and to the channel root', async () => {
    const sent = reply(7, '2026-01-01T12:00:00Z');
    globalThis.fetch = jest.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({ data: sent }, 201) : page([], null, message(1)),
    ) as never;
    useMessagesStore.setState({ channelId: 50, messages: [message(1)] });
    await thread().open(50, 1);
    await thread().send('hi');

    expect(ids()).toEqual([7]);
    expect(thread().root?.replies_count).toBe(1);
    expect(useMessagesStore.getState().messages[0].replies_count).toBe(1);
  });
});
