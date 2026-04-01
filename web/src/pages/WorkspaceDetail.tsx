import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { Member, Workspace } from '../types'
import LinksTable from '../components/LinksTable'
import MembersTable from '../components/MembersTable'

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.getWorkspace(id),
      api.getMembers(id),
      api.getMe(),
    ]).then(([ws, mem, me]) => {
      setWorkspace(ws)
      setMembers(mem)
      setCurrentUserId(me.id)
    }).catch(() => navigate('/'))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  function refreshMembers() {
    if (!id) return
    api.getMembers(id).then(setMembers).catch(console.error)
  }

  function startEditingName() {
    setNameValue(workspace!.name)
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.select(), 0)
  }

  async function saveNameEdit() {
    if (!id || !workspace || nameSaving) return
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === workspace.name) { setEditingName(false); return }
    setNameSaving(true)
    try {
      await api.updateWorkspace(id, trimmed)
      setWorkspace({ ...workspace, name: trimmed })
    } catch {
      // Revert on failure
      setNameValue(workspace.name)
    } finally {
      setNameSaving(false)
      setEditingName(false)
    }
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); return }
    if (e.key === 'Escape') { setEditingName(false) }
  }

  if (!workspace || !id) return null

  const isOwner = workspace.role === 'owner'

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/" className="btn btn-secondary btn-sm">← Back</Link>
        {editingName ? (
          <input
            ref={nameInputRef}
            className="page-title-input"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveNameEdit}
            onKeyDown={handleNameKeyDown}
            disabled={nameSaving}
          />
        ) : (
          <h1
            className="page-title"
            title={isOwner ? 'Click to rename' : undefined}
            style={isOwner ? { cursor: 'pointer' } : undefined}
            onClick={isOwner ? startEditingName : undefined}
          >
            {workspace.name}
            {isOwner && <span style={{ marginLeft: 8, fontSize: 14, color: '#9ca3af' }}>✎</span>}
          </h1>
        )}
        <span className={`badge badge-${workspace.role}`}>{workspace.role}</span>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Links</span>
        </div>
        <LinksTable workspaceId={id} workspaces={[workspace]} />
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Members</span>
        </div>
        <MembersTable
          members={members}
          workspaceId={id}
          isOwner={isOwner}
          currentUserId={currentUserId}
          onChange={refreshMembers}
        />
      </div>
    </div>
  )
}
