import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function CreateWorkspace() {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const { id } = await api.createWorkspace(name.trim())
      navigate(`/workspaces/${id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/" className="btn btn-secondary btn-sm">← Back</Link>
        <h1 className="page-title">Create workspace</h1>
      </div>
      <div className="card" style={{ maxWidth: 400 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="ws-name">Workspace name</label>
            <input
              id="ws-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering"
              autoFocus
            />
            {error && <p className="error-msg">{error}</p>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      </div>
    </div>
  )
}
