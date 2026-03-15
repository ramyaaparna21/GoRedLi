import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api, clearToken, hasToken, saveToken } from './api'
import type { User } from './types'
import Home from './pages/Home'
import CreateWorkspace from './pages/CreateWorkspace'
import WorkspaceDetail from './pages/WorkspaceDetail'

// The web app has no OAuth flow of its own.
// It is always opened by the extension, which appends ?token=<jwt> to the URL.
// The token is read once, stored in localStorage, and used as a Bearer token for all API calls.

function NoTokenPage() {
  return (
    <div className="auth-page">
      <div className="auth-logo">Goredli</div>
      <p className="auth-tagline">Open this page from the Goredli extension.</p>
      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 8 }}>
        Click the extension icon → Sign in → Open go/main
      </p>
    </div>
  )
}

function Topbar({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <nav className="topbar">
      <a href="/" className="topbar-logo">Goredli</a>
      <div className="topbar-spacer" />
      <span className="topbar-user">{user.email}</span>
      <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign out</button>
    </nav>
  )
}

function AuthCallbackPage() {
  return (
    <div className="auth-page">
      <div className="auth-logo">Goredli</div>
      <p className="auth-tagline">Sign-in complete. You can close this tab.</p>
    </div>
  )
}

function AuthenticatedApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="app-shell">
      <Topbar user={user} onLogout={onLogout} />
      <Routes>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/workspaces/new" element={<CreateWorkspace />} />
        <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function AppInner() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const navigate = useNavigate()

  useEffect(() => {
    // If the extension passed a fresh token in the URL, save it and clean the URL.
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      saveToken(urlToken)
      params.delete('token')
      const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
      window.history.replaceState({}, '', newUrl)
    }

    if (!hasToken()) {
      setUser(null)
      return
    }

    api.getMe()
      .then(setUser)
      .catch(() => {
        clearToken()
        setUser(null)
      })
  }, [])

  function handleLogout() {
    clearToken()
    setUser(null)
    navigate('/')
  }

  if (user === undefined) return null // loading

  return user ? (
    <AuthenticatedApp user={user} onLogout={handleLogout} />
  ) : (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="*" element={<NoTokenPage />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}
