import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import Register from '@/app/register';
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
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));

const user = { id: 1, name: 'Ana', email: 'ana@example.com', locale: null };
const secureData = (jest.requireMock('expo-secure-store') as { __data: Map<string, string> }).__data;
const routerMock = (jest.requireMock('expo-router') as { router: { replace: jest.Mock } }).router;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(registerHandler: () => Response | Promise<Response>, registration: Handler = () => json({ enabled: true })) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/auth/registration')) return registration(url, init);
    if (url.endsWith('/api/auth/register')) return registerHandler();
    throw new Error(`unexpected request ${url}`);
  });
  globalThis.fetch = fn as never;
  return fn;
}

beforeEach(async () => {
  secureData.clear();
  routerMock.replace.mockClear();
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
  await fireEvent.changeText(await screen.findByLabelText('Name'), 'Ana');
  await fireEvent.changeText(screen.getByLabelText('Email'), 'ana@example.com');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'secret-pass');
  await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'secret-pass');
  await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
}

describe('register screen', () => {
  it('sends the data, stores the session and the token', async () => {
    const fetchMock = mockFetch(() => json({ token: 'tk', user }, 201));
    await render(<Register />);

    await fillAndSubmit();

    await waitFor(() => expect(useAuthStore.getState().token).toBe('tk'));
    expect(secureData.get('sereno.token')).toBe('tk');
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/auth/register'));
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      password: 'secret-pass',
      password_confirmation: 'secret-pass',
      device_name: 'Pixel',
    });
  });

  it('shows validation errors under the fields and clears the passwords', async () => {
    mockFetch(() =>
      json(
        { message: 'x', errors: { email: ['The email has already been taken.'], password: ['The password is too short.'] } },
        422,
      ),
    );
    await render(<Register />);

    await fillAndSubmit();

    expect(await screen.findByText('The email has already been taken.')).toBeOnTheScreen();
    expect(screen.getByText('The password is too short.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Password').props.value).toBe('');
    expect(screen.getByLabelText('Confirm password').props.value).toBe('');
    expect(screen.getByLabelText('Name').props.value).toBe('Ana');
    expect(screen.queryByTestId('register-error')).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('shows the general error when a 422 has no visible field', async () => {
    mockFetch(() => json({ message: 'x', errors: { password_confirmation: ['bad'] } }, 422));
    await render(<Register />);

    await fillAndSubmit();

    expect(await screen.findByText('Could not create the account. Try again.')).toBeOnTheScreen();
  });

  it.each([
    [403, 'Registration is closed, ask for an invitation.'],
    [429, 'Too many attempts. Try again in a minute.'],
    [500, 'Could not create the account. Try again.'],
  ])('maps status %i to its message', async (status, message) => {
    mockFetch(() => json({ message: 'x' }, status));
    await render(<Register />);

    await fillAndSubmit();

    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it('shows the network error', async () => {
    mockFetch(() => Promise.reject(new TypeError('Network request failed')));
    await render(<Register />);

    await fillAndSubmit();

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('disables the button while pending and ignores a second press', async () => {
    let release!: (response: Response) => void;
    const fetchMock = mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    await render(<Register />);

    await fillAndSubmit();
    expect(await screen.findByText('Creating account...')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Creating account...' }));
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/auth/register'))).toHaveLength(1);

    await act(async () => release(json({ message: 'no' }, 500)));
    expect(await screen.findByText('Could not create the account. Try again.')).toBeOnTheScreen();
  });

  it('survives an unmount with the request pending', async () => {
    let release!: (response: Response) => void;
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const view = await render(<Register />);
    await fillAndSubmit();

    await view.unmount();
    await act(async () => release(json({ token: 'tk', user }, 201)));

    await waitFor(() => expect(useAuthStore.getState().token).toBe('tk'));
  });

  it('shows the closed message without a form when registration is closed', async () => {
    mockFetch(() => json({}), () => json({ enabled: false }));
    await render(<Register />);

    expect(await screen.findByText('Registration is closed, ask for an invitation.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Name')).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'Go to sign in' }));
    expect(routerMock.replace).toHaveBeenCalledWith('/login');
  });

  it('offers a retry when the status check fails', async () => {
    let calls = 0;
    mockFetch(() => json({}), () => (++calls === 1 ? json({ message: 'x' }, 500) : json({ enabled: true })));
    await render(<Register />);

    expect(await screen.findByText(/couldn't check whether registration is open/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText('Name')).toBeOnTheScreen();
  });

  it('survives an unmount with the status check pending', async () => {
    let release!: (response: Response) => void;
    mockFetch(() => json({}), () => new Promise<Response>((resolve) => (release = resolve)));
    const view = await render(<Register />);
    expect(screen.getByText('Loading...')).toBeOnTheScreen();

    await view.unmount();
    await act(async () => release(json({ enabled: true })));
  });
});
