import type { ClaudeSummary, DevRun, HostApp, HostMem, Project } from '../types'
import { devGroups } from './DevRuns'
import { CLAUDE_KEY } from '../colors'
import type { Sample } from '../useSnapshot'
import { useState, type ReactNode } from 'react'
import { cx } from './ui'
import { bytes } from '../format'

export type MemoryItem = { key: string; name: string; memUsed: number; color?: string; outside?: boolean }

// O que ocupa memória entre os ambientes: sessões do Claude, cada projeto, numa fatia só as worktrees de
// cada projeto e os servidores rodando fora do Docker, por projeto e worktree, na cor do projeto.
export function memoryItems(projects: Project[], claude: ClaudeSummary, devRuns: DevRun[] = [], colors: Record<string, string> = {}): MemoryItem[] {
  const items = [
    ...(claude.memUsed > 0 ? [{ key: CLAUDE_KEY, name: 'Sessões do Claude', memUsed: claude.memUsed }] : []),
    ...projects.filter((p) => !p.worktree).map((p) => ({ key: p.key, name: p.name, memUsed: p.memUsed })),
    ...[...new Set(projects.filter((p) => p.worktree).map((p) => p.worktree!.mainName))].map((name) => {
      const items = projects.filter((p) => p.worktree?.mainName === name)
      return { key: `wt:${name}`, name: `${name} · ${items.length} worktrees`, memUsed: items.reduce((n, p) => n + p.memUsed, 0) }
    }),
    ...devGroups(devRuns).map((g) => ({
      key: `dev:${g.key}`,
      name: g.label,
      memUsed: g.memUsed,
      color: (g.projectKey && colors[g.projectKey]) || 'var(--faint)',
      outside: true,
    })),
  ]
  return items.filter((p) => p.memUsed > 0).sort((a, b) => b.memUsed - a.memUsed)
}

const colorOf = (colors: Record<string, string>, item: MemoryItem) => item.color ?? colors[item.key] ?? 'var(--faint)'

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
          style={{ flexGrow: p.memUsed, flexBasis: 0, minWidth: 4, background: colorOf(colors, p) }}
        />
      ))}
    </div>
  )
}

type Tab = 'dev' | 'pc' | 'swap'

const TABS: { key: Tab; label: string }[] = [
  { key: 'dev', label: 'Desenvolvimento' },
  { key: 'pc', label: 'Computador' },
  { key: 'swap', label: 'Swap' },
]

// Quantos itens cada aba mostra.
const TOP = 7

// Uma linha do quadro: ponto, nome, valor e barra proporcional ao maior item. split divide a barra em
// duas partes (computador: direto no computador e em containers).
function Row({ color, name, badge, value, pct, split, sub }: { color: string; name: string; badge?: string; value: number; pct: number; split?: number; sub?: string }) {
  return (
    <li>
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 truncate text-body">{name}</span>
        {badge && (
          <span className="shrink-0 rounded-full bg-warn/10 px-1.5 py-px text-[10px] text-warn-ink" title="Rodando direto no computador, fora do Docker. Veja em Sistema e limpeza.">
            {badge}
          </span>
        )}
        <span className="flex-1" />
        <span className="tabular shrink-0 font-mono text-fg">{bytes(value)}</span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-track">
        <div className="flex h-full overflow-hidden rounded-full transition-[width] duration-700" style={{ width: `${Math.max(pct, 1)}%` }}>
          <div className="h-full" style={{ flexGrow: 1 - (split ?? 0), background: color }} />
          {!!split && <div className="h-full bg-faint/40" style={{ flexGrow: split }} />}
        </div>
      </div>
      {sub && <p className="mt-1 truncate text-[11px] text-faint">{sub}</p>}
    </li>
  )
}

function readTab(): Tab {
  try {
    const t = localStorage.getItem('sm-memoria-aba')
    return t === 'pc' || t === 'swap' ? t : 'dev'
  } catch {
    return 'dev'
  }
}

