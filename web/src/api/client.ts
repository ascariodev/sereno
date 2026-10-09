import { config } from '../config'
import type { FieldErrors } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly errors: FieldErrors

  constructor(status: number, message: string, errors: FieldErrors = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
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
    const url = new URL(baseUrl + (path.startsWith('/') ? path : `/${path}`))
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }

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
    if (opts.body instanceof FormData) {
      // No Content-Type: the browser sets multipart/form-data with its boundary.
      init.body = opts.body
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }

    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(url.toString(), init)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
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

    let payload: { message?: unknown; errors?: unknown } = {}
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

    if (response.status === 401) onUnauthorized?.()
    if (response.status === 403 && sentOrganizationId !== null) onForbidden?.(sentOrganizationId)
    throw new ApiError(response.status, message, errors)
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
  }
}

export const api = createApiClient({ baseUrl: config.apiUrl })
