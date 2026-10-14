import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import {
  createAuthorizer,
  disconnectRealtime,
  onReconnect,
  resumeRealtime,
  setRealtimeClientFactory,
  setRealtimeTokenProvider,
  subscribeToUser,
} from '@/realtime/echo';
import { useRealtimeSession } from '@/realtime/useRealtimeSession';
import { useAuthStore } from '@/session/auth';

jest.mock('@/config', () => ({
  config: { apiUrl: 'http://api.test', reverb: { key: 'app-key', host: 'ws.test', port: 8086, scheme: 'http' } },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

type Handler = (data?: unknown) => void;

class MockEmitter {
  handlers = new Map<string, Set<Handler>>();
  bind(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  unbind(event: string, handler?: Handler) {
    if (handler) this.handlers.get(event)?.delete(handler);
    else this.handlers.delete(event);
  }
  emit(event: string, data?: unknown) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(data);
  }
}

class MockConnection extends MockEmitter {
  state = 'connecting';
  socket_id = '1.2';
  setState(state: string) {
    this.state = state;
    this.emit('state_change', { current: state });
  }
}

class MockPusher {
  static instances: MockPusher[] = [];
  connection = new MockConnection();
  channels = new Map<string, MockEmitter>();
  connect = jest.fn();
  disconnect = jest.fn();
  unsubscribe = jest.fn((name: string) => void this.channels.delete(name));
  constructor(
    readonly key: string,
    readonly options: Record<string, unknown>,
  ) {
    MockPusher.instances.push(this);
  }
  subscribe(name: string) {
    const channel = this.channels.get(name) ?? new MockEmitter();
    this.channels.set(name, channel);
    return channel;
  }
}

jest.mock('pusher-js/react-native', () => ({
  __esModule: true,
  get default() {
    return MockPusher;
  },
}));

function pusher(): MockPusher {
  const instance = MockPusher.instances.at(-1);
  if (!instance) throw new Error('No Pusher was created');
  return instance;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  setRealtimeClientFactory(null);
  MockPusher.instances = [];
  setRealtimeTokenProvider(() => 'secret');
});

afterEach(() => {
  disconnectRealtime();
});

describe('realtime client over a simulated Pusher', () => {
  it('opens the private user channel with the Reverb settings and dispatches valid events', () => {
    const onProjectAccessChanged = jest.fn();
    subscribeToUser(1, { onProjectAccessChanged });

    expect(pusher().key).toBe('app-key');
    expect(pusher().options).toMatchObject({ wsHost: 'ws.test', wsPort: 8086, forceTLS: false, enabledTransports: ['ws', 'wss'] });
    const channel = pusher().channels.get('private-users.1')!;
    expect(channel).toBeDefined();

    channel.emit('project.access_changed', { organization_id: 7, project_id: 3, granted: true });
    channel.emit('project.access_changed', { organization_id: 7, project_id: '3', granted: true });
    channel.emit('project.access_changed', { project_id: 3, granted: true });

    expect(onProjectAccessChanged).toHaveBeenCalledTimes(1);
    expect(onProjectAccessChanged).toHaveBeenCalledWith(7, 3, true);
  });

  it('leaves the channel only when its last subscriber goes', () => {
    const first = subscribeToUser(1);
    const second = subscribeToUser(1);

    first();
    expect(pusher().unsubscribe).not.toHaveBeenCalled();
    second();
    expect(pusher().unsubscribe).toHaveBeenCalledWith('private-users.1');
  });

  it('drops a channel whose subscription failed so the next subscriber opens it again', () => {
    subscribeToUser(1);
    pusher().channels.get('private-users.1')!.emit('pusher:subscription_error', { status: 403 });
    expect(pusher().unsubscribe).toHaveBeenCalledWith('private-users.1');

    const onRoleChanged = jest.fn();
    subscribeToUser(1, { onRoleChanged });
    pusher().channels.get('private-users.1')!.emit('membership.role_changed', { organization_id: 7, role: 'admin' });

    expect(onRoleChanged).toHaveBeenCalledWith(7, 'admin');
  });

  it('notifies a reconnection only after the connection dropped', () => {
    const callback = jest.fn();
    onReconnect(callback);

    pusher().connection.setState('connected');
    expect(callback).not.toHaveBeenCalled();

    pusher().connection.setState('unavailable');
    pusher().connection.setState('connecting');
    pusher().connection.setState('connected');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('resumes a dropped socket but leaves a live one alone', () => {
    subscribeToUser(1);
    pusher().connection.setState('connected');
    resumeRealtime();
    expect(pusher().connect).not.toHaveBeenCalled();

    pusher().connection.setState('unavailable');
    resumeRealtime();
    expect(pusher().connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects when the session is cleared', async () => {
    subscribeToUser(1);
    await useAuthStore.getState().clearSession();

    expect(pusher().disconnect).toHaveBeenCalled();
  });
});

describe('channel authorization', () => {
  it('posts the socket and channel to /broadcasting/auth with the Bearer token', async () => {
    const fetchImpl = jest.fn(async () => json({ auth: 'app-key:signature' }));
    const callback = jest.fn();

    createAuthorizer(fetchImpl as never)({ socketId: '1.2', channelName: 'private-users.1' }, callback);
    await act(async () => undefined);

    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/broadcasting/auth', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify({ socket_id: '1.2', channel_name: 'private-users.1' }),
    });
    expect(callback).toHaveBeenCalledWith(null, { auth: 'app-key:signature' });
  });

  it('reports a rejected authorization as an error', async () => {
    const callback = jest.fn();

    createAuthorizer((async () => json({}, 403)) as never)({ socketId: '1.2', channelName: 'private-users.1' }, callback);
    await act(async () => undefined);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), null);
    expect(callback.mock.calls[0][0].message).toContain('403');
  });

  it('is the handler that Echo gives to Pusher', () => {
    subscribeToUser(1);

    expect(pusher().options).toMatchObject({ channelAuthorization: { customHandler: expect.any(Function) } });
  });
});

describe('useRealtimeSession', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;

  beforeEach(() => {
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
    useProjectsStore.getState().clear();
    useOrganizationStore.setState({ activeId: 7 });
    useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/projects')) return json({ data: [], meta: { last_page: 1 } });
      return json({ data: [], meta: { next_cursor: null } });
    }) as never;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await act(async () => useAuthStore.setState({ user: null }));
  });

  function projectRequests(): number {
    return (globalThis.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/api/projects')).length;
  }

  it('subscribes to the user channel and refreshes the projects when access changes in the active organization', async () => {
    await renderHook(() => useRealtimeSession());
    const channel = pusher().channels.get('private-users.1')!;

    await act(async () => channel.emit('project.access_changed', { organization_id: 8, project_id: 3, granted: true }));
    expect(projectRequests()).toBe(0);

    await act(async () => channel.emit('project.access_changed', { organization_id: 7, project_id: 3, granted: true }));
    expect(projectRequests()).toBe(1);
  });

  it('leaves the user channel when unmounted', async () => {
    const { unmount } = await renderHook(() => useRealtimeSession());
    await unmount();

    expect(pusher().unsubscribe).toHaveBeenCalledWith('private-users.1');
  });

  it('refreshes the projects after a reconnection', async () => {
    await renderHook(() => useRealtimeSession());
    pusher().connection.setState('connected');
    pusher().connection.setState('unavailable');

    await act(async () => pusher().connection.setState('connected'));
    expect(projectRequests()).toBe(1);
  });

  it('resumes the socket when the app comes back to the foreground', async () => {
    await renderHook(() => useRealtimeSession());
    pusher().connection.setState('unavailable');

    await act(async () => appStateListener?.('background'));
    expect(pusher().connect).not.toHaveBeenCalled();
    await act(async () => appStateListener?.('active'));
    expect(pusher().connect).toHaveBeenCalledTimes(1);
  });
});
