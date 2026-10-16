import { useEffect, useState } from 'react'
import { removeOrphans } from '../api'
import type { Orphan } from '../types'
import { cx, Icon, Spinner, useToast } from './ui'

// Containers de app que o painel criou para um projeto ou app que não existe mais no services.yml.
export function Orphans({ orphans }: { orphans: Orphan[] }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // A confirmação expira sozinha: um clique esquecido não vira remoção depois.
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(t)
  }, [confirming])

  if (!orphans.length) return null

  const remove = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setBusy(true)
    try {
      const n = await removeOrphans()
      toast(n === 1 ? '1 container antigo removido.' : `${n} containers antigos removidos.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const n = orphans.length
  return (
    <section className="rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="infoCircle" className="size-4 shrink-0 text-faint" />
        <h2 className="min-w-0 flex-1 text-sm font-medium">
          {n === 1 ? '1 container antigo sem projeto' : `${n} containers antigos sem projeto`}
        </h2>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className={cx(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            confirming ? 'bg-danger text-white hover:opacity-90' : 'border border-line text-muted hover:text-fg',
          )}
        >
          {busy && <Spinner className="size-3" />}
          {confirming ? 'Confirmar remoção' : n === 1 ? 'Remover' : 'Remover todos'}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-faint">
        Apps que o painel criou para um projeto ou app que mudou de nome no services.yml. O código não é tocado: só o
        container sai.
      </p>
      <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted">
        {orphans.map((o) => (
          <li key={o.id} className="flex gap-2">
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className={cx('shrink-0', o.running ? 'text-warn-ink' : 'text-faint')}>{o.running ? 'ligado' : 'parado'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
