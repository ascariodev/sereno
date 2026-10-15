import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { api } from '@/api/client';
import '@/i18n';
import Notifications from '@/app/(tabs)/notifications';
import { parseNotification } from '@/notifications/api';
import { useNotificationsStore } from '@/notifications/store';
import { notificationTarget } from '@/notifications/target';
import { useOrganizationStore } from '@/organization/store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const acme = { id: 7, name: 'Acme', slug: 'acme', roles: ['owner'] };
const NOW = '2026-10-14T10:00:00Z';

function row(id: number, type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id, type, project_id: 1, data, read_at: null, created_at: NOW, ...extra };
}

const taskData = { task_id: 5, task_key: 'P1-5', task_title: 'Fix login', actor_id: 2, actor_name: 'Bea' };
const chatData = (parent: number | null) => ({
  channel_id: 50,
  channel_name: 'General',
  message_id: 90,
  parent_id: parent,
  message_excerpt: 'hello there',
  actor_id: 2,
  actor_name: 'Bea',
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

const page = (data: unknown[], unread: number, next: string | null = null) =>
  json({ data, meta: { next_cursor: next, unread_count: unread } });

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  api.setTokenProvider(null);
  api.setOrganizationProvider(null);
  useOrganizationStore.getState().clear();
  useOrganizationStore.setState({ organizations: [acme], activeId: 7, loaded: true });
  useNotificationsStore.getState().clear();
});

describe('notificationTarget', () => {
  it('opens the channel for a chat mention and the thread for a reply', () => {
    const top = parseNotification(row(1, 'chat_mention', chatData(null)))!;
    const reply = parseNotification(row(2, 'chat_mention', chatData(77)))!;

    expect(notificationTarget(top)).toEqual({ pathname: '/channel', params: { id: '50', name: 'General' } });
    expect(notificationTarget(reply)).toEqual({ pathname: '/thread', params: { channelId: '50', id: '77' } });
  });

  it('targets the task and has none for unknown types or a task without project', () => {
    expect(notificationTarget(parseNotification(row(1, 'task_assigned', taskData))!)).toEqual({
      pathname: '/task',
      params: { projectId: '1', id: '5' },
    });
    expect(notificationTarget(parseNotification(row(3, 'task_assigned', taskData, { project_id: null }))!)).toBeNull();
    expect(notificationTarget(parseNotification(row(2, 'mystery', {}))!)).toBeNull();
  });

  it('falls back to the generic variant when the data is malformed', () => {
    const parsed = parseNotification(row(1, 'chat_mention', { channel_id: 1 }));
    expect(parsed?.type).toBe('unknown');
  });
});

describe('Notifications tab', () => {
  it('lists notifications and opens the channel, marking it read', async () => {
    const fn = mockApi((url) => {
      if (url.includes('/read')) return json({ unread_count: 1 });
      return page([row(2, 'chat_mention', chatData(null)), row(1, 'task_assigned', taskData)], 2);
    });
    await render(<Notifications />);

    expect(await screen.findByText(/Bea mentioned you in General/)).toBeOnTheScreen();
    expect(screen.getByText('hello there')).toBeOnTheScreen();
    expect(screen.getByText(/Bea assigned you P1-5/)).toBeOnTheScreen();
    expect(screen.queryByText('Not available in the app yet.')).toBeNull();

    await act(async () => {
      await fireEvent.press(screen.getByText(/Bea mentioned you in General/));
    });

    expect(router.push).toHaveBeenCalledWith({ pathname: '/channel', params: { id: '50', name: 'General' } });
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(useNotificationsStore.getState().notifications[0].read_at).not.toBeNull();
    const call = fn.mock.calls.find(([url]) => url.includes('/read'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ ids: [2] });
  });

  it('opens the task for a task notification and marks it read', async () => {
    mockApi((url) => (url.includes('/read') ? json({ unread_count: 0 }) : page([row(1, 'task_assigned', taskData)], 1)));
    await render(<Notifications />);

    await act(async () => {
      await fireEvent.press(await screen.findByText(/Bea assigned you P1-5/));
    });

    expect(router.push).toHaveBeenCalledWith({ pathname: '/task', params: { projectId: '1', id: '5' } });
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });

  it('marks all as read', async () => {
    const fn = mockApi((url) => (url.includes('/read') ? json({ unread_count: 0 }) : page([row(1, 'task_assigned', taskData)], 1)));
    await render(<Notifications />);

    await act(async () => {
      await fireEvent.press(await screen.findByText('Mark all as read'));
    });

    expect(useNotificationsStore.getState().unreadCount).toBe(0);
    expect(screen.queryByText('Mark all as read')).toBeNull();
    const call = fn.mock.calls.find(([url]) => url.includes('/read'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ all: true });
  });

  it('restores the state when marking read fails', async () => {
    let failRead = true;
    mockApi((url) => {
      if (url.includes('/read')) return failRead ? json({}, 500) : json({ unread_count: 0 });
      return page([row(1, 'task_assigned', taskData)], 1);
    });
    await render(<Notifications />);
    await screen.findByText(/Bea assigned you P1-5/);

    await act(async () => {
      await useNotificationsStore.getState().markAllRead();
    });
    failRead = false;

    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    expect(useNotificationsStore.getState().notifications[0].read_at).toBeNull();
  });

  it('loads the next page with the cursor', async () => {
    const fn = mockApi((url) =>
      url.includes('cursor=abc')
        ? page([row(1, 'task_commented', { ...taskData, comment_id: 3, comment_excerpt: 'nice' })], 2)
        : page([row(2, 'chat_mention', chatData(null))], 2, 'abc'),
    );
    await render(<Notifications />);

    await act(async () => {
      await fireEvent.press(await screen.findByText('Load more'));
    });

    expect(await screen.findByText(/Bea commented on P1-5/)).toBeOnTheScreen();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(fn.mock.calls.some(([url]) => url.includes('cursor=abc'))).toBe(true);
  });

  it('shows an error and retries the first load', async () => {
    let ok = false;
    mockApi(() => (ok ? page([], 0) : json({}, 500)));
    await render(<Notifications />);

    expect(await screen.findByText('Could not load your notifications.')).toBeOnTheScreen();
    ok = true;
    await act(async () => {
      await fireEvent.press(screen.getByText('Retry'));
    });

    expect(await screen.findByText('You have no notifications yet.')).toBeOnTheScreen();
  });

  it('clears when the organization changes', async () => {
    mockApi(() => page([row(1, 'task_assigned', taskData)], 1));
    await render(<Notifications />);
    await screen.findByText(/Bea assigned you P1-5/);

    await act(async () => {
      useOrganizationStore.setState({ activeId: null });
    });

    expect(useNotificationsStore.getState().notifications).toEqual([]);
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });
});
