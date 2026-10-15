import { act, fireEvent } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

import { api } from '@/api/client';
import RootLayout from '@/app/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import Notifications from '@/app/(tabs)/notifications';
import Projects from '@/app/(tabs)/index';
import Settings from '@/app/(tabs)/settings';
import Login from '@/app/login';
import Register from '@/app/register';
import SelectOrganization from '@/app/select-organization';
import { setChosenLocale, setLocale } from '@/i18n';
import { useOrganizationStore } from '@/organization/store';
import { installAuthOnApi, useAuthStore } from '@/session/auth';

jest.mock('expo-secure-store', () => {
  const data = new Map<string, string>();
  return {
    __data: data,
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void data.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void data.delete(key)),
  };
});
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-device', () => ({ deviceName: 'Pixel', modelName: 'Pixel 8' }));

const user = { id: 1, name: 'Ana', email: 'ana@example.com', locale: null };
const secureData = (jest.requireMock('expo-secure-store') as { __data: Map<string, string> }).__data;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const organizations = [
  { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] },
  { id: 8, name: 'Beta', slug: 'beta', roles: ['member'] },
];

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: string) => handler(url));
  globalThis.fetch = fn as never;
  return fn;
}

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(async () => {
  secureData.clear();
  mockFetch(() => json({}));
  api.setTokenProvider(null);
  api.setUnauthorizedHandler(null);
  await useAuthStore.getState().clearSession();
  useAuthStore.setState({ hydrated: false });
  setChosenLocale(null);
  setLocale(null);
  installAuthOnApi();
});

async function fillAndSubmit() {
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ana@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'secret');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

describe('route protection', () => {
  const routes = { _layout: RootLayout, '(tabs)/_layout': TabsLayout, '(tabs)/index': Projects, '(tabs)/notifications': Notifications, '(tabs)/settings': Settings, login: Login, register: Register, 'select-organization': SelectOrganization };

  it('redirects to the login without a session', async () => {
    await renderRouter(routes, { initialUrl: '/' });
    await settle();

    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });

  it('keeps the home screen when a token and a valid organization were stored', async () => {
    secureData.set('sereno.token', 'saved');
    secureData.set('sereno.organization', '8');
    mockFetch(home(organizations));
    await renderRouter(routes, { initialUrl: '/' });
    await settle();

    expect(useAuthStore.getState().user).toEqual(user);
    expect(screen.getByRole('header', { name: 'Hello, Ana' })).toBeOnTheScreen();
    await openSettings();
    expect(screen.getByText('Beta')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();
  });

  it('activates the first organization when none is remembered and lets the user switch', async () => {
    secureData.set('sereno.token', 'saved');
    mockFetch(home(organizations));
    await renderRouter(routes, { initialUrl: '/' });
    await settle();

    await openSettings();
    expect(screen.getByText('Acme')).toBeOnTheScreen();
    expect(secureData.get('sereno.organization')).toBe('7');

    await fireEvent.press(screen.getByRole('button', { name: 'Change organization' }));
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Beta' }));
    await settle();

    await openSettings();
    expect(screen.getByText('Beta')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Change organization' })).toBeOnTheScreen();
    expect(secureData.get('sereno.organization')).toBe('8');
  });

  it('shows the organization selector when the user has no organizations', async () => {
    secureData.set('sereno.token', 'saved');
    mockFetch((url) => (url.endsWith('/api/organizations') ? json({ data: [] }) : home([])(url)));
    await renderRouter(routes, { initialUrl: '/' });
    await settle();

    expect(screen.getByText('Choose an organization')).toBeOnTheScreen();
    expect(screen.getByText('You do not belong to any organization yet.')).toBeOnTheScreen();
  });

  it('goes from the login to the register screen and back', async () => {
    mockFetch(() => json({ enabled: true }));
    await renderRouter(routes, { initialUrl: '/login' });
    await settle();

    await fireEvent.press(screen.getByRole('link', { name: 'Create an account' }));
    await settle();
    expect(screen.getByLabelText('Confirm password')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('link', { name: 'Already have an account? Sign in' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  });

  it('a successful login goes home and logout comes back to the login', async () => {
    mockFetch((url) => (url.endsWith('/api/auth/login') ? json({ token: 'tk', user }) : home([organizations[0]])(url)));
    secureData.set('sereno.organization', '7');
    await renderRouter(routes, { initialUrl: '/login' });
    await settle();
    await settle();

    await fillAndSubmit();
    await settle();
    await openSettings();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen();

    mockFetch(() => json({}));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await settle();
    expect(useOrganizationStore.getState().activeId).toBeNull();
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });
});

function home(list: unknown[]) {
  return (url: string) => {
    if (url.endsWith('/api/organizations')) return json({ data: list });
    if (url.endsWith('/api/me')) return json({ data: user });
    if (url.includes('/api/projects')) return json({ data: [], meta: { last_page: 1 } });
    if (url.includes('/api/channels')) return json({ data: [], meta: { next_cursor: null } });
    return json({});
  };
}

async function openSettings() {
  await fireEvent.press(screen.getByText('Settings'));
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
  }
}
