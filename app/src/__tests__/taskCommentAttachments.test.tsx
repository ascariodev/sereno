import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Linking } from 'react-native';

import { api } from '@/api/client';
import { TaskComments } from '@/components/TaskComments';
import '@/i18n';
import { useOrganizationStore } from '@/organization/store';
import { useMemberDirectoryStore } from '@/projects/members';
import { useAuthStore } from '@/session/auth';
import { useTaskCommentsStore } from '@/tasks/comments';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const getDocument = DocumentPicker.getDocumentAsync as jest.Mock;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function attachment(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    original_name: name,
    mime: 'application/pdf',
    size: 2048,
    created_at: '2026-01-01T00:00:00Z',
    url: 'https://files.test/a',
    ...extra,
  };
}

function comment(id: number, attachments: unknown[] = []) {
  return {
    id,
    task_id: 5,
    body: `Comment ${id}`,
    user: { id: 1, name: 'Ana' },
    mentions: [],
    attachments,
    created_at: '2026-01-01T00:00:00.000000Z',
    edited_at: null,
  };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockApi(handler: Handler) {
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/projects/3/members')) return json({ data: [{ id: 1, name: 'Ana' }] });
    return handler(url, init);
  });
  globalThis.fetch = fn as never;
  return fn;
}

const page = (data: unknown[]) => json({ data, meta: { next_cursor: null } });
const callsTo = (fn: jest.Mock, method: string, part: string) =>
  fn.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));

async function mount() {
  await act(async () => {
    render(<TaskComments projectId={3} taskId={5} />);
  });
}

async function pickDocument(name: string) {
  getDocument.mockResolvedValue({
    canceled: false,
    assets: [{ uri: `file:///cache/${name}`, name, size: 2048, mimeType: 'application/pdf' }],
  });
  await act(async () => {
    await fireEvent.press(screen.getByRole('button', { name: 'Attach' }));
  });
  await act(async () => {
    await fireEvent.press(screen.getByRole('button', { name: 'File' }));
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  getDocument.mockReset();
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useAuthStore.setState({ user: { id: 1, name: 'Ana', email: 'a@b.c', locale: null } });
  useOrganizationStore.setState({
    organizations: [{ id: 7, name: 'Org', roles: ['member'] } as never],
    activeId: 7,
    loaded: true,
  });
  useMemberDirectoryStore.getState().clear();
  useTaskCommentsStore.getState().clear();
});

describe('task comment attachments', () => {
  it('uploads to the task path, sends the ids with the comment and clears the sent file', async () => {
    const fn = mockApi((url, init) => {
      if (url.endsWith('/api/projects/3/tasks/5/attachments')) return json({ data: attachment(31, 'Report.pdf') }, 201);
      if (init?.method === 'POST') return json({ data: comment(9, [attachment(31, 'Report.pdf')]) }, 201);
      return page([]);
    });
    await mount();
    await pickDocument('Report.pdf');
    expect(await screen.findByText('Report.pdf')).toBeOnTheScreen();
    expect(callsTo(fn, 'POST', '/tasks/5/attachments')).toHaveLength(1);

    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'See file');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Comment' }));
    });

    const [, init] = callsTo(fn, 'POST', '/tasks/5/comments')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ body: 'See file', attachment_ids: [31] });
    expect(screen.getByLabelText('Attached files')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remove Report.pdf' })).toBeNull();
    expect(screen.getAllByText('Report.pdf')).toHaveLength(1);
  });

  it('shows the attachment_ids error when the server rejects the attachments on send', async () => {
    mockApi((url, init) => {
      if (url.endsWith('/api/projects/3/tasks/5/attachments')) return json({ data: attachment(31, 'Report.pdf') }, 201);
      if (init?.method === 'POST') {
        return json({ message: 'bad', errors: { attachment_ids: ['The attachment is no longer available.'] } }, 422);
      }
      return page([]);
    });
    await mount();
    await pickDocument('Report.pdf');
    expect(await screen.findByText('Report.pdf')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'See file');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Comment' }));
    });

    expect(await screen.findByText('The attachment is no longer available.')).toBeOnTheScreen();
  });

  it('blocks sending while an upload is in flight and sends no ids when there are none', async () => {
    let finish!: (response: Response) => void;
    const fn = mockApi((url, init) => {
      if (url.endsWith('/tasks/5/attachments')) return new Promise<Response>((resolve) => (finish = resolve));
      if (init?.method === 'POST') return json({ data: comment(9) }, 201);
      return page([]);
    });
    await mount();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Plain');
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(JSON.parse(String(callsTo(fn, 'POST', '/tasks/5/comments')[0][1]?.body))).toEqual({ body: 'Plain' });

    await pickDocument('Slow.pdf');
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Again');
    expect(screen.getByRole('button', { name: 'Comment' }).props.accessibilityState.disabled).toBe(true);
    await act(async () => finish(json({ data: attachment(40, 'Slow.pdf') }, 201)));
    expect(screen.getByRole('button', { name: 'Comment' }).props.accessibilityState.disabled).toBe(false);
  });

  it('shows the task limit message when too many files are picked', async () => {
    mockApi(() => page([]));
    await mount();
    getDocument.mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 11 }, (_, i) => ({
        uri: `file:///cache/f${i}.pdf`,
        name: `f${i}.pdf`,
        size: 10,
        mimeType: 'application/pdf',
      })),
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Attach' }));
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'File' }));
    });
    expect(await screen.findByText('You can attach up to 10 files per comment.')).toBeOnTheScreen();
  });

  it('renews a comment attachment with the task-attachments url before opening it', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    open.mockClear();
    const fn = mockApi((url) => {
      if (url.endsWith('/api/task-attachments/31/url')) {
        return json({ data: { url: 'https://files.test/fresh', expires_at: '2026-01-01T00:05:00Z' } });
      }
      return page([comment(1, [attachment(31, 'Report.pdf')])]);
    });
    await mount();
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Download: Report.pdf' }));
    });
    expect(callsTo(fn, 'GET', '/api/task-attachments/31/url')).toHaveLength(1);
    expect(open).toHaveBeenCalledWith('https://files.test/fresh');
  });

  it('refuses a non-http url from the renewal endpoint', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    open.mockClear();
    mockApi((url) => {
      if (url.endsWith('/api/task-attachments/31/url')) {
        return json({ data: { url: 'intent://evil', expires_at: '2026-01-01T00:05:00Z' } });
      }
      return page([comment(1, [attachment(31, 'Report.pdf')])]);
    });
    await mount();
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Download: Report.pdf' }));
    });
    expect(open).not.toHaveBeenCalled();
  });
});
