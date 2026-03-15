import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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

  if (!workspace || !id) return null

  const isOwner = workspace.role === 'owner'

  return (
    <div className="page">
      <div className="page-header">
        <a href="/" className="btn btn-secondary btn-sm">← Back</a>
        <h1 className="page-title">{workspace.name}</h1>
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
