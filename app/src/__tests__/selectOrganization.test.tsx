import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import SelectOrganization from '@/app/select-organization';
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
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), dismissTo: jest.fn() } }));
jest.mock('expo-device', () => ({ deviceName: 'Pixel', modelName: 'Pixel 8' }));

const secureData = (jest.requireMock('expo-secure-store') as { __data: Map<string, string> }).__data;
const routerMock = (jest.requireMock('expo-router') as { router: { dismissTo: jest.Mock } }).router;
const acme = { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] };
const beta = { id: 8, name: 'Beta', slug: 'beta', roles: ['member'] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => handler(url, init));
  globalThis.fetch = fn as never;
  return fn;
}

beforeEach(async () => {
  secureData.clear();
  routerMock.dismissTo.mockClear();
  api.setTokenProvider(null);
  api.setUnauthorizedHandler(null);
  await useAuthStore.getState().clearSession();
  installAuthOnApi();
  useOrganizationStore.getState().clear();
  mockFetch(() => json({ data: [] }));
});

async function loadWith(organizations: unknown[]) {
  mockFetch(() => json({ data: organizations }));
  await act(async () => {
    await useOrganizationStore.getState().load();
  });
}

describe('SelectOrganization', () => {
  it('shows the loading state until the list arrives', async () => {
    await render(<SelectOrganization />);

    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  });

  it('shows a retry when the load failed and loads again', async () => {
    mockFetch(() => json({}, 500));
    await act(async () => {
      await useOrganizationStore.getState().load();
    });
    await render(<SelectOrganization />);
    expect(screen.getByText('Could not load your organizations.')).toBeOnTheScreen();

    mockFetch(() => json({ data: [acme] }));
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Acme' })).toBeOnTheScreen();
  });

  it('lists the organizations and activates the chosen one', async () => {
    await loadWith([acme, beta]);
    await render(<SelectOrganization />);

    await fireEvent.press(screen.getByRole('button', { name: 'Beta' }));

    await waitFor(() => expect(useOrganizationStore.getState().activeId).toBe(8));
    expect(secureData.get('sereno.organization')).toBe('8');
    expect(routerMock.dismissTo).toHaveBeenCalledWith('/');
  });

  it('still switches and goes home when saving the choice fails', async () => {
    await loadWith([acme, beta]);
    await render(<SelectOrganization />);
    const setItem = jest.requireMock('expo-secure-store').setItemAsync as jest.Mock;
    setItem.mockRejectedValueOnce(new Error('disk'));

    await fireEvent.press(screen.getByRole('button', { name: 'Beta' }));

    await waitFor(() => expect(routerMock.dismissTo).toHaveBeenCalledWith('/'));
    expect(useOrganizationStore.getState().activeId).toBe(8);
  });

  it('explains there are none and still offers to create one', async () => {
    await loadWith([]);
    await render(<SelectOrganization />);

    expect(screen.getByText('You do not belong to any organization yet.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Organization name')).toBeOnTheScreen();
  });

  it('validates the name before sending', async () => {
    await loadWith([]);
    await render(<SelectOrganization />);
    const fetchMock = mockFetch(() => json({}));

    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByText('Enter a name.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Organization name'), '😀'.repeat(256));
    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByText('The name cannot exceed 255 characters.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Organization name'), '😀'.repeat(255));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates an organization and activates it', async () => {
    await loadWith([acme]);
    await render(<SelectOrganization />);
    const created = { id: 9, name: 'Gamma', slug: 'gamma', roles: ['owner'] };
    mockFetch((url, init) => (init?.method === 'POST' ? json({ data: created }, 201) : json({ data: [acme, created] })));

    await fireEvent.changeText(screen.getByLabelText('Organization name'), '  Gamma ');
    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => expect(useOrganizationStore.getState().activeId).toBe(9));
    expect(routerMock.dismissTo).toHaveBeenCalledWith('/');
  });

  it.each([
    [422, { message: 'x', errors: { name: ['The name is taken.'] } }, 'The name is taken.'],
    [429, {}, 'Too many attempts. Try again in a minute.'],
    [500, {}, 'Could not create the organization. Try again.'],
  ])('shows the error for a %i response', async (status, body, message) => {
    await loadWith([]);
    await render(<SelectOrganization />);
    mockFetch(() => json(body, status));

    await fireEvent.changeText(screen.getByLabelText('Organization name'), 'Gamma');
    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });

  it('shows a network error', async () => {
    await loadWith([]);
    await render(<SelectOrganization />);
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('offline');
    }) as never;

    await fireEvent.changeText(screen.getByLabelText('Organization name'), 'Gamma');
    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('sends a single request on a double press', async () => {
    await loadWith([]);
    await render(<SelectOrganization />);
    const fn = mockFetch(() => new Promise<Response>(() => {}));

    await fireEvent.changeText(screen.getByLabelText('Organization name'), 'Gamma');
    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Creating...' }));

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not fail when unmounted with the request pending', async () => {
    await loadWith([]);
    const view = await render(<SelectOrganization />);
    let release: (response: Response) => void = () => {};
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    await fireEvent.changeText(screen.getByLabelText('Organization name'), 'Gamma');
    await fireEvent.press(screen.getByRole('button', { name: 'Create organization' }));

    await view.unmount();
    await act(async () => {
      release(json({ message: 'x' }, 500));
    });
  });
});
