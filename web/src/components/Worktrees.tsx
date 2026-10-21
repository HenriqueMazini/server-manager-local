import { useEffect, useRef, useState } from 'react'
import { removeWorktrees } from '../api'
import type { Project } from '../types'
import { bytes, shortPath } from '../format'
import { cx, Icon, Spinner, useToast } from './ui'

// Nome curto: tira o nome da pasta do projeto principal ("loja-novo-login" -> "novo-login").
function shortName(p: Project): string {
  const base = p.worktree?.mainDir.split('/').pop() ?? ''
  return base && p.key.startsWith(base + '-') ? p.key.slice(base.length + 1) : p.key
}

// Linha curta embaixo do projeto principal na tabela de projetos; a limpeza fica em Sistema e limpeza.
export function WorktreeSummary({ items, onManage }: { items: Project[]; onManage: () => void }) {
  const removed = items.filter((p) => p.worktree?.missing).length
  const mem = items.reduce((n, p) => n + p.memUsed, 0)
  return (
    <div role="row" className="flex items-center gap-2.5 border-t border-dashed border-edge bg-soft py-[9px] pb-[11px] pl-[50px] pr-4">
      <Icon name="branch" className="size-3.5 shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {items.length} {items.length === 1 ? 'worktree' : 'worktrees'}
        {mem > 0 && <> · {bytes(mem)}</>}
        {removed > 0 && <span className="text-warn-ink"> · {removed} já {removed === 1 ? 'removida' : 'removidas'} do git</span>}
      </span>
      <button type="button" onClick={onManage} className="shrink-0 text-xs font-medium text-fg hover:underline hover:underline-offset-4">
        Gerenciar
      </button>
    </div>
  )
}

const VISIBLE = 4

// Cartão de limpeza em Sistema e limpeza: as worktrees já removidas do git; sem nenhuma, todas.
export function WorktreeCleanup({ main, items }: { main: string; items: Project[] }) {
  const [all, setAll] = useState(false)
  const [confirm, setConfirm] = useState<Project[] | null>(null)
  const removed = items.filter((p) => p.worktree?.missing)
  const list = removed.length ? removed : items
  const shown = all ? list : list.slice(0, VISIBLE)
  const rest = list.length - shown.length
  const containers = list.reduce((n, p) => n + p.total, 0)
  const mem = list.reduce((n, p) => n + p.memUsed, 0)
  return (
    <article className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2.5 px-[18px] py-3.5">
        <Icon name="branch" className={cx('size-4', removed.length ? 'text-warn-ink' : 'text-faint')} />
        <span className="min-w-0 flex-[1_1_240px] font-semibold">
          {removed.length ? 'Worktrees removidas do git' : 'Worktrees'} <span className="font-normal text-faint">· {main}</span>
        </span>
        <button
          type="button"
          onClick={() => setConfirm(list)}
          className="rounded-lg border border-danger/35 bg-danger/10 px-3 py-[7px] text-xs font-semibold text-danger transition-colors hover:bg-danger/15"
        >
          {list.length === 1 ? 'Remover' : `Remover ${removed.length ? 'as' : 'todas as'} ${list.length}`}
        </button>
      </header>
      <ul>
        {shown.map((p) => (
          <li key={p.key} className="flex items-center gap-3 border-t border-divider px-[18px] py-2.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={p.worktree?.branch ? `branch ${p.worktree.branch}` : shortPath(p.dir)}>
              {shortName(p)}
            </span>
            <span className="w-24 text-xs text-faint">
              {p.total} {p.total === 1 ? 'container' : 'containers'}
            </span>
            <span className="tabular w-[60px] text-right font-mono text-xs">{p.memUsed > 0 ? bytes(p.memUsed) : '—'}</span>
            <button
              type="button"
              onClick={() => setConfirm([p])}
              aria-label={`Remover os containers da worktree ${shortName(p)}`}
              title="Remover os containers desta worktree"
              className="grid size-[30px] shrink-0 place-items-center rounded-lg border border-edge text-muted transition-colors hover:border-danger/40 hover:text-danger"
            >
              <Icon name="trash" className="size-[13px]" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-divider px-[18px] py-2.5 text-xs text-faint">
        {rest > 0 && (
          <button type="button" onClick={() => setAll(true)} className="hover:text-fg">
            + {rest} {rest === 1 ? 'outra' : 'outras'} ·
          </button>
        )}
        {all && list.length > VISIBLE && (
          <button type="button" onClick={() => setAll(false)} className="hover:text-fg">
            Mostrar menos ·
          </button>
        )}
        <span>
          {containers} containers{mem > 0 ? `, ${bytes(mem)}` : ''} no total
        </span>
        {removed.length > 0 && removed.length < items.length && (
          <button type="button" onClick={() => setConfirm(items)} className="ml-auto text-muted hover:text-danger">
            Remover todas as {items.length} worktrees
          </button>
        )}
      </div>
      {confirm && <ConfirmRemove items={confirm} main={main} onClose={() => setConfirm(null)} />}
    </article>
  )
}

function ConfirmRemove({ items, main, onClose }: { items: Project[]; main: string; onClose: () => void }) {
  const [volumes, setVolumes] = useState(false)
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const toast = useToast()
  const containers = items.reduce((n, p) => n + p.total, 0)
  const mem = items.reduce((n, p) => n + p.memUsed, 0)

  useEffect(() => {
    cancel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const run = async () => {
    setBusy(true)
    try {
      const res = await removeWorktrees(items.map((p) => p.key), volumes)
      const c = res.reduce((n, r) => n + r.containers, 0)
      const v = res.reduce((n, r) => n + r.volumes, 0)
      toast(`${c} containers removidos${volumes ? ` e ${v} volumes apagados` : ''}.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
    }
  }

  const one = items.length === 1
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="wt-title" className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
            <Icon name="trash" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="wt-title" className="text-base font-semibold tracking-tight">
              {one ? `Remover a worktree "${shortName(items[0])}"?` : `Remover ${items.length} worktrees de ${main}?`}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {containers} containers e as redes {one ? 'dela' : 'delas'} serão removidos{mem > 0 ? `, liberando cerca de ${bytes(mem)}` : ''}. O código das worktrees e o
              projeto principal não são tocados.
            </p>
            {!one && (
              <ul className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-line/70 px-3 py-1.5 font-mono text-[11px] text-faint">
                {items.map((p) => (
                  <li key={p.key} className="truncate">
                    {shortName(p)}
                    {p.worktree?.missing && <span className="text-warn-ink"> · removida do git</span>}
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={volumes} onChange={(e) => setVolumes(e.target.checked)} className="mt-0.5 accent-[var(--danger)]" />
              <span>
                Apagar também os volumes
                <span className="block text-xs text-faint">Os bancos e arquivos guardados por {one ? 'esta worktree' : 'estas worktrees'}. Não dá para desfazer.</span>
              </span>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-raised/40 px-5 py-3">
          <button ref={cancel} type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-fg hover:border-faint/60">
            Cancelar
          </button>
          <button type="button" onClick={run} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
            {busy && <Spinner className="size-3.5" />}
            {one ? 'Remover' : `Remover ${items.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
