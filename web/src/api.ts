import type { GoLink, Member, User, Workspace } from './types'

const API_URL = import.meta.env.VITE_API_URL || ''

function getToken(): string {
  return localStorage.getItem('rred_token') || ''
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(err.error || res.statusText), { status: res.status })
  }
  return res.json()
}

export function saveToken(token: string) {
  localStorage.setItem('rred_token', token)
}

export function clearToken() {
  localStorage.removeItem('rred_token')
}

export function hasToken(): boolean {
  return !!localStorage.getItem('rred_token')
}

// Exchange a one-time auth code for a JWT. Returns the token or null on failure.
export async function redeemAuthCode(code: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/code/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) return null
    const data = await res.json() as { token: string }
    return data.token
  } catch {
    return null
  }
}

export const api = {
  getMe: () => request<User>('/me'),

  getWorkspaces: () => request<Workspace[]>('/workspaces'),
  createWorkspace: (name: string) =>
    request<{ id: string }>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  updateWorkspace: (id: string, name: string) =>
    request<{ status: string; name: string }>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateWorkspaceOrder: (order: string[]) =>
    request<{ status: string }>('/workspace-order', { method: 'PATCH', body: JSON.stringify({ order }) }),

  getLinks: (params?: { search?: string; offset?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.search) q.set('search', params.search)
    if (params?.offset != null) q.set('offset', String(params.offset))
    if (params?.limit != null) q.set('limit', String(params.limit))
    return request<GoLink[]>(`/links?${q}`)
  },
  getWorkspaceLinks: (wsId: string, params?: { search?: string; offset?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.search) q.set('search', params.search)
    if (params?.offset != null) q.set('offset', String(params.offset))
    if (params?.limit != null) q.set('limit', String(params.limit))
    return request<GoLink[]>(`/workspaces/${wsId}/links?${q}`)
  },
  createLink: (wsId: string, data: { alias: string; targetUrl: string; title?: string }) =>
    request<GoLink>(`/workspaces/${wsId}/links`, { method: 'POST', body: JSON.stringify(data) }),
  updateLink: (wsId: string, linkId: string, data: Partial<{ alias: string; targetUrl: string; title: string }>) =>
    request<GoLink>(`/workspaces/${wsId}/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLink: (wsId: string, linkId: string) =>
    request<{ status: string }>(`/workspaces/${wsId}/links/${linkId}`, { method: 'DELETE' }),

  getMembers: (wsId: string) => request<Member[]>(`/workspaces/${wsId}/members`),
  addMember: (wsId: string, data: { email: string; role: string }) =>
    request<Member>(`/workspaces/${wsId}/members`, { method: 'POST', body: JSON.stringify(data) }),
  updateMember: (wsId: string, memberId: string, role: string) =>
    request<Member>(`/workspaces/${wsId}/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteMember: (wsId: string, memberId: string) =>
    request<{ status: string }>(`/workspaces/${wsId}/members/${memberId}`, { method: 'DELETE' }),
}
