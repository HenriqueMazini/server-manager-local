import { useEffect, useRef, useState } from 'react'
import type { ReplyAlert } from '../alerts'
import { shortPath } from '../format'
import { cx, Icon } from './ui'

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (!(m >= 1)) return 'agora'
  if (m < 60) return `há ${m} min`
  return `há ${Math.floor(m / 60)}h ${m % 60}min`
}

// Sino do topo: contador, animação quando chega alerta novo e lista com fechar.
export function AlertBell({
  alerts,
  ring,
  onDismiss,
  onDismissAll,
  onOpenSessions,
}: {
  alerts: ReplyAlert[]
  ring: number
  onDismiss: (pid: number) => void
  onDismissAll: () => void
  onOpenSessions: () => void
}) {
  const [open, setOpen] = useState(false)
  const [shaking, setShaking] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const n = alerts.length

  useEffect(() => {
    if (!ring) return
    setShaking(true)
    const t = setTimeout(() => setShaking(false), 1200)
    return () => clearTimeout(t)
  }, [ring])

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

  useEffect(() => {
    if (!n) setOpen(false)
  }, [n])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={n ? `${n} ${n === 1 ? 'sessão aguardando resposta' : 'sessões aguardando resposta'}` : 'Nenhum alerta'}
        title={n ? 'Sessões do Claude aguardando resposta' : 'Nenhum alerta'}
        className={cx(
          'relative grid size-11 place-items-center rounded-xl border transition-colors sm:size-[38px] sm:rounded-[10px]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on',
          n ? 'border-info/40 bg-info/10 text-info-ink' : 'border-edge bg-surface text-faint hover:text-fg',
        )}
      >
        <Icon name="bell" className={cx('size-[17px]', shaking && 'bell-ring')} />
        {n > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[#3b82f6] px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-bg">
            {n}
          </span>
        )}
      </button>

      {open && n > 0 && (
        <div className="absolute right-0 top-12 z-30 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <span className="flex-1 text-xs font-medium uppercase tracking-[0.12em] text-faint">Aguardando resposta</span>
            <button type="button" onClick={onDismissAll} className="rounded-md px-2 py-0.5 text-xs text-muted hover:bg-raised hover:text-fg">
              Fechar todos
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.pid} className="flex items-start gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-line/70">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-info" />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onOpenSessions()
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-[11px] text-faint">
                    terminou {ago(a.since)}
                    {a.cwd && <span className="font-mono"> · {shortPath(a.cwd)}</span>}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(a.pid)}
                  aria-label={`Fechar alerta de ${a.name}`}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
