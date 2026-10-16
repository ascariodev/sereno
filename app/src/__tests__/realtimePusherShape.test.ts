import { disconnectRealtime, setRealtimeClientFactory, subscribeToUser } from '@/realtime/echo';

jest.mock('@/config', () => ({
  config: { apiUrl: 'http://api.test', reverb: { key: 'app-key', host: 'ws.test', port: 8086, scheme: 'http' } },
}));

const constructed: string[] = [];

jest.mock('pusher-js/react-native', () => {
  class RealShapePusher {
    connection = { state: 'connecting', bind: jest.fn(), unbind: jest.fn() };
    constructor(key: string) {
      constructed.push(key);
    }
    subscribe() {
      return { bind: jest.fn(), unbind: jest.fn() };
    }
    unsubscribe = jest.fn();
    disconnect = jest.fn();
  }
  return { Pusher: RealShapePusher };
});

afterEach(() => {
  disconnectRealtime();
});

describe('pusher-js/react-native exported only as a named Pusher', () => {
  it('builds the Echo client from the named export', () => {
    setRealtimeClientFactory(null);
    expect(() => subscribeToUser(1)).not.toThrow();
    expect(constructed).toEqual(['app-key']);
  });
});
