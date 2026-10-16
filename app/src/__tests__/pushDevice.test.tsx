import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { DevicePush } from '@/components/DevicePush';
import { i18n } from '@/i18n';
import { forgetPushRegistration, releasePushOnLogout, usePushRegistration, usePushStore } from '@/push/device';
import { installAuthOnApi, useAuthStore } from '@/session/auth';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-device', () => ({ deviceName: 'Pixel', modelName: 'Pixel 8' }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone', expoConfig: { extra: { eas: { projectId: 'project-uuid' } } } },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

const mockTokenListeners: ((token: unknown) => void)[] = [];
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6 },
  PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn((listener: (token: unknown) => void) => {
    mockTokenListeners.push(listener);
    return { remove: jest.fn() };
  }),
}));

const notifications = Notifications as jest.Mocked<typeof Notifications>;
const secureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const undetermined = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
const deniedForGood = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
const deniedOnce = { status: 'denied', granted: false, canAskAgain: true, expires: 'never' };
const user = { id: 1, name: 'Ana', email: 'ana@example.com', locale: 'en' };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockApi(handler: Handler) {
  const fn = jest.fn(async (url: string, init: RequestInit) => handler(url, init));
  globalThis.fetch = fn as never;
  return fn;
}

const calls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map(([url, init]: [string, RequestInit]) => `${init.method} ${url.replace(/^https?:\/\/[^/]+/, '')}`);

function Probe({ signedIn }: { signedIn: boolean }) {
  usePushRegistration(signedIn);
  return null;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockTokenListeners.length = 0;
  jest.clearAllMocks();
  secureStore.getItemAsync.mockReset().mockResolvedValue(null);
  notifications.getPermissionsAsync.mockResolvedValue(granted as never);
  notifications.requestPermissionsAsync.mockResolvedValue(granted as never);
  notifications.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[one]' });
  forgetPushRegistration();
  installAuthOnApi();
  useAuthStore.setState({ token: 'tk', user });
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('push registration', () => {
  it('registers the Expo token after signing in', async () => {
    const fetchMock = mockApi(() => json({ data: {} }, 201));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({ importance: 6 }));
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-uuid', devicePushToken: undefined });
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      token: 'ExponentPushToken[one]',
      platform: 'android',
      device_name: 'Pixel',
    });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer tk' });
    expect(usePushStore.getState().state).toBe('active');
  });

  it('does nothing while signed out', async () => {
    const fetchMock = mockApi(() => json({}));

    await act(async () => {
      render(<Probe signedIn={false} />);
    });
    await flush();

    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once on Android 13+ where the status is denied but it can still ask, and stores the mark', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(deniedOnce as never);
    const fetchMock = mockApi(() => json({ data: {} }, 201));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith('sereno.pushPrompted', '1');
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
  });

  it('does not ask again once the mark is stored', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce('1');
    notifications.getPermissionsAsync.mockResolvedValue(deniedOnce as never);
    const fetchMock = mockApi(() => json({}));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePushStore.getState().state).toBe('inactive');
  });

  it('does not ask when the mark cannot be written, and retries on resume', async () => {
    const appStateListeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      appStateListeners.push(listener);
      return { remove: jest.fn() };
    }) as never);
    notifications.getPermissionsAsync.mockResolvedValue(undetermined as never);
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('storage unavailable'));
    const fetchMock = mockApi(() => json({ data: {} }, 201));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      appStateListeners.forEach((listener) => listener('active'));
    });
    await flush();

    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(2);
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
  });

  it('registers without asking when already granted', async () => {
    const fetchMock = mockApi(() => json({ data: {} }, 201));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
  });

  it('asks for permission the first time only', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(undetermined as never);
    const fetchMock = mockApi(() => json({ data: {} }, 201));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
  });

  it('does not prompt again nor register after a denial', async () => {
    secureStore.getItemAsync.mockResolvedValue('1');
    notifications.getPermissionsAsync.mockResolvedValue(deniedOnce as never);
    const fetchMock = mockApi(() => json({}));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePushStore.getState().state).toBe('inactive');
  });

  it('marks push as blocked when the system no longer lets the app ask', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(deniedForGood as never);
    notifications.requestPermissionsAsync.mockResolvedValue(deniedForGood as never);
    const fetchMock = mockApi(() => json({}));

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePushStore.getState().state).toBe('blocked');
  });

  it('registers the new token when it changes and drops the old one', async () => {
    const fetchMock = mockApi(() => json({ data: {} }, 201));
    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();
    notifications.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[two]' });
    const devicePushToken = { type: 'android', data: 'fcm-new' };

    await act(async () => {
      mockTokenListeners[0](devicePushToken);
    });
    await flush();

    expect(notifications.getExpoPushTokenAsync).toHaveBeenLastCalledWith({ projectId: 'project-uuid', devicePushToken });
    expect(calls(fetchMock)).toEqual([
      'POST /api/me/expo-push-tokens',
      'POST /api/me/expo-push-tokens',
      'DELETE /api/me/expo-push-tokens?token=ExponentPushToken%5Bone%5D',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).token).toBe('ExponentPushToken[two]');
  });

  it('registers a token that rotates while the first registration is in flight', async () => {
    let resolveFirst: (response: Response) => void = () => {};
    const fetchMock = mockApi((url, init) => {
      if (init.method === 'POST' && fetchMock.mock.calls.length === 1) return new Promise<Response>((resolve) => (resolveFirst = resolve));
      return init.method === 'POST' ? json({ data: {} }, 201) : new Response(null, { status: 204 });
    });
    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();
    notifications.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[two]' });
    const devicePushToken = { type: 'android', data: 'fcm-new' };

    await act(async () => {
      mockTokenListeners[0](devicePushToken);
    });
    await flush();
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);

    await act(async () => {
      resolveFirst(json({ data: {} }, 201));
    });
    await flush();

    expect(notifications.getExpoPushTokenAsync).toHaveBeenLastCalledWith({ projectId: 'project-uuid', devicePushToken });
    expect(calls(fetchMock)).toEqual([
      'POST /api/me/expo-push-tokens',
      'POST /api/me/expo-push-tokens',
      'DELETE /api/me/expo-push-tokens?token=ExponentPushToken%5Bone%5D',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).token).toBe('ExponentPushToken[two]');
  });

  it('does not post again when the device token changes but the Expo token does not', async () => {
    const fetchMock = mockApi(() => json({ data: {} }, 201));
    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    await act(async () => {
      mockTokenListeners[0]({ type: 'android', data: 'fcm-new' });
    });
    await flush();

    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(2);
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
  });

  it('syncs again on resume without prompting after a denial', async () => {
    secureStore.getItemAsync.mockResolvedValue('1');
    const appStateListeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      appStateListeners.push(listener);
      return { remove: jest.fn() };
    }) as never);
    notifications.getPermissionsAsync.mockResolvedValue(deniedOnce as never);
    const fetchMock = mockApi(() => json({ data: {} }, 201));
    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    await act(async () => {
      appStateListeners.forEach((listener) => listener('active'));
    });
    await flush();

    expect(notifications.getPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    notifications.getPermissionsAsync.mockResolvedValue(granted as never);
    await act(async () => {
      appStateListeners.forEach((listener) => listener('active'));
    });
    await flush();

    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
    expect(usePushStore.getState().state).toBe('active');
  });

  it('keeps the session when the registration fails', async () => {
    mockApi(() => {
      throw new TypeError('Network request failed');
    });

    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();

    expect(useAuthStore.getState().token).toBe('tk');
    expect(usePushStore.getState().state).toBeNull();
  });
});

