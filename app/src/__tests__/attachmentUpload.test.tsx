import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/api/client';
import Channel from '@/app/channel';
import { MessageComposer } from '@/components/MessageComposer';
import { toPickedFile } from '@/messages/attachments';
import { useMessagesStore } from '@/messages/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: '50', name: 'Acme API' }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const getDocument = DocumentPicker.getDocumentAsync as jest.Mock;
const launchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function attachment(id: number, name: string) {
  return { id, original_name: name, mime: 'application/pdf', size: 2048, created_at: '2026-01-01T00:00:00Z', url: 'https://x/a' };
}

function message(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: 50,
    kind: 'user',
    body: `Body ${id}`,
    payload: null,
    parent_id: null,
    replies_count: 0,
    last_reply_at: null,
    recent_participants: [],
    user: { id: 1, name: 'Ana' },
    mentions: [],
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function document(name: string, size: number | undefined = 2048) {
  return { canceled: false, assets: [{ uri: `file:///cache/${name}`, name, size, mimeType: 'application/pdf', lastModified: 0 }] };
}

async function pickDocument() {
  await fireEvent.press(screen.getByRole('button', { name: 'Attach' }));
  await fireEvent.press(screen.getByRole('button', { name: 'File' }));
}

beforeEach(() => {
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useMessagesStore.getState().clear();
  getDocument.mockReset();
  launchLibrary.mockReset();
  jest.restoreAllMocks();
});

describe('toPickedFile', () => {
  it('takes the name from the picker or the uri and keeps unknown sizes as null', () => {
    expect(toPickedFile({ uri: 'file:///a/b.pdf', name: 'Report.pdf', size: 10, mimeType: 'application/pdf' })).toEqual({
      uri: 'file:///a/b.pdf',
      name: 'Report.pdf',
      size: 10,
      mimeType: 'application/pdf',
    });
    expect(toPickedFile({ uri: 'file:///a/IMG%201.jpg?x=1', fileName: null, fileSize: undefined })).toEqual({
      uri: 'file:///a/IMG%201.jpg?x=1',
      name: 'IMG 1.jpg',
      size: null,
      mimeType: null,
    });
  });
});

describe('Uploading attachments from the channel composer', () => {
  it('uploads a picked file as multipart and sends its id with the message', async () => {
    const upload = deferred<Response>();
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/attachments')) return upload.promise;
      if (init?.method === 'POST') return json({ data: message(2, { body: null }) }, 201);
      return json({ data: [message(1)], meta: { next_cursor: null } });
    });
    globalThis.fetch = fetchMock as never;
    // Jest runs Node's FormData; React Native reads the { uri, name, type } part that the app appends.
    const append = jest.spyOn(FormData.prototype, 'append');
    getDocument.mockResolvedValue(document('Report.pdf'));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await pickDocument();

    expect(await screen.findByText('Uploading...')).toBeOnTheScreen();
    expect(getDocument).toHaveBeenCalledWith({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    const [url, init] = fetchMock.mock.calls.find(([target]) => target.endsWith('/attachments'))!;
    expect(url).toContain('/api/channels/50/attachments');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(append).toHaveBeenCalledWith('file', { uri: 'file:///cache/Report.pdf', name: 'Report.pdf', type: 'application/pdf' });

    await act(async () => upload.resolve(json({ data: attachment(31, 'Report.pdf') }, 201)));
    expect(await screen.findByText('2 KB')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.queryByText('Report.pdf')).toBeNull());
    const send = fetchMock.mock.calls.find(([target, options]) => target.endsWith('/messages') && options?.method === 'POST')!;
    expect(JSON.parse(String(send[1]?.body))).toEqual({ body: '', attachment_ids: [31] });
  });

  it('rejects a file over the size limit without uploading it', async () => {
    const fetchMock = jest.fn(async () => json({ data: [message(1)], meta: { next_cursor: null } }));
    globalThis.fetch = fetchMock as never;
    getDocument.mockResolvedValue(document('Big.zip', 6 * 1024 * 1024));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await pickDocument();

    expect(await screen.findByText('Big.zip is larger than 5 MB.')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows the API error and retries a failure that may succeed', async () => {
    let attempts = 0;
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/attachments')) {
        attempts++;
        return attempts === 1 ? json({ message: 'x' }, 500) : json({ data: attachment(32, 'Report.pdf') }, 201);
      }
      return json({ data: [message(1)], meta: { next_cursor: null } });
    }) as never;
    getDocument.mockResolvedValue(document('Report.pdf'));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await pickDocument();
    expect(await screen.findByText('Could not upload the file.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Retry Report.pdf' }));
    expect(await screen.findByText('2 KB')).toBeOnTheScreen();
    expect(attempts).toBe(2);
  });

  it('shows a validation error without a retry', async () => {
    globalThis.fetch = jest.fn(async (url: string) =>
      url.endsWith('/attachments')
        ? json({ message: 'x', errors: { file: ['The file is empty.'] } }, 422)
        : json({ data: [message(1)], meta: { next_cursor: null } }),
    ) as never;
    getDocument.mockResolvedValue(document('Empty.txt'));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await pickDocument();

    expect(await screen.findByText('The file is empty.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Retry Empty.txt' })).toBeNull();
  });

  it('cancels an upload in progress and ignores its late answer', async () => {
    const upload = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/attachments')) {
        signal = init?.signal;
        return upload.promise;
      }
      return json({ data: [message(1)], meta: { next_cursor: null } });
    }) as never;
    getDocument.mockResolvedValue(document('Report.pdf'));
    await render(<Channel />);
    await screen.findByText('Body 1');

    await pickDocument();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel the upload of Report.pdf' }));

    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText('Report.pdf')).toBeNull();
    await act(async () => upload.resolve(json({ data: attachment(33, 'Report.pdf') }, 201)));
    expect(screen.queryByText('Report.pdf')).toBeNull();
  });

  it('picks photos with the remaining slots and keeps a canceled pick empty', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: [message(1)], meta: { next_cursor: null } })) as never;
    launchLibrary.mockResolvedValue({ canceled: true, assets: null });
    await render(<Channel />);
    await screen.findByText('Body 1');

    await fireEvent.press(screen.getByRole('button', { name: 'Attach' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Photo or video' }));

    await waitFor(() =>
      expect(launchLibrary).toHaveBeenCalledWith({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
      }),
    );
    expect(screen.queryByText('Uploading...')).toBeNull();
  });
});

describe('Uploading attachments from a custom composer (thread)', () => {
  it('passes the uploaded ids to the send callback', async () => {
    globalThis.fetch = jest.fn(async () => json({ data: attachment(34, 'Shot.png') }, 201)) as never;
    launchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/Shot.png', fileName: 'Shot.png', fileSize: 100, mimeType: 'image/png' }],
    });
    const send = jest.fn(async () => undefined);
    await render(<MessageComposer channelId={50} send={send} placeholder="Reply" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Attach' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Photo or video' }));
    expect(await screen.findByText('100 B')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Reply'), 'Look');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(send).toHaveBeenCalledWith('Look', [34]));
  });
});