// Um quadro só para "quem ocupa memória", com abas: os ambientes de desenvolvimento, o computador
// inteiro e o swap. Mesmo desenho nas três.
export function MemoryPanel({
  items,
  colors,
  history,
  host,
  apps,
  swapApps,
  devRuns,
  swapAlert,
  onSwapDetails,
}: {
  items: MemoryItem[]
  colors: Record<string, string>
  history: Sample[]
  host: HostMem
  apps: HostApp[]
  swapApps: HostApp[]
  devRuns: DevRun[]
  swapAlert?: boolean
  onSwapDetails: () => void
}) {
  const [tab, setTab] = useState<Tab>(readTab)
  const choose = (t: Tab) => {
    setTab(t)
    try {
      localStorage.setItem('sm-memoria-aba', t)
    } catch {
      /* sem storage: vale só nesta aba */
    }
  }

  let list: ReactNode
  let footer: ReactNode
  if (tab === 'dev') {
    const max = items[0]?.memUsed ?? 0
    const values = history.map((s) => s.dev)
    list = items.length ? (
      items.slice(0, TOP + 3).map((p) => (
        <Row key={p.key} color={colorOf(colors, p)} name={p.name} badge={p.outside ? 'fora do painel' : undefined} value={p.memUsed} pct={max ? (p.memUsed / max) * 100 : 0} />
      ))
    ) : (
      <p className="text-sm text-faint">Nenhum ambiente ligado. Nada de desenvolvimento ocupando memória agora.</p>
    )
    footer =
      values.length > 1
        ? `Últimos ${Math.max(1, Math.round((history[history.length - 1].t - history[0].t) / 60000))} min: de ${bytes(Math.min(...values))} a ${bytes(Math.max(...values))}.`
        : null
  } else if (tab === 'pc') {
    // Quais servidores fora do Docker estão dentro de cada aplicativo ("Next.js" inclui o Loja · nova-vitrine).
    const outsideOf = (name: string) =>
      devGroups(devRuns.filter((r) => r.programs.includes(name)))
        .map((g) => g.label)
        .join(', ')
    const top = apps
      .filter((a) => a.name !== 'Outros' && a.memUsed > 0)
      .sort((a, b) => b.memUsed - a.memUsed)
      .slice(0, TOP)
    const max = top[0]?.memUsed ?? 0
    list = top.map((a) => {
      const inC = a.inContainers ?? 0
      const out = outsideOf(a.name)
      const sub = [out && `fora do painel: ${out}`, inC > 0 && `${bytes(inC)} em containers`].filter(Boolean).join(' · ')
      return <Row key={a.name} color="var(--muted)" name={a.name} value={a.memUsed} pct={max ? (a.memUsed / max) * 100 : 0} split={a.memUsed ? inC / a.memUsed : 0} sub={sub || undefined} />
    })
    footer = (
      <>
        <span className="flex flex-wrap gap-x-3.5 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-muted" />
            direto no computador
          </span>
          <span className="flex items-center gap-1.5" title="Já aparece nos projetos, na aba Desenvolvimento.">
            <span className="size-2 rounded-[2px] bg-faint/40" />
            em containers
          </span>
        </span>
        <span className="mt-1 block">
          {bytes(host.used)} em uso de {bytes(host.total)} · {bytes(host.available)} livre.
        </span>
      </>
    )
  } else {
    const top = swapApps.filter((a) => a.name !== 'Outros' && (a.swap ?? 0) > 0).slice(0, TOP)
    const inProcs = swapApps.reduce((n, a) => n + (a.swap ?? 0), 0)
    const shared = Math.max(host.swapUsed - inProcs, 0)
    const rows = [...top.map((a) => ({ name: a.name, v: a.swap ?? 0, color: 'var(--muted)' })), ...(shared > 0 ? [{ name: 'Memória compartilhada e tmpfs', v: shared, color: 'var(--faint)' }] : [])].sort(
      (a, b) => b.v - a.v,
    )
    const max = rows[0]?.v ?? 0
    list = host.swapTotal ? (
      rows.length ? (
        rows.map((r) => <Row key={r.name} color={r.color} name={r.name} value={r.v} pct={max ? (r.v / max) * 100 : 0} />)
      ) : (
        <p className="text-sm text-faint">Nada no swap.</p>
      )
    ) : (
      <p className="text-sm text-faint">Este computador não tem swap.</p>
    )
    footer = host.swapTotal ? (
      <>
        {bytes(host.swapUsed)} de {bytes(host.swapTotal)} no swap · o sistema encerra processos a partir de 90%.{' '}
        <button type="button" onClick={onSwapDetails} className="text-fg underline-offset-2 hover:underline">
          Detalhes e como esvaziar
        </button>
      </>
    ) : null
  }

  return (
    <section aria-labelledby="mem-title" className="min-w-0 rounded-[14px] border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-[18px] py-3">
        <h2 id="mem-title" className="flex-1 text-sm font-semibold">
          Memória
        </h2>
        <div role="tablist" aria-label="Memória" className="flex rounded-[10px] border border-edge bg-bg p-[3px]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => choose(t.key)}
              className={cx('flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-xs transition-colors', tab === t.key ? 'bg-raised font-medium text-fg' : 'text-muted hover:text-fg')}
            >
              {t.label}
              {t.key === 'swap' && swapAlert && <span className="size-1.5 rounded-full bg-warn" aria-label="atenção" />}
            </button>
          ))}
        </div>
      </header>
      <ul className="flex flex-col gap-3 px-[18px] pb-4 pt-3.5">{list}</ul>
      {footer && <div className="border-t border-divider px-[18px] py-3 text-xs text-faint">{footer}</div>}
    </section>
  )
}
