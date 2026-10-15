import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import '@/i18n';

import { api } from '@/api/client';
import Integrations from '@/app/integrations';
import { useIntegrationsStore } from '@/integrations/store';
import { useOrganizationStore } from '@/organization/store';
import { useProjectsStore } from '@/projects/store';
import {
  disconnectRealtime,
  setRealtimeClientFactory,
  type RealtimeClient,
  type RealtimePayload,
} from '@/realtime/echo';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

let mockParams: Record<string, string> = { projectId: '3', name: 'Acme API' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const FAKE_KEY = 'srn_fake_issued_key_0001';
const NEW_KEY = 'srn_fake_rotated_key_0002';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function source(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    project_id: 3,
    name: `Source ${id}`,
    key_prefix: `srn_${id}abc`,
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function setProject(archived: string | null = null) {
  useProjectsStore.setState({
    projects: [{ id: 3, name: 'Acme API', key: 'ACME', description: null, archived_at: archived }],
    channelByProject: {},
    loaded: true,
  });
}

function setRoles(roles: string[]) {
  useOrganizationStore.setState({ organizations: [{ id: 7, name: 'Org', slug: 'org', roles }], activeId: 7, loaded: true });
}

beforeEach(() => {
  api.setTokenProvider(null);
  mockParams = { projectId: '3', name: 'Acme API' };
  setRoles(['admin']);
  useProjectsStore.getState().clear();
  useIntegrationsStore.getState().clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  disconnectRealtime();
  setRealtimeClientFactory(null);
  jest.restoreAllMocks();
});

function fakeClient() {
  const listeners = new Map<string, Map<string, (data: RealtimePayload) => void>>();
  const client: RealtimeClient = {
    private: (name) => {
      const channel = new Map<string, (data: RealtimePayload) => void>();
      listeners.set(name, channel);
      const handle = {
        listen: (event: string, callback: (data: RealtimePayload) => void) => {
          channel.set(event, callback);
          return handle;
        },
        error: () => handle,
      };
      return handle;
    },
    leave: (name) => void listeners.delete(name),
    disconnect: () => undefined,
    resume: () => undefined,
    connectionStatus: () => 'connected',
    onConnectionChange: () => () => undefined,
  };
  return { client, emit: (name: string, event: string, data: RealtimePayload) => listeners.get(name)?.get(event)?.(data) };
}

function pressConfirm(index: number) {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { onPress?: () => void }[];
  buttons[index].onPress?.();
}

function isWrite(init?: RequestInit) {
  return init?.method === 'POST' || init?.method === 'DELETE';
}

async function renderScreen() {
  await act(async () => {
    render(<Integrations />);
  });
}

describe('Integrations', () => {
  it('lists the sources of the project', async () => {
    setProject();
    globalThis.fetch = jest.fn(async () => json({ data: [source(1), source(2, { revoked_at: '2026-02-01T00:00:00Z' })] })) as never;
    await renderScreen();
    expect(await screen.findByText('Source 1')).toBeTruthy();
    expect(screen.getByLabelText('Rotate key Source 1')).toBeTruthy();
    expect(screen.queryByLabelText('Rotate key Source 2')).toBeNull();
  });

  it('blocks members and never requests the sources', async () => {
    setProject();
    setRoles(['member']);
    const fn = jest.fn(async () => json({ data: [] }));
    globalThis.fetch = fn as never;
    await renderScreen();
    expect(screen.getByText('Only owners and admins can manage integrations.')).toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });

  it('shows not found when the project is not in the list', async () => {
    useProjectsStore.setState({ projects: [], channelByProject: {}, loaded: true });
    globalThis.fetch = jest.fn(async () => json({ data: [] })) as never;
    await renderScreen();
    expect(screen.getByText('This project does not exist or you cannot access it.')).toBeTruthy();
  });

  it('hides create, rotate and revoke in an archived project', async () => {
    setProject('2026-03-01T00:00:00Z');
    globalThis.fetch = jest.fn(async () => json({ data: [source(1)] })) as never;
    await renderScreen();
    expect(await screen.findByText('Source 1')).toBeTruthy();
    expect(screen.queryByText('Create log source')).toBeNull();
    expect(screen.queryByLabelText('Rotate key Source 1')).toBeNull();
    expect(screen.queryByLabelText('Revoke Source 1')).toBeNull();
  });

  it('creates a source, shows the key once and drops it when dismissed', async () => {
    setProject();
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ data: { ...source(5, { name: 'Prod' }), key: FAKE_KEY } }, 201);
      return json({ data: [] });
    });
    globalThis.fetch = fn as never;
    await renderScreen();
    await screen.findByText('This project has no log sources yet.');
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Prod  ');
    await act(async () => {
      await fireEvent.press(screen.getByText('Create log source'));
    });
    expect((await screen.findByTestId('issued-key')).props.children).toBe(FAKE_KEY);
    expect(screen.getByText('Waiting for the first event...')).toBeTruthy();
    const post = fn.mock.calls.find(([, init]) => isWrite(init));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'Prod' });
    expect(JSON.stringify(useIntegrationsStore.getState().sources)).not.toContain(FAKE_KEY);

    await fireEvent.press(screen.getByText('Done'));
    expect(screen.queryByTestId('issued-key')).toBeNull();
    expect(JSON.stringify(useIntegrationsStore.getState())).not.toContain(FAKE_KEY);
  });

  it('validates the name before calling the API', async () => {
    setProject();
    const fn = jest.fn(async () => json({ data: [] }));
    globalThis.fetch = fn as never;
    await renderScreen();
    await screen.findByText('This project has no log sources yet.');
    await act(async () => {
      await fireEvent.press(screen.getByText('Create log source'));
    });
    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rotates after confirming and shows the new key', async () => {
    setProject();
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ data: { ...source(1, { key_prefix: 'srn_new' }), key: NEW_KEY } });
      return json({ data: [source(1)] });
    }) as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await fireEvent.press(screen.getByLabelText('Rotate key Source 1'));
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[1]).toContain('stops working immediately');
    await act(async () => {
      pressConfirm(1);
    });
    expect((await screen.findByTestId('issued-key')).props.children).toBe(NEW_KEY);
    expect(screen.getByText('srn_new…')).toBeTruthy();
  });

  it('reloads the list when the rotation conflicts', async () => {
    setProject();
    let loads = 0;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ message: 'Conflict' }, 409);
      loads++;
      return json({ data: [source(1, loads > 1 ? { revoked_at: '2026-02-01T00:00:00Z' } : {})] });
    }) as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await fireEvent.press(screen.getByLabelText('Rotate key Source 1'));
    await act(async () => {
      pressConfirm(1);
    });
    expect(await screen.findByText(/The key was not rotated: it was changed or revoked/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Rotate key Source 1')).toBeNull());
    expect(screen.queryByTestId('issued-key')).toBeNull();
  });

  it('revokes after confirming and does not touch the API when cancelled', async () => {
    setProject();
    const fn = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ data: source(1, { revoked_at: '2026-02-01T00:00:00Z' }) });
      return json({ data: [source(1)] });
    });
    globalThis.fetch = fn as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await fireEvent.press(screen.getByLabelText('Revoke Source 1'));
    await act(async () => {
      pressConfirm(0);
    });
    expect(fn.mock.calls.some(([, init]) => isWrite(init))).toBe(false);
    await fireEvent.press(screen.getByLabelText('Revoke Source 1'));
    await act(async () => {
      pressConfirm(1);
    });
    await waitFor(() => expect(screen.queryByLabelText('Revoke Source 1')).toBeNull());
    expect(screen.getByText(/Revoked:/)).toBeTruthy();
  });

  it('marks the source connected from the live event', async () => {
    setProject();
    const { client, emit } = fakeClient();
    setRealtimeClientFactory(() => client);
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ data: { ...source(5, { name: 'Prod' }), key: FAKE_KEY } }, 201);
      return json({ data: [] });
    }) as never;
    await renderScreen();
    await screen.findByText('This project has no log sources yet.');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Prod');
    await act(async () => {
      await fireEvent.press(screen.getByText('Create log source'));
    });
    await screen.findByTestId('issued-key');
    await act(async () => {
      emit('organizations.7.projects.3', '.log_source.connected', { id: 5, project_id: 3, last_used_at: '2026-04-01T10:00:00Z' });
    });
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText('Waiting for the first event...')).toBeNull();
  });
});

