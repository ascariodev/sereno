import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { api } from '@/api/client';
import Projects from '@/app/(tabs)/index';
import ProjectForm from '@/app/project-form';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(() => ({})),
}));

function org(roles: string[]) {
  return { id: 7, name: 'Acme', slug: 'acme', roles };
}

function project(id: number, extra: Record<string, unknown> = {}) {
  return { id, name: `Project ${id}`, key: `P${id}`, description: null, archived_at: null, ...extra };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let calls: { method: string; url: string; body: unknown }[];

function mockApi(handler: (method: string, url: string) => Response | null = () => null) {
  calls = [];
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = handler(method, url);
    if (custom) return custom;
    if (url.includes('/api/channels')) return json({ data: [], meta: { next_cursor: null } });
    if (url.includes('/api/projects')) return json({ data: [project(1)], meta: { last_page: 1 } });
    return json({});
  }) as never;
}

function asRole(roles: string[]) {
  useOrganizationStore.setState({ organizations: [org(roles)], activeId: 7, loaded: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useOrganizationStore.getState().clear();
  useProjectsStore.getState().clear();
  mockApi();
});

describe('role gating', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ])('%s sees the create and edit buttons: %s', async (role, allowed) => {
    asRole([role]);
    await render(<Projects />);
    await screen.findByText('Project 1');

    expect(screen.queryByText('New project') !== null).toBe(allowed);
    expect(screen.queryByText('Edit') !== null).toBe(allowed);
  });

  it('shows the forbidden message to a member opening the form', async () => {
    asRole(['member']);
    await render(<ProjectForm />);

    expect(screen.getByText('You do not have permission to manage projects.')).toBeOnTheScreen();
    expect(screen.queryByText('Create project')).toBeNull();
  });
});

describe('create', () => {
  beforeEach(() => asRole(['admin']));

  it('suggests the key from the name, validates and creates the project', async () => {
    await render(<ProjectForm />);

    await fireEvent.press(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByText('Enter a name.')).toBeOnTheScreen();
    expect(screen.getByText(/The key must start with a letter/)).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Name'), 'Mi Proyecto');
    expect(screen.getByLabelText('Key').props.value).toBe('MIPROYECTO');

    await fireEvent.press(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.url).toContain('/api/projects');
    expect(post?.body).toEqual({ name: 'Mi Proyecto', key: 'MIPROYECTO', description: null });
  });

  it('shows the server field errors on 422', async () => {
    mockApi((method) =>
      method === 'POST' ? json({ message: 'invalid', errors: { key: ['The key is taken.'] } }, 422) : null,
    );
    await render(<ProjectForm />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Alpha');
    await fireEvent.press(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('The key is taken.')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('shows the forbidden message on 403', async () => {
    mockApi((method) => (method === 'POST' ? json({ message: 'no' }, 403) : null));
    await render(<ProjectForm />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Alpha');
    await fireEvent.press(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('You do not have permission to manage projects.')).toBeOnTheScreen();
  });
});

describe('edit and archive', () => {
  beforeEach(async () => {
    asRole(['owner']);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '1' });
    await useProjectsStore.getState().load();
  });

  it('prefills the project and saves the changes', async () => {
    await render(<ProjectForm />);
    expect(screen.getByLabelText('Name').props.value).toBe('Project 1');

    await fireEvent.changeText(screen.getByLabelText('Name'), 'Renamed');
    mockApi((method, url) =>
      method === 'PATCH' ? json({ data: project(1, { name: 'Renamed' }) }) : null,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.url).toContain('/api/projects/1');
    expect(patch?.body).toEqual({ name: 'Renamed', key: 'P1', description: null });
    expect(useProjectsStore.getState().projects[0].name).toBe('Renamed');
  });

  it('archives after confirmation and removes the project from the list', async () => {
    await render(<ProjectForm />);
    await fireEvent.press(screen.getByRole('button', { name: 'Archive project' }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    mockApi((method) => (method === 'POST' ? json({ data: project(1, { archived_at: '2026-01-01T00:00:00Z' }) }) : null));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, archive' }));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'POST')?.url).toContain('/api/projects/1/archive');
    expect(useProjectsStore.getState().projects).toEqual([]);
  });
});
