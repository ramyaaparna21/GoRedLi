import { useState } from 'react'
import { api } from '../api'
import type { Member } from '../types'

interface Props {
  members: Member[]
  workspaceId: string
  isOwner: boolean
  currentUserId: string
  onChange: () => void
}

export default function MembersTable({ members, workspaceId, isOwner, currentUserId, onChange }: Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'user' | 'owner'>('user')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setAdding(true)
    setAddError('')
    try {
      await api.addMember(workspaceId, { email: email.trim(), role })
      setEmail('')
      onChange()
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAdding(false)
    }
  }

  async function handleRoleChange(member: Member, newRole: 'user' | 'owner') {
    try {
      await api.updateMember(workspaceId, member.id, newRole)
      onChange()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  async function handleRemove(member: Member) {
    if (!confirm(`Remove ${member.email}?`)) return
    try {
      await api.deleteMember(workspaceId, member.id)
      onChange()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr><td colSpan={isOwner ? 3 : 2} className="empty">No members</td></tr>
            )}
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.email}
                  {m.userId === currentUserId && (
                    <span style={{ color: '#9ca3af', marginLeft: 6 }}>(you)</span>
                  )}
                </td>
                <td>
                  {isOwner ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m, e.target.value as 'user' | 'owner')}
                      style={{ width: 'auto' }}
                    >
                      <option value="user">user</option>
                      <option value="owner">owner</option>
                    </select>
                  ) : (
                    <span className={`badge badge-${m.role}`}>{m.role}</span>
                  )}
                </td>
                {isOwner && (
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleRemove(m)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isOwner && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {addError && <p className="error-msg">{addError}</p>}
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'owner')} style={{ width: 'auto' }}>
            <option value="user">user</option>
            <option value="owner">owner</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={adding || !email.trim()}>
            {adding ? 'Adding…' : 'Add member'}
          </button>
        </form>
      )}
    </>
  )
}