describe('Integrations rounds', () => {
  it('lets an owner manage the sources', async () => {
    setProject();
    setRoles(['owner']);
    globalThis.fetch = jest.fn(async () => json({ data: [source(1)] })) as never;
    await renderScreen();
    expect(await screen.findByText('Source 1')).toBeTruthy();
    expect(screen.getByLabelText('Rotate key Source 1')).toBeTruthy();
  });

  it('disables creating while loading and keeps a source created during a slow load', async () => {
    setProject();
    let release: (response: Response) => void = () => undefined;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ data: { ...source(9, { name: 'Fresh' }), key: FAKE_KEY } }, 201);
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as never;
    await renderScreen();
    expect(screen.getByLabelText('Name').props.editable).toBe(false);
    await act(async () => {
      await useIntegrationsStore.getState().create('Fresh');
    });
    await act(async () => {
      release(json({ data: [source(1)] }));
    });
    expect(await screen.findByText('Source 1')).toBeTruthy();
    expect(screen.getByText('Fresh')).toBeTruthy();
  });

  it.each([
    [403, 'You are not allowed to create log sources.'],
    [0, 'Could not reach the server.'],
  ])('shows the create error for status %s', async (status, message) => {
    setProject();
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) {
        if (status === 0) throw new TypeError('Network request failed');
        return json({ message: 'x' }, status);
      }
      return json({ data: [] });
    }) as never;
    await renderScreen();
    await screen.findByText('This project has no log sources yet.');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Prod');
    await act(async () => {
      await fireEvent.press(screen.getByText('Create log source'));
    });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByTestId('issued-key')).toBeNull();
  });

  it.each([
    ['rotate', 'Rotate key', 403, 'You are not allowed to do that.'],
    ['rotate', 'Rotate key', 0, 'The action failed. Try again.'],
    ['revoke', 'Revoke', 403, 'You are not allowed to do that.'],
    ['revoke', 'Revoke', 0, 'The action failed. Try again.'],
  ])('shows the %s error for status %s', async (_kind, label, status, message) => {
    setProject();
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) {
        if (status === 0) throw new TypeError('Network request failed');
        return json({ message: 'x' }, status);
      }
      return json({ data: [source(1)] });
    }) as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await fireEvent.press(screen.getByLabelText(`${label} Source 1`));
    await act(async () => {
      pressConfirm(1);
    });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByTestId('issued-key')).toBeNull();
  });

  it.each([
    [{ project: ['archived'] }, 'The key was not rotated: the project is archived. The list was reloaded.'],
    [{ source: ['revoked'] }, 'The key was not rotated: the log source is revoked. The list was reloaded.'],
    [{}, 'The key was not rotated: the log source is revoked or its project is archived. The list was reloaded.'],
  ])('explains a 422 on rotate %#', async (errors, message) => {
    setProject();
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ message: 'Invalid', errors }, 422);
      return json({ data: [source(1)] });
    }) as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await fireEvent.press(screen.getByLabelText('Rotate key Source 1'));
    await act(async () => {
      pressConfirm(1);
    });
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('shows a notice after revoking and clears errors when a new confirmation opens', async () => {
    setProject();
    let fail = true;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) {
        if (fail) return json({ message: 'x' }, 403);
        return json({ data: source(1, { revoked_at: '2026-02-01T00:00:00Z' }) });
      }
      return json({ data: [source(1)] });
    }) as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await fireEvent.press(screen.getByLabelText('Revoke Source 1'));
    await act(async () => {
      pressConfirm(1);
    });
    expect(await screen.findByText('You are not allowed to do that.')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByLabelText('Revoke Source 1'));
    expect(screen.queryByText('You are not allowed to do that.')).toBeNull();
    await act(async () => {
      pressConfirm(1);
    });
    expect(await screen.findByText('"Source 1" was revoked.')).toBeTruthy();
  });

  it('refreshes the list when the connection comes back', async () => {
    setProject();
    const { client } = fakeClient();
    let onChange: (status: string) => void = () => undefined;
    let status = 'connected';
    client.connectionStatus = () => status as never;
    client.onConnectionChange = ((callback: (value: string) => void) => {
      onChange = callback;
      return () => undefined;
    }) as never;
    setRealtimeClientFactory(() => client);
    let loads = 0;
    globalThis.fetch = jest.fn(async () => {
      loads++;
      return json({ data: loads > 1 ? [source(1), source(2)] : [source(1)] });
    }) as never;
    await renderScreen();
    await screen.findByText('Source 1');
    await act(async () => {
      status = 'disconnected';
      onChange('disconnected');
      status = 'connected';
      onChange('connected');
    });
    expect(await screen.findByText('Source 2')).toBeTruthy();
  });

  it('drops the issued key when the screen unmounts', async () => {
    setProject();
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (isWrite(init)) return json({ data: { ...source(5, { name: 'Prod' }), key: FAKE_KEY } }, 201);
      return json({ data: [] });
    }) as never;
    let view: Awaited<ReturnType<typeof render>> | undefined;
    await act(async () => {
      view = await render(<Integrations />);
    });
    await screen.findByText('This project has no log sources yet.');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Prod');
    await act(async () => {
      await fireEvent.press(screen.getByText('Create log source'));
    });
    await screen.findByTestId('issued-key');
    await act(async () => {
      view?.unmount();
    });
    expect(useIntegrationsStore.getState().issued).toBeNull();
    expect(JSON.stringify(useIntegrationsStore.getState())).not.toContain(FAKE_KEY);
  });
});
