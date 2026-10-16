import { MEMBER_DIRECTORY_TTL_MS, useMemberDirectoryStore } from '@/projects/members';
import { useOrganizationStore } from '@/organization/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: string) => handler(String(url)));
  globalThis.fetch = fn as never;
  return fn;
}

const bea = { id: 7, name: 'Bea' };
const store = () => useMemberDirectoryStore.getState();

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
  store().clear();
  useOrganizationStore.setState({ organizations: [], activeId: 3 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('member directory', () => {
  it('reuses a loaded list until the TTL expires, then refreshes it', async () => {
    const fetchMock = mockFetch(() => json({ data: [bea] }));

    await store().ensureLoaded(5);
    await store().ensureLoaded(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store().entries[5].members).toEqual([bea]);

    jest.advanceTimersByTime(MEMBER_DIRECTORY_TTL_MS - 1);
    await store().ensureLoaded(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await store().ensureLoaded(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares the in-flight request between concurrent callers', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetchMock = mockFetch(() => new Promise<Response>((r) => (resolve = r)));

    const first = store().ensureLoaded(5);
    const second = store().ensureLoaded(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(json({ data: [bea] }));
    await Promise.all([first, second]);
    expect(store().entries[5].members).toEqual([bea]);
    expect(store().entries[5].inFlight).toBeNull();
  });

  it('does nothing without a project or an active organization', async () => {
    const fetchMock = mockFetch(() => json({ data: [bea] }));

    await store().ensureLoaded(null);
    await store().ensureLoaded(undefined);
    useOrganizationStore.setState({ activeId: null });
    await store().ensureLoaded(5);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('empties the directory when the active organization changes and drops a late answer', async () => {
    let resolve: (response: Response) => void = () => {};
    mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    const pending = store().ensureLoaded(5);

    useOrganizationStore.setState({ activeId: 4 });
    expect(store().entries).toEqual({});

    resolve(json({ data: [bea] }));
    await pending;
    expect(store().entries).toEqual({});
  });

  it('refetches after invalidate and discards the answer of the invalidated request', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetchMock = mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    const stale = store().ensureLoaded(5);
    const resolveStale = resolve;

    store().invalidate(5);
    expect(store().entries[5].inFlight).toBeNull();
    fetchMock.mockImplementation(async () => json({ data: [{ id: 8, name: 'Cy' }] }));
    await store().ensureLoaded(5);
    resolveStale(json({ data: [bea] }));
    await stale;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store().entries[5].members).toEqual([{ id: 8, name: 'Cy' }]);
  });

  it('invalidates every project when called without an id', async () => {
    const fetchMock = mockFetch(() => json({ data: [bea] }));
    await store().ensureLoaded(5);
    await store().ensureLoaded(6);

    store().invalidate();
    expect(store().entries[5].loadedAt).toBe(0);
    expect(store().entries[6].loadedAt).toBe(0);
    await store().ensureLoaded(5);
    await store().ensureLoaded(6);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('clear empties the directory and drops answers still in flight', async () => {
    let resolve: (response: Response) => void = () => {};
    mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    const pending = store().ensureLoaded(5);

    store().clear();
    expect(store().entries).toEqual({});
    resolve(json({ data: [bea] }));
    await pending;

    expect(store().entries).toEqual({});
  });

  it('keeps the entry reloadable when the request fails', async () => {
    const fetchMock = mockFetch(() => json({ message: 'no' }, 500));

    await store().ensureLoaded(5);
    expect(store().entries[5].members).toEqual([]);
    expect(store().entries[5].inFlight).toBeNull();

    fetchMock.mockImplementation(async () => json({ data: [bea] }));
    await store().ensureLoaded(5);
    expect(store().entries[5].members).toEqual([bea]);
  });
});
