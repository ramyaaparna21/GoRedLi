import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { User, Workspace } from '../types'
import WorkspaceTable from '../components/WorkspaceTable'
import LinksTable from '../components/LinksTable'

interface Props {
  user: User
}

export default function Home({ user: _user }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Read ?notfound=alias from URL (set by redirect.ts when an alias doesn't exist)
  const [notFoundAlias] = useState(() => searchParams.get('notfound') || undefined)

  useEffect(() => {
    api.getWorkspaces().then(setWorkspaces).catch(console.error)
  }, [])

  // Clean up the notfound param from URL after capturing it
  useEffect(() => {
    if (notFoundAlias && searchParams.has('notfound')) {
      searchParams.delete('notfound')
      setSearchParams(searchParams, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleReorder(reordered: Workspace[]) {
    setWorkspaces(reordered)
    setSaving(true)
    try {
      await api.updateWorkspaceOrder(reordered.map((w) => w.id))
    } catch {
      // Reload from server on failure.
      const fresh = await api.getWorkspaces()
      setWorkspaces(fresh)
    } finally {
      setSaving(false)
    }
  }

  function openPopularUrls() {
    // Open the extension's Popular URLs page in a new tab.
    // Navigate to r/popular-urls — the extension intercepts this and opens its page.
    window.open('http://r/popular-urls', '_blank')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">rRed</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={openPopularUrls}>
            Popular URLs
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/workspaces/new')}>
            Add workspace
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Workspaces</span>
          {saving && <span style={{ fontSize: 12, color: '#9ca3af' }}>Saving…</span>}
        </div>
        {workspaces.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No workspaces yet.</p>
        ) : (
          <WorkspaceTable workspaces={workspaces} onChange={handleReorder} />
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Links</span>
        </div>
        <LinksTable workspaces={workspaces} showWorkspaceCol initialAlias={notFoundAlias} />
      </div>
    </div>
  )
}
