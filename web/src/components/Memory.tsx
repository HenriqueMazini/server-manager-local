import type { ClaudeSummary, DevRun, HostApp, HostMem, Project } from '../types'
import { devGroups } from './DevRuns'
import { CLAUDE_KEY } from '../colors'
import type { Sample } from '../useSnapshot'
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

// Ranking de quem ocupa memória, com a variação dos últimos minutos.
export function MemoryBreakdown({ items, colors, history }: { items: MemoryItem[]; colors: Record<string, string>; history: Sample[] }) {
  const max = items[0]?.memUsed ?? 0
  const values = history.map((s) => s.dev)
  return (
    <section aria-labelledby="mem-title" className="min-w-0 flex-1 rounded-[14px] border border-line bg-surface px-[18px] pb-[18px] pt-3.5">
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
                <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(colors, p) }} />
                <span className="min-w-0 truncate text-body">{p.name}</span>
                {p.outside && (
                  <span className="shrink-0 rounded-full bg-warn/10 px-1.5 py-px text-[10px] text-warn-ink" title="Rodando direto no computador, fora do Docker. Veja em Sistema e limpeza.">
                    fora do painel
                  </span>
                )}
                <span className="flex-1" />
                <span className="tabular font-mono text-fg">{bytes(p.memUsed)}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-track">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${max ? Math.max((p.memUsed / max) * 100, 1) : 0}%`, background: colorOf(colors, p) }}
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

// Quantos aplicativos aparecem no quadro do computador.
const TOP_APPS = 6

// Mesmo quadro, para o computador inteiro: os aplicativos que mais ocupam memória.
export function ComputerBreakdown({ host, apps, devRuns = [] }: { host: HostMem; apps: HostApp[]; devRuns?: DevRun[] }) {
  // Quais servidores fora do Docker estão dentro de cada aplicativo ("Next.js" inclui o Loja · nova-vitrine).
  const outsideOf = (name: string) =>
    devGroups(devRuns.filter((r) => r.programs.includes(name)))
      .map((g) => g.label)
      .join(', ')
  const top = apps
    .filter((a) => a.name !== 'Outros' && a.memUsed > 0)
    .sort((a, b) => b.memUsed - a.memUsed)
    .slice(0, TOP_APPS)
  const max = top[0]?.memUsed ?? 0
  return (
    <section aria-labelledby="pc-mem-title" className="min-w-0 flex-1 rounded-[14px] border border-line bg-surface px-[18px] pb-[18px] pt-3.5">
      <header className="mb-3.5 flex flex-wrap items-baseline gap-x-2.5">
        <h2 id="pc-mem-title" className="text-sm font-semibold">
          Quem ocupa memória
        </h2>
        <span className="text-xs text-faint">computador</span>
      </header>
      {top.length === 0 ? (
        <p className="text-sm text-faint">Sem dados dos aplicativos do computador.</p>
      ) : (
        <ul className="flex flex-col gap-3" title="Cada aplicativo soma a memória de todos os seus processos; memória compartilhada entra em cada um.">
          {top.map((a) => (
            <li key={a.name}>
              <div className="flex items-baseline gap-2 text-[13px]">
                <span className="size-2 shrink-0 rounded-full bg-muted" />
                <span className="min-w-0 flex-1 truncate text-body">{a.name}</span>
                <span className="tabular font-mono text-fg">{bytes(a.memUsed)}</span>
              </div>
              {/* Parte direto no computador (clara) e parte em containers (escura, já contada nos projetos). */}
              <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-track" style={{ width: `${max ? Math.max((a.memUsed / max) * 100, 1) : 0}%` }}>
                <div className="h-full bg-muted transition-[flex-grow] duration-700" style={{ flexGrow: a.memUsed - (a.inContainers ?? 0) }} />
                <div className="h-full bg-faint/50 transition-[flex-grow] duration-700" style={{ flexGrow: a.inContainers ?? 0 }} />
              </div>
              {(outsideOf(a.name) || (a.inContainers ?? 0) > 0) && (
                <p className="mt-1 truncate text-[11px] text-faint">
                  {outsideOf(a.name) && <span className="text-warn-ink">fora do painel: {outsideOf(a.name)}</span>}
                  {outsideOf(a.name) && (a.inContainers ?? 0) > 0 && ' · '}
                  {(a.inContainers ?? 0) > 0 && `${bytes(a.inContainers!)} em containers`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-muted" />
          direto no computador
        </span>
        <span className="flex items-center gap-1.5" title="Já aparece nos projetos, no quadro de desenvolvimento.">
          <span className="size-2 rounded-[2px] bg-faint/50" />
          em containers
        </span>
      </div>
      <p className="mt-1.5 text-xs text-faint">
        {bytes(host.used)} em uso de {bytes(host.total)} · {bytes(host.available)} livre.
      </p>
    </section>
  )
}
