import { useEffect, useRef, useState } from 'react'
import { cx, Icon } from './ui'

export type ProjectOption = { key: string; label: string; open: number; closed: number }

function counts(o: ProjectOption): string {
  return [o.open ? `${o.open} ${o.open === 1 ? 'aberta' : 'abertas'}` : '', o.closed ? `${o.closed} ${o.closed === 1 ? 'encerrada' : 'encerradas'}` : '']
    .filter(Boolean)
    .join(' · ')
}

// Seletor de projeto das sessões, no visual do painel (a lista nativa do navegador não segue o tema).
export function ProjectPicker({ value, options, onChange }: { value: string | null; options: ProjectOption[]; onChange: (key: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.key === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (key: string | null) => {
    onChange(key)
    setOpen(false)
  }
  const groups = [
    { title: 'Com sessões abertas', items: options.filter((o) => o.open > 0) },
    { title: 'Só encerradas', items: options.filter((o) => o.open === 0) },
  ].filter((g) => g.items.length)
  const item = (selected: boolean) =>
    cx('flex w-full items-baseline gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors', selected ? 'bg-raised text-fg' : 'text-body hover:bg-raised/60')

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          'flex max-w-80 items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] transition-colors',
          current ? 'border-faint/40 bg-raised' : 'border-edge bg-surface hover:border-faint/40',
        )}
      >
        <span className="text-faint">Projeto</span>
        <span className="truncate text-fg">{current?.label ?? 'Todos'}</span>
        <Icon name="chevron" className={cx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" aria-label="Projeto" className="scroll-area absolute left-0 top-11 z-30 max-h-[min(28rem,70vh)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
          <button type="button" role="option" aria-selected={!current} onClick={() => pick(null)} className={item(!current)}>
            <span className="flex-1">Todos os projetos</span>
          </button>
          {groups.map((g) => (
            <div key={g.title} className="mt-1.5 border-t border-line pt-1.5">
              <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.1em] text-faint">{g.title}</div>
              {g.items.map((o) => (
                <button key={o.key} type="button" role="option" aria-selected={o.key === value} onClick={() => pick(o.key)} className={item(o.key === value)}>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="shrink-0 text-[11px] text-faint">{counts(o)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
