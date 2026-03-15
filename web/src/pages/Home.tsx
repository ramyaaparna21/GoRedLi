import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

  useEffect(() => {
    api.getWorkspaces().then(setWorkspaces).catch(console.error)
  }, [])

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

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Goredli</h1>
        <button className="btn btn-primary" onClick={() => navigate('/workspaces/new')}>
          Add workspace
        </button>
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
        <LinksTable workspaces={workspaces} showWorkspaceCol />
      </div>
    </div>
  )
}
