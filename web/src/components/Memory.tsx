import type { ClaudeSummary, Project } from '../types'
import { CLAUDE_KEY } from '../colors'
import type { Sample } from '../useSnapshot'
import { bytes } from '../format'

export type MemoryItem = { key: string; name: string; memUsed: number }

// O que ocupa memória entre os ambientes: sessões do Claude, cada projeto e, numa fatia só, as worktrees de cada projeto.
export function memoryItems(projects: Project[], claude: ClaudeSummary): MemoryItem[] {
  const items = [
    ...(claude.memUsed > 0 ? [{ key: CLAUDE_KEY, name: 'Sessões do Claude', memUsed: claude.memUsed }] : []),
    ...projects.filter((p) => !p.worktree).map((p) => ({ key: p.key, name: p.name, memUsed: p.memUsed })),
    ...[...new Set(projects.filter((p) => p.worktree).map((p) => p.worktree!.mainName))].map((name) => {
      const items = projects.filter((p) => p.worktree?.mainName === name)
      return { key: `wt:${name}`, name: `${name} · ${items.length} worktrees`, memUsed: items.reduce((n, p) => n + p.memUsed, 0) }
    }),
  ]
  return items.filter((p) => p.memUsed > 0).sort((a, b) => b.memUsed - a.memUsed)
}

const colorOf = (colors: Record<string, string>, key: string) => colors[key] ?? 'var(--faint)'

// Barra empilhada com a fatia de cada item, na cor dele.
export function StackBar({ items, colors }: { items: MemoryItem[]; colors: Record<string, string> }) {
  return (
    <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Memória por projeto">
      {items.length === 0 && <div className="h-full flex-1 bg-track" />}
      {items.map((p) => (
        <div
          key={p.key}
          title={`${p.name}: ${bytes(p.memUsed)}`}
          className="h-full transition-[flex-grow] duration-700 ease-out"
          style={{ flexGrow: p.memUsed, flexBasis: 0, minWidth: 4, background: colorOf(colors, p.key) }}
        />
      ))}
    </div>
  )
}

// Ranking de quem ocupa memória, com a variação dos últimos minutos.
export function MemoryBreakdown({ items, colors, history }: { items: MemoryItem[]; colors: Record<string, string>; history: Sample[] }) {
  const max = items[0]?.memUsed ?? 0
  const values = history.map((s) => s.dev)
  return (
    <section aria-labelledby="mem-title" className="min-w-0 flex-[2_1_340px] rounded-[14px] border border-line bg-surface px-[18px] pb-[18px] pt-3.5">
      <header className="mb-3.5 flex flex-wrap items-baseline gap-x-2.5">
        <h2 id="mem-title" className="text-sm font-semibold">
          Quem ocupa memória
        </h2>
        <span className="text-xs text-faint">ambientes de desenvolvimento</span>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-faint">Nenhum ambiente ligado. Nada de desenvolvimento ocupando memória agora.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((p) => (
            <li key={p.key}>
              <div className="flex items-baseline gap-2 text-[13px]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(colors, p.key) }} />
                <span className="min-w-0 flex-1 truncate text-body">{p.name}</span>
                <span className="tabular font-mono text-fg">{bytes(p.memUsed)}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-track">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${max ? Math.max((p.memUsed / max) * 100, 1) : 0}%`, background: colorOf(colors, p.key) }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {values.length > 1 && (
        <p className="mt-4 text-xs text-faint">
          Últimos {Math.max(1, Math.round((history[history.length - 1].t - history[0].t) / 60000))} min: de {bytes(Math.min(...values))} a{' '}
          {bytes(Math.max(...values))}.
        </p>
      )}
    </section>
  )
}
