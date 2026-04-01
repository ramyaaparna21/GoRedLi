import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { User } from '../types'

// This page is the landing spot after OAuth when coming from the extension.
// The extension's background.ts watches for this URL, extracts the token, closes the tab.
// For regular web sign-in this page is never shown (backend redirects to / instead).
export default function AuthSuccess({ onSuccess }: { onSuccess: (u: User) => void }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    // Re-fetch /me so the app state is updated (cookie was already set by the backend).
    api.getMe()
      .then((user) => {
        onSuccess(user)
        navigate('/', { replace: true })
      })
      .catch(() => navigate('/', { replace: true }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The token param is only used by the extension (picked up by background.ts).
  void params

  return (
    <div className="auth-page">
      <div className="auth-logo">rRed</div>
      <p className="auth-tagline">Signing you in…</p>
    </div>
  )
}
