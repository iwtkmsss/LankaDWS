import { ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Upload } from 'lucide-react'
import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Menu, MenuItem } from '../../shared/ui'

export interface DriveCrumb {
  key: string
  label: ReactNode
  /** Plain-text name for the tooltip and accessible name. */
  name: string
  onOpen: () => void
}

interface Props {
  crumbs: DriveCrumb[]
  /** Folder actions shown in the current folder's menu; without them the current folder is plain text. */
  onNewFolder?: () => void
  onUpload?: () => void
}

/** Ancestors that stay visible on each side of a collapsed path. */
const LEADING = 1
const TRAILING = 2

function HiddenCrumbs({ crumbs }: { crumbs: DriveCrumb[] }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <div className="drive-path__menu">
      <button
        ref={trigger}
        type="button"
        className="drive-path__crumb drive-path__more"
        aria-label="Показати приховані папки"
        title="Показати приховані папки"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      ><MoreHorizontal size={18} aria-hidden /></button>
      {open && (
        <Menu open className="drive-item__menu-body drive-path__menu-body" label="Приховані папки" triggerRef={trigger} onClose={() => setOpen(false)}>
          {crumbs.map((crumb) => (
            <MenuItem key={crumb.key} title={crumb.name} onClick={() => { setOpen(false); crumb.onOpen() }}>
              <span className="drive-path__menu-label">{crumb.label}</span>
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  )
}

function CurrentFolder({ crumb, onNewFolder, onUpload }: { crumb: DriveCrumb; onNewFolder?: () => void; onUpload?: () => void }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  if (!onNewFolder && !onUpload) {
    return <span className="drive-path__current" aria-current="page" title={crumb.name}><span className="drive-path__label">{crumb.label}</span></span>
  }
  const run = (action?: () => void) => { setOpen(false); action?.() }
  return (
    <div className="drive-path__menu">
      <button
        ref={trigger}
        type="button"
        className="drive-path__crumb drive-path__current"
        aria-current="page"
        aria-expanded={open}
        aria-haspopup="menu"
        title={crumb.name}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="drive-path__label">{crumb.label}</span>
        <ChevronDown size={18} aria-hidden />
      </button>
      {open && (
        <Menu open className="drive-item__menu-body drive-path__menu-body" label={`Дії: ${crumb.name}`} triggerRef={trigger} onClose={() => setOpen(false)}>
          {onNewFolder && <MenuItem onClick={() => run(onNewFolder)}><FolderPlus size={15} aria-hidden />Нова папка</MenuItem>}
          {onUpload && <MenuItem onClick={() => run(onUpload)}><Upload size={15} aria-hidden />Завантажити файли</MenuItem>}
        </Menu>
      )}
    </div>
  )
}

/**
 * Drive path: ancestors are muted links, the current folder is emphasised and opens its actions.
 * Long paths keep the root and the last two levels and fold the middle into a menu.
 */
export function DriveBreadcrumbs({ crumbs, onNewFolder, onUpload }: Props) {
  const current = crumbs.at(-1)
  if (!current) return null
  const ancestors = crumbs.slice(0, -1)
  const collapse = ancestors.length > LEADING + TRAILING
  const hidden = collapse ? ancestors.slice(LEADING, ancestors.length - TRAILING + 1) : []
  const shown = collapse ? [...ancestors.slice(0, LEADING), ...ancestors.slice(ancestors.length - TRAILING + 1)] : ancestors
  const separator = <ChevronRight className="drive-path__separator" size={18} aria-hidden />

  return (
    <nav className="drive-path" aria-label="Шлях">
      {shown.map((crumb, index) => (
        <Fragment key={crumb.key}>
          {index === LEADING && collapse && <><HiddenCrumbs crumbs={hidden} />{separator}</>}
          <button type="button" className="drive-path__crumb" title={crumb.name} onClick={crumb.onOpen}>
            <span className="drive-path__label">{crumb.label}</span>
          </button>
          {separator}
        </Fragment>
      ))}
      <CurrentFolder crumb={current} onNewFolder={onNewFolder} onUpload={onUpload} />
    </nav>
  )
}
