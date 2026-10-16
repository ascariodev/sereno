import { api } from './client'

export type OAuthQuery = Record<string, string>

export interface OAuthAuthorization {
  client: { id: string; name: string }
  redirect_host: string | null
  scopes: string[]
  organizations: { id: number; name: string }[]
}

export interface OAuthRedirect {
  redirect_url: string
}

export interface OAuthErrorBody {
  error: string
  message: string
}

export function fetchOAuthAuthorization(query: OAuthQuery, signal?: AbortSignal): Promise<OAuthAuthorization> {
  return api.get<OAuthAuthorization>('/api/oauth/authorize', { query, signal })
}

export function approveOAuthAuthorization(query: OAuthQuery, organizationId: number): Promise<OAuthRedirect> {
  return api.post<OAuthRedirect>('/api/oauth/authorize', { organization_id: organizationId }, { query })
}

export function denyOAuthAuthorization(query: OAuthQuery): Promise<OAuthRedirect> {
  return api.delete<OAuthRedirect>('/api/oauth/authorize', { query })
}
