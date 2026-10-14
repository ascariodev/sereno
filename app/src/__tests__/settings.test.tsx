import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { api } from '@/api/client';
import { i18n } from '@/i18n';
import Settings from '@/app/(tabs)/settings';
import { useOrganizationStore } from '@/organization/store';
import { useAuthStore } from '@/session/auth';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const acme = { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] };

const allOn = () => ({
  email: { task_assigned: true, task_comment_mention: true, task_commented: true, chat_mention: true },
  push: { task_assigned: true, task_comment_mention: true, task_commented: true, chat_mention: true },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockApi(handler: Handler) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => handler(url, init));
  globalThis.fetch = fn as never;
  return fn;
}

const switchFor = (type: string, channel: string) => screen.getByLabelText(`${type}: ${channel}`);

beforeEach(async () => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useOrganizationStore.setState({ organizations: [acme], activeId: 7, loaded: true });
  useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@x.test', locale: 'en' } as never });
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('Settings', () => {
  it('loads preferences and saves a change optimistically', async () => {
    const prefs = allOn();
    const fn = mockApi((url, init) => {
      if (init?.method === 'PATCH') {
        prefs.email.task_assigned = false;
        return json({ data: prefs });
      }
      return json({ data: prefs });
    });
    await act(async () => {
      render(<Settings />);
    });
    expect(switchFor('A task is assigned to me', 'Email').props.value).toBe(true);
    await act(async () => {
      await fireEvent(switchFor('A task is assigned to me', 'Email'), 'valueChange', false);
    });
    const patch = fn.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch?.[0]).toContain('/api/me/notification-preferences');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ email: { task_assigned: false } });
    expect(switchFor('A task is assigned to me', 'Email').props.value).toBe(false);
  });

  it('reverts and shows an error when the save fails', async () => {
    mockApi((url, init) => (init?.method === 'PATCH' ? json({ message: 'x' }, 500) : json({ data: allOn() })));
    await act(async () => {
      render(<Settings />);
    });
    await act(async () => {
      await fireEvent(switchFor('I am mentioned in the chat', 'Push'), 'valueChange', false);
    });
    expect(switchFor('I am mentioned in the chat', 'Push').props.value).toBe(true);
    expect(screen.getByText(/Could not save the change for "I am mentioned in the chat" \(Push\)/)).toBeTruthy();
  });

  it('retries after a failed load', async () => {
    let calls = 0;
    mockApi(() => (++calls === 1 ? json({ message: 'x' }, 500) : json({ data: allOn() })));
    await act(async () => {
      render(<Settings />);
    });
    expect(screen.getByText('Could not load your preferences.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Retry'));
    });
    expect(switchFor('A task is assigned to me', 'Push').props.value).toBe(true);
  });

  it('changes the language through PATCH /api/me/locale', async () => {
    const fn = mockApi((url, init) =>
      init?.method === 'PATCH'
        ? json({ data: { id: 1, name: 'Ana', email: 'a@x.test', locale: 'es' } })
        : json({ data: allOn() }),
    );
    await act(async () => {
      render(<Settings />);
    });
    await act(async () => {
      await fireEvent.press(screen.getByText('Español'));
    });
    const patch = fn.mock.calls.find(([url]) => String(url).endsWith('/api/me/locale'));
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ locale: 'es' });
    expect(i18n.language).toBe('es');
    expect(screen.getByText('Ajustes')).toBeTruthy();
  });

  it('warns when the language could not be saved', async () => {
    mockApi((url, init) => (init?.method === 'PATCH' ? json({ message: 'x' }, 500) : json({ data: allOn() })));
    await act(async () => {
      render(<Settings />);
    });
    await act(async () => {
      await fireEvent.press(screen.getByText('Español'));
    });
    expect(screen.getByText(/applied on this device only|Se aplicó solo en este dispositivo/)).toBeTruthy();
  });
});
