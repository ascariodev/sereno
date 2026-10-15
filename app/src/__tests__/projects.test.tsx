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

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ])('shows the project members entry for %s: %s', async (role, visible) => {
    useOrganizationStore.setState({ organizations: [{ ...acme, roles: [role] }], activeId: 7, loaded: true });
    mockApi([project(1)]);
    await render(<Projects />);

    expect(await screen.findByText('Project 1')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Members Project 1') !== null).toBe(visible);
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

describe('projects store during a load in flight', () => {
  function deferredApi(projects: unknown[]) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({ data: project(1, { name: 'Renamed' }) });
      if (init?.method === 'POST') return json({});
      await gate;
      if (url.includes('/api/projects')) return json({ data: projects, meta: { last_page: 1 } });
      return json({ data: [{ id: 50, project_id: 1 }, { id: 51, project_id: 2 }], meta: { next_cursor: null } });
    }) as never;
    return () => release();
  }

  beforeEach(async () => {
    mockApi([project(1), project(2)]);
    await useProjectsStore.getState().load();
  });

  it('keeps an update saved while an older load was in flight', async () => {
    const release = deferredApi([project(1), project(2)]);
    const loading = useProjectsStore.getState().load(true);
    await useProjectsStore.getState().update(1, { name: 'Renamed' });
    release();
    await loading;

    expect(useProjectsStore.getState().projects.map((p) => p.name)).toEqual(['Renamed', 'Project 2']);
  });

  it('keeps a project archived while an older load was in flight', async () => {
    const release = deferredApi([project(1), project(2)]);
    const loading = useProjectsStore.getState().load(true);
    await useProjectsStore.getState().archive(2);
    release();
    await loading;

    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual([1]);
    expect(useProjectsStore.getState().channelByProject).toEqual({ 1: 50 });
  });

  it('does not apply an old change to a later load', async () => {
    let release = deferredApi([project(1), project(2)]);
    const loading = useProjectsStore.getState().load(true);
    await useProjectsStore.getState().archive(2);
    release();
    await loading;

    release = deferredApi([project(1), project(2)]);
    const later = useProjectsStore.getState().load(true);
    release();
    await later;

    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual([1, 2]);
  });
});
