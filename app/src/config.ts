export interface AppConfig {
  apiUrl: string
  reverb: {
    key: string
    host: string
    port: number
    scheme: 'http' | 'https'
  }
}

export interface ConfigEnv {
  EXPO_PUBLIC_API_URL?: string
  EXPO_PUBLIC_REVERB_APP_KEY?: string
  EXPO_PUBLIC_REVERB_HOST?: string
  EXPO_PUBLIC_REVERB_PORT?: string
  EXPO_PUBLIC_REVERB_SCHEME?: string
}

export function readConfig(env: ConfigEnv): AppConfig {
  return {
    apiUrl: (env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:8003').replace(/\/+$/, ''),
    reverb: {
      key: env.EXPO_PUBLIC_REVERB_APP_KEY ?? '',
      host: env.EXPO_PUBLIC_REVERB_HOST || '10.0.2.2',
      port: Number(env.EXPO_PUBLIC_REVERB_PORT) || 8086,
      scheme: env.EXPO_PUBLIC_REVERB_SCHEME === 'https' ? 'https' : 'http',
    },
  }
}

// Expo only inlines EXPO_PUBLIC_* when accessed statically as process.env.NAME.
export const config = readConfig({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_REVERB_APP_KEY: process.env.EXPO_PUBLIC_REVERB_APP_KEY,
  EXPO_PUBLIC_REVERB_HOST: process.env.EXPO_PUBLIC_REVERB_HOST,
  EXPO_PUBLIC_REVERB_PORT: process.env.EXPO_PUBLIC_REVERB_PORT,
  EXPO_PUBLIC_REVERB_SCHEME: process.env.EXPO_PUBLIC_REVERB_SCHEME,
})
