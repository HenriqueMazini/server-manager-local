import { useEffect, useRef, useState } from 'react'
import { stopDevRun } from '../api'
import type { DevRun } from '../types'
import { bytes } from '../format'
import { cx, Icon, Spinner, useToast } from './ui'

export type DevGroup = { key: string; label: string; projectKey?: string; dir: string; runs: DevRun[]; memUsed: number; orphan: boolean }

// Junta os servidores fora do Docker por projeto e worktree: "Loja · nova-vitrine".
export function devGroups(runs: DevRun[]): DevGroup[] {
  const map = new Map<string, DevGroup>()
  for (const r of runs) {
    const key = `${r.projectKey ?? r.projectName}|${r.worktree ?? ''}`
    const g = map.get(key) ?? {
      key,
      label: r.worktree ? `${r.projectName} · ${r.worktree}` : r.projectName,
      projectKey: r.projectKey,
      dir: r.dir,
      runs: [],
      memUsed: 0,
      orphan: false,
    }
    g.runs.push(r)
    g.memUsed += r.memUsed
    g.orphan ||= r.orphan
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => b.memUsed - a.memUsed)
}

// Linha embaixo do projeto na tabela de projetos: o que roda dele fora do Docker.
export function DevRunsSummary({ runs, onManage }: { runs: DevRun[]; onManage: () => void }) {
  const groups = devGroups(runs)
  const mem = runs.reduce((n, r) => n + r.memUsed, 0)
  const orphan = runs.some((r) => r.orphan)
  return (
    <div role="row" className="flex items-center gap-2.5 border-t border-dashed border-edge bg-soft py-[9px] pb-[11px] pl-[50px] pr-4">
      <Icon name="terminal" className={cx('size-3.5 shrink-0', orphan ? 'text-danger' : 'text-faint')} />
      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        <span className={orphan ? 'text-danger' : 'text-warn-ink'}>fora do painel</span>
        {' · '}
        {groups.map((g) => g.runs[0].worktree ?? 'pasta do projeto').join(', ')} · {runs.map((r) => r.command).join(', ')} · {bytes(mem)}
        {orphan && <span className="text-danger"> · sem terminal</span>}
      </span>
      <button type="button" onClick={onManage} className="shrink-0 text-xs font-medium text-fg hover:underline hover:underline-offset-4">
        Ver
      </button>
    </div>
  )
}

// Cartão em Sistema e limpeza: servidores rodando direto no computador, com o botão de encerrar.
export function DevRunsCard({ runs, canStop }: { runs: DevRun[]; canStop: boolean }) {
  const [confirm, setConfirm] = useState<DevRun[] | null>(null)
  if (!runs.length) return null
  const groups = devGroups(runs)
  const total = runs.reduce((n, r) => n + r.memUsed, 0)
  const orphans = runs.filter((r) => r.orphan).length
  return (
    <article className={cx('overflow-hidden rounded-[14px] border bg-surface', orphans ? 'border-danger/30' : 'border-line')}>
      <header className="flex flex-wrap items-center gap-2.5 px-[18px] py-3.5">
        <Icon name="terminal" className={cx('size-4', orphans ? 'text-danger' : 'text-faint')} />
        <span className="min-w-0 flex-[1_1_240px]">
          <span className="block font-semibold">Rodando fora do painel</span>
          <span className="mt-0.5 block text-xs text-faint">
            Servidores iniciados direto no computador (npm run dev…), fora do Docker · {bytes(total)}
            {orphans > 0 && <span className="text-danger"> · {orphans} sem terminal</span>}
          </span>
        </span>
      </header>
      {groups.map((g) => (
        <section key={g.key} className="border-t border-divider">
          <div className="flex flex-wrap items-baseline gap-x-2.5 px-[18px] pt-3">
            <span className="text-sm font-semibold">{g.label}</span>
            <span className="truncate font-mono text-[11px] text-faint">{g.dir}</span>
          </div>
          <ul className="pb-1.5">
            {g.runs.map((r) => (
              <li key={r.pid} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-[18px] py-2">
                <span className="min-w-0 flex-[1_1_240px]">
                  <span className="block truncate font-mono text-xs">{r.command}</span>
                  <span className="block truncate text-[11px] text-faint">
                    {r.programs.filter((p) => p !== 'npm').join(', ') || 'processo'} · {r.procs} {r.procs === 1 ? 'processo' : 'processos'} · pid {r.pid}
                  </span>
                </span>
                {r.orphan ? (
                  <span
                    className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger"
                    title="Quem iniciou (o terminal ou a sessão) já fechou e o servidor continuou rodando, preso ao sistema."
                  >
                    sem terminal
                  </span>
                ) : (
                  <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted" title="Ainda aberto num terminal: dá para parar por lá com Ctrl+C.">
                    num terminal
                  </span>
                )}
                <span className="tabular w-16 text-right font-mono text-xs">{bytes(r.memUsed)}</span>
                {canStop && (
                  <button
                    type="button"
                    onClick={() => setConfirm([r])}
                    aria-label={`Encerrar ${r.command}`}
                    title="Encerrar este servidor e os processos dele"
                    className="grid size-8 shrink-0 place-items-center rounded-lg border border-edge text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  >
                    <Icon name="power" className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {canStop && orphans > 1 && (
        <div className="border-t border-divider px-[18px] py-2.5">
          <button type="button" onClick={() => setConfirm(runs.filter((r) => r.orphan))} className="text-xs font-medium text-danger hover:underline hover:underline-offset-4">
            Encerrar os {orphans} sem terminal
          </button>
        </div>
      )}
      {!canStop && (
        <p className="border-t border-divider px-[18px] py-2.5 text-xs text-faint">
          Para encerrar pelo painel, o ajudante da máquina precisa estar rodando (scripts/install.sh). Ou rode <code className="font-mono">kill {runs.map((r) => r.pid).join(' ')}</code>.
        </p>
      )}
      {confirm && <ConfirmStop runs={confirm} onClose={() => setConfirm(null)} />}
    </article>
  )
}

function ConfirmStop({ runs, onClose }: { runs: DevRun[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const toast = useToast()
  const mem = runs.reduce((n, r) => n + r.memUsed, 0)
  const one = runs.length === 1

  useEffect(() => {
    cancel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const run = async () => {
    setBusy(true)
    let freed = 0
    try {
      for (const r of runs) {
        await stopDevRun(r.pid)
        freed += r.memUsed
      }
      toast(`${one ? 'Servidor encerrado' : `${runs.length} servidores encerrados`}: cerca de ${bytes(freed)} liberados.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="stop-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
            <Icon name="power" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="stop-title" className="text-base font-semibold tracking-tight">
              {one ? 'Encerrar este servidor?' : `Encerrar ${runs.length} servidores?`}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {one ? 'O processo e todos os filhos dele recebem o sinal para fechar' : 'Cada processo e todos os filhos recebem o sinal para fechar'}, liberando cerca de{' '}
              {bytes(mem)}. O código não é tocado; para voltar, rode o comando de novo na pasta.
            </p>
            <ul className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-line/70 px-3 py-1.5 font-mono text-[11px] text-faint">
              {runs.map((r) => (
                <li key={r.pid} className="truncate">
                  {r.dir} · {r.command}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-raised/40 px-5 py-3">
          <button ref={cancel} type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-fg hover:border-faint/60">
            Cancelar
          </button>
          <button type="button" onClick={run} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
            {busy && <Spinner className="size-3.5" />}
            Encerrar
          </button>
        </div>
      </div>
    </div>
  )
}
