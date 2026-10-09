/**
 * Attachment limits. The API has no endpoint that exposes them, so they mirror `chat.attachments` in
 * `api/config/chat.php` (`max_size_kb` 5120, `max_per_message` 10); keep both in sync. The API stays the
 * authority: these only avoid a doomed upload.
 */
export const ATTACHMENT_MAX_SIZE_BYTES = 5120 * 1024
export const ATTACHMENT_MAX_PER_MESSAGE = 10

export interface AppConfig {
  apiUrl: string
  reverb: {
    key: string
    host: string
    port: number
    scheme: 'http' | 'https'
  }
}

type ConfigEnv = Partial<Record<keyof ImportMetaEnv, string>>

export function readConfig(env: ConfigEnv): AppConfig {
  return {
    apiUrl: (env.VITE_API_URL || 'http://localhost:8003').replace(/\/+$/, ''),
    reverb: {
      key: env.VITE_REVERB_APP_KEY ?? '',
      host: env.VITE_REVERB_HOST || 'localhost',
      port: Number(env.VITE_REVERB_PORT) || 8086,
      scheme: env.VITE_REVERB_SCHEME === 'https' ? 'https' : 'http',
    },
  }
}

export const config = readConfig(import.meta.env)
