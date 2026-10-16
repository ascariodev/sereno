import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { useOrganizationStore } from '@/organization/store';
import { foregroundBehavior, openPushResponse, pushDestination, resetPushOpen, usePushOpen } from '@/push/open';
import { useAuthStore } from '@/session/auth';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
let mockNavigationKey: string | undefined = 'root';
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRootNavigationState: () => ({ key: mockNavigationKey }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-device', () => ({ deviceName: 'Pixel', modelName: 'Pixel 8' }));

const mockResponseListeners: ((response: unknown) => void)[] = [];
const mockRemove = jest.fn();
let mockHandler: { handleNotification: (notification: unknown) => Promise<unknown> } | undefined;
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn((handler: { handleNotification: (notification: unknown) => Promise<unknown> }) => {
    mockHandler = handler;
  }),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn((listener: (response: unknown) => void) => {
    mockResponseListeners.push(listener);
    return { remove: mockRemove };
  }),
}));

const notifications = Notifications as jest.Mocked<typeof Notifications>;
const push = router.push as jest.Mock;
const DEFAULT = 'expo.modules.notifications.actions.DEFAULT';
const organizations = [
  { id: 1, name: 'Acme', slug: 'acme' },
  { id: 2, name: 'Beta', slug: 'beta' },
];

const WEB = 'https://sereno.ascario.dev';
const taskUrl = `${WEB}/projects/7/plan?task=42&organization=2`;
const messageUrl = `${WEB}/channels/50?message=900&organization=1`;
const threadUrl = `${WEB}/channels/50?thread=77&organization=1`;

function response(data: unknown, identifier = 'n-1', actionIdentifier = DEFAULT) {
  return { actionIdentifier, notification: { request: { identifier, content: { data } } } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResponseListeners.length = 0;
  resetPushOpen();
  mockNavigationKey = 'root';
  jest.useFakeTimers();
  useAuthStore.setState({ token: 'token' });
  useOrganizationStore.setState({ organizations, activeId: 1, loaded: true, loadError: false });
});

describe('foreground behavior', () => {
  it('shows nothing from the system while the app is open', async () => {
    expect(foregroundBehavior).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    expect(await mockHandler!.handleNotification({})).toEqual(foregroundBehavior);
  });
});

describe('pushDestination', () => {
  it('maps the web urls to app routes', () => {
    expect(pushDestination({ url: taskUrl, organizationId: 2 })).toEqual({
      organizationId: 2,
      target: { pathname: '/task', params: { projectId: '7', id: '42' } },
    });
    expect(pushDestination({ url: messageUrl, organizationId: 1 })).toEqual({
      organizationId: 1,
      target: { pathname: '/channel', params: { id: '50' } },
    });
    expect(pushDestination({ url: threadUrl, organizationId: '1' })).toEqual({
      organizationId: 1,
      target: { pathname: '/thread', params: { channelId: '50', id: '77' } },
    });
  });

  it('rejects incomplete or foreign data', () => {
    expect(pushDestination(null)).toBeNull();
    expect(pushDestination('x')).toBeNull();
    expect(pushDestination({ url: taskUrl })).toBeNull();
    expect(pushDestination({ url: taskUrl, organizationId: 'abc' })).toBeNull();
    expect(pushDestination({ url: 5, organizationId: 1 })).toBeNull();
    expect(pushDestination({ url: `${WEB}/projects/7/plan?organization=2`, organizationId: 2 })).toBeNull();
    expect(pushDestination({ url: `${WEB}/settings?task=1`, organizationId: 2 })).toBeNull();
  });
});

