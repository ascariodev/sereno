import { config } from '@/config'
import type { FieldErrors } from '@/api/types'

export class ApiError extends Error {
  readonly status: number
  readonly errors: FieldErrors
  readonly code: string | null

  constructor(status: number, message: string, errors: FieldErrors = {}, code: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
    this.code = code
  }
}

export interface ApiClientOptions {
  baseUrl: string
  fetch?: typeof fetch
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>
  signal?: AbortSignal
}

type Provider<T> = (() => T | null | undefined) | null

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  delete<T>(path: string, options?: RequestOptions): Promise<T>
  setTokenProvider(provider: Provider<string>): void
  setLocaleProvider(provider: Provider<string>): void
  setOrganizationProvider(provider: Provider<number | string>): void
  setUnauthorizedHandler(handler: (() => void) | null): void
  setForbiddenHandler(handler: ((organizationId: number) => void) | null): void
  clearForbiddenHandler(handler: (organizationId: number) => void): void
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  const url = baseUrl + (path.startsWith('/') ? path : `/${path}`)
  if (params.length === 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  let getToken: Provider<string> = null
  let getLocale: Provider<string> = null
  let getOrganizationId: Provider<number | string> = null
  let onUnauthorized: (() => void) | null = null
  let onForbidden: ((organizationId: number) => void) | null = null

  async function request<T>(
    method: string,
    path: string,
    opts: RequestOptions & { body?: unknown } = {},
  ): Promise<T> {
    const url = buildUrl(baseUrl, path, opts.query)

    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = getToken?.()
    const locale = getLocale?.()
    const organizationId = getOrganizationId?.()
    if (token) headers.Authorization = `Bearer ${token}`
    if (locale) headers['Accept-Language'] = locale
    let sentOrganizationId: number | null = null
    if (organizationId !== null && organizationId !== undefined && organizationId !== '') {
      headers['X-Organization-Id'] = String(organizationId)
      const numericId = Number(organizationId)
      if (Number.isInteger(numericId)) sentOrganizationId = numericId
    }

    const init: RequestInit = { method, headers, signal: opts.signal }
    if (typeof FormData !== 'undefined' && opts.body instanceof FormData) {
      // No Content-Type: fetch sets multipart/form-data with its boundary.
      init.body = opts.body
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }

    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, init)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new ApiError(0, error instanceof Error ? error.message : 'Network error')
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T
      const text = await response.text()
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ApiError(response.status, 'Invalid JSON response')
      }
    }

    let payload: { message?: unknown; errors?: unknown; code?: unknown } = {}
    try {
      payload = await response.json()
    } catch {
      payload = {}
    }
    const message = typeof payload.message === 'string' ? payload.message : response.statusText
    const errors =
      response.status === 422 && payload.errors && typeof payload.errors === 'object'
        ? (payload.errors as FieldErrors)
        : {}
    const code = typeof payload.code === 'string' ? payload.code : null

    if (response.status === 401 && (getToken?.() || null) === (token || null)) onUnauthorized?.()
    if (response.status === 403 && code === 'organization_forbidden' && sentOrganizationId !== null) {
      onForbidden?.(sentOrganizationId)
    }
    throw new ApiError(response.status, message, errors, code)
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    delete: (path, opts) => request('DELETE', path, opts),
    setTokenProvider: (provider) => {
      getToken = provider
    },
    setLocaleProvider: (provider) => {
      getLocale = provider
    },
    setOrganizationProvider: (provider) => {
      getOrganizationId = provider
    },
    setUnauthorizedHandler: (handler) => {
      onUnauthorized = handler
    },
    setForbiddenHandler: (handler) => {
      onForbidden = handler
    },
    clearForbiddenHandler: (handler) => {
      if (onForbidden === handler) onForbidden = null
    },
  }
}

export const api = createApiClient({ baseUrl: config.apiUrl })
