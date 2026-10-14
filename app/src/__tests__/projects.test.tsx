import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { api } from '@/api/client';
import Projects from '@/app/(tabs)/index';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import { useAuthStore } from '@/session/auth';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const acme = { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] };
const beta = { id: 8, name: 'Beta', slug: 'beta', roles: ['member'] };

function project(id: number, extra: Record<string, unknown> = {}) {
  return { id, name: `Project ${id}`, key: `P${id}`, description: null, archived_at: null, ...extra };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockApi(projects: unknown[], status = 200) {
  const fn = jest.fn(async (url: string) => {
    if (status !== 200) return json({}, status);
    if (url.includes('/api/projects')) return json({ data: projects, meta: { last_page: 1 } });
    if (url.includes('/api/channels')) return json({ data: [{ id: 50, project_id: 1 }], meta: { next_cursor: null } });
    return json({});
  });
  globalThis.fetch = fn as never;
  return fn;
}

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useOrganizationStore.getState().clear();
  useProjectsStore.getState().clear();
  useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
  mockApi([]);
  useOrganizationStore.setState({ organizations: [acme, beta], activeId: 7, loaded: true });
  useProjectsStore.getState().clear();
});

describe('Projects tab', () => {
  it('shows the loading state first', async () => {
    globalThis.fetch = jest.fn(() => new Promise(() => undefined)) as never;
    await render(<Projects />);

    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  });

  it('shows the empty state', async () => {
    mockApi([]);
    await render(<Projects />);

    expect(await screen.findByText('No projects yet.')).toBeOnTheScreen();
    expect(screen.getByText('Hello, Ana')).toBeOnTheScreen();
  });

  it('lists the projects with their health and hides the archived ones', async () => {
    mockApi([
      project(1, { description: 'Main API', open_groups_count: 3, open_max_level: 'error' }),
      project(2, { open_groups_count: 0 }),
      project(3, { archived_at: '2026-01-01T00:00:00Z' }),
    ]);
    await render(<Projects />);

    expect(await screen.findByText('Project 1')).toBeOnTheScreen();
    expect(screen.getByText('Main API')).toBeOnTheScreen();
    expect(screen.getByText('3 open · error')).toBeOnTheScreen();
    expect(screen.getByText('All calm')).toBeOnTheScreen();
    expect(screen.queryByText('Project 3')).toBeNull();
    expect(useProjectsStore.getState().channelByProject).toEqual({ 1: 50 });
  });

  it('shows a retry when the load fails and loads again', async () => {
    mockApi([], 500);
    await render(<Projects />);
    expect(await screen.findByText('Could not load the projects.')).toBeOnTheScreen();

    mockApi([project(1)]);
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Project 1')).toBeOnTheScreen();
  });

  it('reloads the projects when the active organization changes', async () => {
    mockApi([project(1)]);
    await render(<Projects />);
    await screen.findByText('Project 1');

    mockApi([project(2)]);
    await act(async () => {
      await useOrganizationStore.getState().select(8);
    });

    expect(await screen.findByText('Project 2')).toBeOnTheScreen();
    expect(screen.queryByText('Project 1')).toBeNull();
  });
});