describe('openPushResponse', () => {
  it('opens the screen in the active organization', async () => {
    await openPushResponse(response({ url: messageUrl, organizationId: 1 }));
    expect(push).toHaveBeenCalledWith({ pathname: '/channel', params: { id: '50' } });
    expect(notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('switches organization before opening a destination of another one', async () => {
    await openPushResponse(response({ url: taskUrl, organizationId: 2 }));
    expect(useOrganizationStore.getState().activeId).toBe(2);
    expect(push).toHaveBeenCalledWith({ pathname: '/task', params: { projectId: '7', id: '42' } });
  });

  it('does not navigate if the organization is not one of the person', async () => {
    await openPushResponse(response({ url: taskUrl, organizationId: 9 }));
    expect(useOrganizationStore.getState().activeId).toBe(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('retries loading the organizations when they failed before switching', async () => {
    const load = useOrganizationStore.getState().load;
    useOrganizationStore.setState({
      organizations: [],
      loaded: false,
      loadError: true,
      load: async () => {
        useOrganizationStore.setState({ organizations, loaded: true, loadError: false });
      },
    });
    await openPushResponse(response({ url: taskUrl, organizationId: 2 }));
    useOrganizationStore.setState({ load });
    expect(useOrganizationStore.getState().activeId).toBe(2);
    expect(push).toHaveBeenCalledWith({ pathname: '/task', params: { projectId: '7', id: '42' } });
  });

  it('does nothing without a session, without switching organization', async () => {
    useAuthStore.setState({ token: null });
    await openPushResponse(response({ url: taskUrl, organizationId: 2 }));
    expect(useOrganizationStore.getState().activeId).toBe(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('does not navigate if the session ends while switching organization', async () => {
    const select = useOrganizationStore.getState().select;
    useOrganizationStore.setState({
      select: async (id) => {
        await select(id);
        useAuthStore.setState({ token: null });
      },
    });
    await openPushResponse(response({ url: taskUrl, organizationId: 2 }));
    expect(push).not.toHaveBeenCalled();
    useOrganizationStore.setState({ select });
  });

  it('ignores actions other than the tap and data it does not understand', async () => {
    await openPushResponse(response({ url: taskUrl, organizationId: 2 }, 'a', 'reply'));
    await openPushResponse(response({ url: 'nope', organizationId: 1 }, 'b'));
    expect(push).not.toHaveBeenCalled();
  });

  it('handles the same notification once', async () => {
    await openPushResponse(response({ url: messageUrl, organizationId: 1 }));
    await openPushResponse(response({ url: messageUrl, organizationId: 1 }));
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('usePushOpen', () => {
  it('does not open anything until the root navigator has a key', async () => {
    mockNavigationKey = undefined;
    notifications.getLastNotificationResponse.mockReturnValue(response({ url: messageUrl, organizationId: 1 }));
    const { rerender } = await renderHook(({ ready }: { ready: boolean }) => usePushOpen(ready), { initialProps: { ready: true } });
    await act(async () => {
      jest.runAllTimers();
    });
    expect(push).not.toHaveBeenCalled();
    expect(notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();

    mockNavigationKey = 'root';
    await rerender({ ready: true });
    await act(async () => {
      jest.runAllTimers();
    });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('waits until the app is ready, then opens the notification that launched it', async () => {
    notifications.getLastNotificationResponse.mockReturnValue(response({ url: threadUrl, organizationId: 1 }));
    const { rerender } = await renderHook(({ ready }: { ready: boolean }) => usePushOpen(ready), { initialProps: { ready: false } });
    expect(notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    await rerender({ ready: true });
    expect(push).not.toHaveBeenCalled();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(push).toHaveBeenCalledWith({ pathname: '/thread', params: { channelId: '50', id: '77' } });
  });

  it('opens a tap received in the background and unsubscribes on unmount', async () => {
    notifications.getLastNotificationResponse.mockReturnValue(null);
    const { unmount } = await renderHook(() => usePushOpen(true));
    expect(mockResponseListeners).toHaveLength(1);

    mockResponseListeners[0]!(response({ url: messageUrl, organizationId: 1 }, 'bg'));
    await Promise.resolve();
    expect(push).toHaveBeenCalledWith({ pathname: '/channel', params: { id: '50' } });

    await unmount();
    expect(mockRemove).toHaveBeenCalled();
  });
});
