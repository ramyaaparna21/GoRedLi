import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import type { Workspace } from '../types'

function SortableRow({ ws }: { ws: Workspace }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ws.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const navigate = useNavigate()

  return (
    <tr ref={setNodeRef} style={style}>
      <td style={{ width: 32 }}>
        <span className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          ⠿
        </span>
      </td>
      <td>{ws.name}</td>
      <td>
        <span className={`badge badge-${ws.role}`}>{ws.role}</span>
      </td>
      <td>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => navigate(`/workspaces/${ws.id}`)}
        >
          Manage
        </button>
      </td>
    </tr>
  )
}

interface Props {
  workspaces: Workspace[]
  onChange: (updated: Workspace[]) => void
}

export default function WorkspaceTable({ workspaces, onChange }: Props) {
  const sensors = useSensors(useSensor(PointerSensor))
  const navigate = useNavigate()

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIdx = workspaces.findIndex((w) => w.id === active.id)
      const newIdx = workspaces.findIndex((w) => w.id === over.id)
      onChange(arrayMove(workspaces, oldIdx, newIdx))
    }
  }

  return (
    <div className="table-wrap">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>Name</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {workspaces.map((ws) => (
                <SortableRow key={ws.id} ws={ws} />
              ))}
              <tr>
                <td colSpan={4}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigate('/workspaces/new')}
                    style={{ margin: '4px 0' }}
                  >
                    + Add workspace
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </SortableContext>
      </DndContext>
    </div>
  )
}
