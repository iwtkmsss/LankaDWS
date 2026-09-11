import type { TaskOption } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { GitBranch, LoaderCircle, Plus } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { AsyncTaskCombobox } from '../AsyncTaskCombobox'
import { loadTaskCreateOptions, loadTaskHierarchy } from './api'
import type { TaskCreateDraft, UpdateTaskCreateDraft } from './types'

function TaskTreeBranch({
  task,
  childrenByParent,
  selectedParentId,
  onSelect,
}: {
  task: TaskOption
  childrenByParent: Map<string, TaskOption[]>
  selectedParentId: string
  onSelect: (task: TaskOption) => void
}) {
  const children = childrenByParent.get(task.id) ?? []
  const selected = selectedParentId === task.id
  return (
    <li className="task-parent-tree__item" role="treeitem" aria-selected={selected}>
      <div className="task-parent-tree__row">
        <div className="task-parent-tree__task">
          <span className="task-parent-tree__icon"><GitBranch size={16} aria-hidden /></span>
          <span>
            <strong>{task.title}</strong>
            <small>№ {task.number}</small>
          </span>
        </div>
        <span className="task-parent-tree__connector" aria-hidden />
        <button
          type="button"
          className={`task-parent-tree__attach ${selected ? 'is-selected' : ''}`}
          aria-pressed={selected}
          aria-label={`Прив’язати нове завдання до ${task.number} · ${task.title}`}
          onClick={() => onSelect(task)}
        >
          <Plus size={17} aria-hidden />
          <span>{selected ? 'Обране місце' : 'Додати сюди'}</span>
        </button>
      </div>
      {children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <TaskTreeBranch
              key={child.id}
              task={child}
              childrenByParent={childrenByParent}
              selectedParentId={selectedParentId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TaskRelationsSection({
  draft,
  update,
}: {
  draft: TaskCreateDraft
  update: UpdateTaskCreateDraft
}) {
  const [hierarchyTaskId, setHierarchyTaskId] = useState(draft.parentTaskId)
  const searchTasks = useRef(new Map<string, TaskOption>())
  const loadTasks = useCallback(async (search: string, signal: AbortSignal) => {
    const result = await loadTaskCreateOptions(draft.groupId, '', search, signal)
    const tasks = search ? result.tasks : result.tasks.slice(0, 5)
    for (const task of tasks) searchTasks.current.set(task.id, task)
    return tasks.map((task) => ({
      id: task.id,
      label: `${task.number} · ${task.title}`,
    }))
  }, [draft.groupId])
  const hierarchy = useQuery({
    queryKey: ['task-create-hierarchy', hierarchyTaskId],
    queryFn: ({ signal }) => loadTaskHierarchy(hierarchyTaskId, signal),
    enabled: Boolean(hierarchyTaskId),
    retry: false,
  })
  const selectedSearchTask = hierarchy.data?.items.find(
    (task) => task.id === hierarchyTaskId,
  ) ?? searchTasks.current.get(hierarchyTaskId)
  const root = hierarchy.data?.items.find((task) => task.id === hierarchy.data?.rootId)
  const childrenByParent = useMemo(() => {
    const result = new Map<string, TaskOption[]>()
    for (const task of hierarchy.data?.items ?? []) {
      if (!task.parentTaskId) continue
      const children = result.get(task.parentTaskId) ?? []
      children.push(task)
      result.set(task.parentTaskId, children)
    }
    return result
  }, [hierarchy.data])

  function selectParent(task: TaskOption) {
    update((current) => ({
      ...current,
      parentTaskId: task.id,
      projectId: task.projectId ?? '',
      recurrence: null,
    }))
  }

  function changeHierarchyTask(value: string) {
    setHierarchyTaskId(value)
    update((current) => (
      !value || (current.parentTaskId && current.parentTaskId !== value)
        ? { ...current, parentTaskId: '', projectId: '' }
        : current
    ))
  }

  return (
    <div className="task-create-relations-section">
      <AsyncTaskCombobox
        label="Пошук батьківського завдання"
        value={hierarchyTaskId}
        placeholder="Назва або номер завдання"
        selectedOption={selectedSearchTask ? {
          id: selectedSearchTask.id,
          label: `${selectedSearchTask.number} · ${selectedSearchTask.title}`,
        } : null}
        loadOptions={loadTasks}
        onChange={changeHierarchyTask}
        emptyLabel="Завдань не знайдено"
        loadOnOpen
        initialEmptyLabel="Немає нещодавніх завдань"
      />

      {!hierarchyTaskId ? (
        <div className="task-parent-tree-empty">
          <GitBranch size={24} aria-hidden />
          <p>Знайдіть завдання, щоб відкрити його структуру.</p>
        </div>
      ) : hierarchy.isLoading ? (
        <div className="task-parent-tree-state" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden />
          <span>Завантажуємо структуру…</span>
        </div>
      ) : hierarchy.isError || !root ? (
        <div className="task-create-local-error">
          <span>Не вдалося завантажити структуру завдання.</span>
          <button type="button" onClick={() => void hierarchy.refetch()}>Повторити</button>
        </div>
      ) : (
        <div className="task-parent-tree-shell">
          <div className="task-parent-tree" role="tree" aria-label="Структура батьківського завдання">
            <ul role="group">
              <TaskTreeBranch
                task={root}
                childrenByParent={childrenByParent}
                selectedParentId={draft.parentTaskId}
                onSelect={selectParent}
              />
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
