import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { GoLink, Workspace } from '../types'

function getVisitCounts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('rred_visit_counts') || '{}')
  } catch {
    return {}
  }
}

interface LinkFormProps {
  workspaces: Workspace[]
  initial?: GoLink
  initialAlias?: string
  onSave: () => void
  onCancel: () => void
}

function LinkModal({ workspaces, initial, initialAlias, onSave, onCancel }: LinkFormProps) {
  const [wsId, setWsId] = useState(initial?.workspaceId ?? workspaces[0]?.id ?? '')
  const [alias, setAlias] = useState(initial?.alias ?? initialAlias ?? '')
  const [targetUrl, setTargetUrl] = useState(initial?.targetUrl ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (initial) {
        await api.updateLink(initial.workspaceId, initial.id, { alias, targetUrl, title })
      } else {
        await api.createLink(wsId, { alias, targetUrl, title })
      }
      onSave()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{initial ? 'Edit link' : initialAlias ? `Create r/${initialAlias}` : 'Add link'}</span>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          {!initial && (
            <div className="form-group">
              <label>Workspace</label>
              <select value={wsId} onChange={(e) => setWsId(e.target.value)}>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Alias</label>
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. wiki"
              required
            />
          </div>
          <div className="form-group">
            <label>Target URL</label>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://..."
              required
              autoFocus={!!initialAlias}
            />
          </div>
          <div className="form-group">
            <label>Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Team Wiki"
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface Props {
  workspaceId?: string   // if provided, scoped to that workspace; otherwise all workspaces
  workspaces: Workspace[]
  showWorkspaceCol?: boolean
  initialAlias?: string  // pre-fill alias and auto-open modal (e.g. from ?notfound= redirect)
}

export default function LinksTable({ workspaceId, workspaces, showWorkspaceCol = false, initialAlias }: Props) {
  const [links, setLinks] = useState<GoLink[]>([])
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<GoLink | null | 'new'>(null)
  const [pendingAlias, setPendingAlias] = useState(initialAlias)
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>(getVisitCounts)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()

  const LIMIT = 25

  // Listen for visit count updates from the extension's content script
  useEffect(() => {
    function handleUpdate() { setVisitCounts(getVisitCounts()) }
    window.addEventListener('rred-visit-counts', handleUpdate)
    // Request visit counts in case content script loaded after React
    window.dispatchEvent(new CustomEvent('rred-get-visit-counts'))
    return () => window.removeEventListener('rred-visit-counts', handleUpdate)
  }, [])

  // Sort links by visit count (descending); fall back to original order if no data
  const sortedLinks = useMemo(() => {
    if (Object.keys(visitCounts).length === 0) return links
    return [...links].sort(
      (a, b) => (visitCounts[b.targetUrl] || 0) - (visitCounts[a.targetUrl] || 0),
    )
  }, [links, visitCounts])

  // Auto-open modal when initialAlias is set and workspaces are loaded
  useEffect(() => {
    if (pendingAlias && workspaces.length > 0 && editing === null) {
      setEditing('new')
    }
  }, [pendingAlias, workspaces.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchLinks(q: string, off: number, replace: boolean) {
    setLoading(true)
    try {
      const params = { search: q, offset: off, limit: LIMIT }
      const data = workspaceId
        ? await api.getWorkspaceLinks(workspaceId, params)
        : await api.getLinks(params)
      setLinks((prev) => replace ? data : [...prev, ...data])
      setHasMore(data.length === LIMIT)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLinks('', 0, true)
    return () => clearTimeout(searchTimeout.current)
  }, [workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setSearch(q)
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setOffset(0)
      fetchLinks(q, 0, true)
    }, 300)
  }

  function handleLoadMore() {
    const next = offset + LIMIT
    setOffset(next)
    fetchLinks(search, next, false)
  }

  async function handleDelete(link: GoLink) {
    if (!confirm(`Delete r/${link.alias}?`)) return
    await api.deleteLink(link.workspaceId, link.id)
    setLinks((prev) => prev.filter((l) => l.id !== link.id))
  }

  function wsName(id: string) {
    return workspaces.find((w) => w.id === id)?.name ?? id
  }

  function refresh() {
    setEditing(null)
    setPendingAlias(undefined)
    setOffset(0)
    fetchLinks(search, 0, true)
  }

  function cancelEdit() {
    setEditing(null)
    setPendingAlias(undefined)
  }

  return (
    <>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search links…"
          value={search}
          onChange={handleSearchChange}
        />
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + Add link
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Alias</th>
              <th>Target URL</th>
              {showWorkspaceCol && <th>Workspace</th>}
              <th>Title</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedLinks.length === 0 && !loading && (
              <tr><td colSpan={showWorkspaceCol ? 6 : 5} className="empty">No links yet</td></tr>
            )}
            {sortedLinks.map((link) => (
              <tr key={link.id}>
                <td><code>r/{link.alias}</code></td>
                <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <a href={link.targetUrl} target="_blank" rel="noreferrer">{link.targetUrl}</a>
                </td>
                {showWorkspaceCol && <td>{wsName(link.workspaceId)}</td>}
                <td>{link.title || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                <td style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                  {new Date(link.updatedAt).toLocaleDateString()}
                </td>
                <td>
                  <div className="td-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(link)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(link)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="load-more">
          <button className="btn btn-secondary" onClick={handleLoadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {editing && (
        <LinkModal
          workspaces={workspaces}
          initial={editing === 'new' ? undefined : editing}
          initialAlias={editing === 'new' ? pendingAlias : undefined}
          onSave={refresh}
          onCancel={cancelEdit}
        />
      )}
    </>
  )
}
