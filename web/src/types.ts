export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string
  createdAt: string
}

export interface Workspace {
  id: string
  name: string
  role: 'user' | 'owner'
  createdAt: string
}

export interface GoLink {
  id: string
  workspaceId: string
  alias: string
  targetUrl: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface Member {
  id: string
  userId?: string
  workspaceId: string
  email: string
  role: 'user' | 'owner'
  createdAt: string
}
