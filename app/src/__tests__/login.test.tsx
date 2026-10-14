import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import Login from '@/app/login';
import { setChosenLocale, setLocale } from '@/i18n';
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
jest.mock('expo-device', () => ({ deviceName: 'Pixel', modelName: 'Pixel 8' }));

const user = { id: 1, name: 'Ana', email: 'ana@example.com', locale: null };
const secureData = (jest.requireMock('expo-secure-store') as { __data: Map<string, string> }).__data;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: () => Response | Promise<Response>) {
  const fn = jest.fn(async () => handler());
  globalThis.fetch = fn as never;
  return fn;
}


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

describe('login screen', () => {
  it('shows the field error of a 422 under the field', async () => {
    mockFetch(() => json({ message: 'x', errors: { email: ['These credentials do not match our records.'] } }, 422));
    await render(<Login />);

    await fillAndSubmit();

    expect(await screen.findByText('These credentials do not match our records.')).toBeOnTheScreen();
    expect(screen.queryByTestId('login-error')).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('shows the general error when a 422 has no visible field', async () => {
    mockFetch(() => json({ message: 'x', errors: { device_name: ['bad'] } }, 422));
    await render(<Login />);

    await fillAndSubmit();

    expect(await screen.findByText('Could not sign in. Try again.')).toBeOnTheScreen();
  });

  it('shows the network error', async () => {
    mockFetch(() => Promise.reject(new TypeError('Network request failed')));
    await render(<Login />);

    await fillAndSubmit();

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('shows the throttle error on 429', async () => {
    mockFetch(() => json({ message: 'slow' }, 429));
    await render(<Login />);

    await fillAndSubmit();

    expect(await screen.findByText('Too many attempts. Try again in a minute.')).toBeOnTheScreen();
  });

  it('disables the button while the request is pending and ignores a second press', async () => {
    let release!: (response: Response) => void;
    const fetchMock = mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    await render(<Login />);

    await fillAndSubmit();
    expect(await screen.findByText('Signing in...')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Signing in...' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => release(json({ message: 'no' }, 500)));
    expect(await screen.findByText('Could not sign in. Try again.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  });

  it('survives an unmount with the request pending', async () => {
    let release!: (response: Response) => void;
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const view = await render(<Login />);
    await fillAndSubmit();

    await view.unmount();
    await act(async () => release(json({ token: 'tk', user })));

    await waitFor(() => expect(useAuthStore.getState().token).toBe('tk'));
  });
});