describe('logout', () => {
  async function registered() {
    await act(async () => {
      render(<Probe signedIn />);
    });
    await flush();
  }

  it('deletes the token before logging out', async () => {
    const fetchMock = mockApi((url, init) => (init.method === 'POST' && url.endsWith('tokens') ? json({ data: {} }, 201) : new Response(null, { status: 204 })));
    await registered();

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(calls(fetchMock).slice(1)).toEqual([
      'DELETE /api/me/expo-push-tokens?token=ExponentPushToken%5Bone%5D',
      'POST /api/auth/logout',
    ]);
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer tk' });
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('still logs out when the delete fails on the network', async () => {
    const fetchMock = mockApi((url, init) => {
      if (init.method === 'DELETE') throw new TypeError('Network request failed');
      return url.endsWith('tokens') ? json({ data: {} }, 201) : new Response(null, { status: 204 });
    });
    await registered();

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(calls(fetchMock)).toContain('POST /api/auth/logout');
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('does not wait on a hanging delete past the timeout', async () => {
    mockApi((url, init) => {
      if (init.method === 'DELETE') return new Promise<Response>(() => {});
      return json({ data: {} }, 201);
    });
    await registered();

    await act(async () => {
      await releasePushOnLogout(5);
    });

    expect(usePushStore.getState().state).toBeNull();
  });

  it('skips the delete when nothing was registered', async () => {
    const fetchMock = mockApi(() => new Response(null, { status: 204 }));

    await act(async () => {
      await useAuthStore.getState().logout();
    });

    expect(calls(fetchMock)).toEqual(['POST /api/auth/logout']);
  });

  it('discards a registration that finishes after logging out', async () => {
    let resolvePost: (response: Response) => void = () => {};
    const fetchMock = mockApi((url, init) => {
      if (init.method === 'POST' && url.endsWith('tokens')) return new Promise<Response>((resolve) => (resolvePost = resolve));
      return new Response(null, { status: 204 });
    });
    await registered();

    await act(async () => {
      await useAuthStore.getState().logout();
    });
    await act(async () => {
      resolvePost(json({ data: {} }, 201));
    });
    await flush();

    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens', 'POST /api/auth/logout']);
    expect(usePushStore.getState().state).toBeNull();
  });
});

describe('DevicePush', () => {
  it('enables push from settings when it is off', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(deniedOnce as never);
    const fetchMock = mockApi(() => json({ data: {} }, 201));

    await act(async () => {
      render(<DevicePush />);
    });
    await flush();
    expect(screen.getByText('Push notifications are off for this device.')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Enable push notifications' }));
    });
    await flush();

    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(calls(fetchMock)).toEqual(['POST /api/me/expo-push-tokens']);
    expect(screen.getByText('Push notifications are on for this device.')).toBeTruthy();
  });

  it('explains a dismissed prompt and a failed registration', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(deniedOnce as never);
    notifications.requestPermissionsAsync.mockResolvedValueOnce(deniedOnce as never);
    mockApi(() => json({ message: 'Server Error' }, 500));

    await act(async () => {
      render(<DevicePush />);
    });
    await flush();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Enable push notifications' }));
    });
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('You did not allow notifications, so push notifications are still off.');

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Enable push notifications' }));
    });
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not enable push notifications. Try again.');
  });

  it('points to the system settings when notifications are blocked', async () => {
    notifications.getPermissionsAsync.mockResolvedValue(deniedForGood as never);
    mockApi(() => json({}));

    await act(async () => {
      render(<DevicePush />);
    });
    await flush();

    expect(screen.getByText('Notifications are blocked for Sereno. Allow them in the system settings to enable push.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open system settings' })).toBeTruthy();
  });
});
