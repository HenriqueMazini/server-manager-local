import { useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot } from '../types'
import type { Page } from '../pages'
import { shortPath } from '../format'
import { cx, Icon } from './ui'

type Result = { key: string; kind: string; title: string; detail: string; run: () => void }

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// Busca de projetos, sessões do Claude e portas. Ctrl K (ou Cmd K) foca o campo.
export function Search({ snap, go, openProject }: { snap: Snapshot; go: (p: Page) => void; openProject: (key: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
        setOpen(true)
      }
    }
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [])

  const results = useMemo<Result[]>(() => {
    const t = norm(q.trim())
    if (!t) return []
    const out: Result[] = []
    for (const p of snap.projects) {
      if (norm(`${p.name} ${p.alias ?? ''} ${p.key}`).includes(t))
        out.push({ key: `p:${p.key}`, kind: 'Projeto', title: p.alias ? `${p.name} (${p.alias})` : p.name, detail: p.running ? 'ligado' : 'desligado', run: () => openProject(p.key) })
    }
    for (const s of snap.claude?.sessions ?? []) {
      if (norm(`${s.name} ${s.cwd ?? ''}`).includes(t))
        out.push({ key: `s:${s.pid}`, kind: 'Sessão', title: s.name, detail: shortPath(s.cwd), run: () => go('sessoes') })
    }
    const seen = new Set<number>()
    for (const p of snap.ports) {
      if (seen.has(p.hostPort) || !String(p.hostPort).startsWith(t)) continue
      seen.add(p.hostPort)
      out.push({
        key: `port:${p.hostPort}`,
        kind: 'Porta',
        title: String(p.hostPort),
        detail: p.kind === 'host' ? 'processo do computador' : `${p.label ?? p.containerName} · ${p.projectName}`,
        run: () => (p.kind === 'container' && p.projectKey ? openProject(p.projectKey) : go('sistema')),
      })
    }
    return out.slice(0, 8)
  }, [q, snap, go, openProject])

  const pick = (r: Result) => {
    r.run()
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div ref={box} className="relative hidden w-[300px] max-w-full sm:block">
      <label className="flex h-[38px] items-center gap-2 rounded-[10px] border border-edge bg-surface px-3 text-faint focus-within:border-faint/60">
        <Icon name="search" className="size-[15px] shrink-0" />
        <span className="sr-only">Buscar</span>
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
            else if (e.key === 'Enter' && results[active]) pick(results[active])
            else if (e.key === 'Escape') {
              setQ('')
              setOpen(false)
              input.current?.blur()
            }
          }}
          placeholder="Buscar projeto, sessão ou porta"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="shrink-0 rounded-[5px] border border-edge px-1.5 py-0.5 font-mono text-[11px]">Ctrl K</kbd>
      </label>
      {open && q.trim() && (
        <ul className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-2xl">
          {results.length === 0 ? (
            <li className="px-3.5 py-3 text-sm text-faint">Nada encontrado.</li>
          ) : (
            results.map((r, i) => (
              <li key={r.key}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r)}
                  className={cx('flex w-full items-center gap-3 px-3.5 py-2 text-left', i === active && 'bg-raised')}
                >
                  <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-faint">{r.kind}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.title}</span>
                    <span className="block truncate text-[11px] text-faint">{r.detail}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
