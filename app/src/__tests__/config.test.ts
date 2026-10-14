import { readConfig } from '@/config'

describe('readConfig', () => {
  it('uses emulator defaults and an empty Reverb key', () => {
    expect(readConfig({})).toEqual({
      apiUrl: 'http://10.0.2.2:8003',
      reverb: { key: '', host: '10.0.2.2', port: 8086, scheme: 'http' },
    })
  })

  it('reads the variables and trims trailing slashes', () => {
    expect(
      readConfig({
        EXPO_PUBLIC_API_URL: 'https://api.test//',
        EXPO_PUBLIC_REVERB_APP_KEY: 'k',
        EXPO_PUBLIC_REVERB_HOST: 'ws.test',
        EXPO_PUBLIC_REVERB_PORT: '443',
        EXPO_PUBLIC_REVERB_SCHEME: 'https',
      }),
    ).toEqual({
      apiUrl: 'https://api.test',
      reverb: { key: 'k', host: 'ws.test', port: 443, scheme: 'https' },
    })
  })

  it('falls back on an invalid port or scheme', () => {
    const { reverb } = readConfig({ EXPO_PUBLIC_REVERB_PORT: 'x', EXPO_PUBLIC_REVERB_SCHEME: 'ftp' })
    expect(reverb.port).toBe(8086)
    expect(reverb.scheme).toBe('http')
  })
})
