import type { ReactNode } from 'react'
import type { ClaudeSummary, HostMem, Project, Snapshot } from '../types'
import type { Page } from '../pages'
import { bytes, bytesParts, percent } from '../format'
import { StackBar, type MemoryItem } from './Memory'
import { view } from './ClaudeCard'
import { cx, Dot, Icon, type Tone } from './ui'

export type Attention = {
  key: string
  tone: Tone
  icon: 'bell' | 'alert' | 'branch' | 'trash'
  title: string
  detail: string
  action: string
  page: Page
}

// Tudo que pede uma ação, numa lista só: sessões esperando, conflitos de porta e sobras para limpar.
export function attentionItems(snap: Snapshot, worktrees: Project[]): Attention[] {
  const out: Attention[] = []
  const waiting = (snap.claude?.sessions ?? []).filter((s) => ['waiting', 'reply'].includes(view(s).key))
  if (waiting.length) {
    out.push({
      key: 'sessions',
      tone: 'info',
      icon: 'bell',
      title: waiting.length === 1 ? '1 sessão aguarda você' : `${waiting.length} sessões aguardam você`,
      detail: waiting.map((s) => s.name).join(' · '),
      action: 'Ver sessões',
      page: 'sessoes',
    })
  }
  for (const c of snap.conflicts) {
    out.push({
      key: `conflict:${c.id}`,
      tone: 'warn',
      icon: 'alert',
      title: `Conflito na porta ${c.hostPort}`,
      detail: `${c.mover.label} (${c.mover.projectName}) ${c.keeper ? `disputa com ${c.keeper.projectName}` : 'disputa com um processo do computador'} · sugestão: ${c.proposedPort}`,
      action: 'Resolver',
      page: 'sistema',
    })
  }
  const missing = worktrees.filter((p) => p.worktree?.missing)
  for (const main of [...new Set(missing.map((p) => p.worktree!.mainName))]) {
    const items = missing.filter((p) => p.worktree!.mainName === main)
    const containers = items.reduce((n, p) => n + p.total, 0)
    const mem = items.reduce((n, p) => n + p.memUsed, 0)
    out.push({
      key: `wt:${main}`,
      tone: 'warn',
      icon: 'branch',
      title: `${items.length} ${items.length === 1 ? 'worktree' : 'worktrees'} de ${main} já ${items.length === 1 ? 'removida' : 'removidas'} do git`,
      detail: `${containers} containers ainda existem${mem > 0 ? ` e ocupam ${bytes(mem)}` : ''}`,
      action: 'Limpar',
      page: 'sistema',
    })
  }
  const orphans = snap.orphans ?? []
  if (orphans.length) {
    out.push({
      key: 'orphans',
      tone: 'off',
      icon: 'trash',
      title: orphans.length === 1 ? '1 container sem projeto' : `${orphans.length} containers sem projeto`,
      detail: orphans.map((o) => o.name).join(', '),
      action: 'Revisar',
      page: 'sistema',
    })
  }
  return out
}

const iconTone: Record<Tone, string> = {
  info: 'bg-info/10 text-info-ink',
  warn: 'bg-warn/10 text-warn-ink',
  on: 'bg-on/10 text-on-ink',
  danger: 'bg-danger/10 text-danger',
  off: 'bg-divider text-muted',
}

export function AttentionList({ items, go }: { items: Attention[]; go: (p: Page) => void }) {
  return (
    <section aria-labelledby="att-title" className="min-w-0 flex-[3_1_380px] overflow-hidden rounded-[14px] border border-line bg-surface">
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-3 sm:px-[18px] sm:py-3.5">
        <h2 id="att-title" className="text-[13px] font-semibold sm:text-sm">
          Precisa da sua atenção
        </h2>
        {items.length > 0 && <span className="hidden text-xs text-faint sm:inline">{items.length === 1 ? '1 item' : `${items.length} itens`}</span>}
      </header>
      {items.length === 0 ? (
        <p className="flex items-center gap-2.5 px-[18px] py-5 text-sm text-muted">
          <Icon name="checkCircle" className="size-4 text-on-ink" />
          Tudo em ordem. Nenhuma sessão esperando e nada para limpar.
        </p>
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.key} className="border-t border-divider first:border-t-0">
              {/* Celular: linha inteira clicável, só o título. */}
              <button type="button" onClick={() => go(a.page)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2 text-left sm:hidden">
                <Dot tone={a.tone} />
                <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                <Icon name="chevronRight" className="size-3.5 text-faint" />
              </button>
              <div className="hidden items-center gap-3.5 px-[18px] py-3.5 sm:flex">
                <span className={cx('grid size-[34px] shrink-0 place-items-center rounded-[10px]', iconTone[a.tone])}>
                  <Icon name={a.icon} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.title}</div>
                  <div className="mt-0.5 truncate text-xs text-faint">{a.detail}</div>
                </div>
                <button
                  type="button"
                  onClick={() => go(a.page)}
                  className="shrink-0 rounded-lg border border-edge px-3 py-[7px] text-xs font-medium text-fg transition-colors hover:border-faint/60 hover:bg-raised"
                >
                  {a.action}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const kpiCard = 'flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-4 text-left'

function Kpi({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-[11px] uppercase tracking-[0.1em] text-faint">{label}</span>
      {children}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(kpiCard, 'transition-colors hover:border-faint/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on')}>
      {body}
    </button>
  ) : (
    <div className={kpiCard}>{body}</div>
  )
}

function Figure({ value, unit, aside }: { value: string; unit: string; aside?: ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="tabular font-mono text-[28px] font-medium leading-none">{value}</span>
      <span className="text-sm text-muted">{unit}</span>
      {aside && <span className="ml-auto truncate pl-2 text-xs text-faint">{aside}</span>}
    </span>
  )
}

export function Kpis({
  host,
  memItems,
  colors,
  claude,
  projects,
  worktrees,
  go,
}: {
  host: HostMem
  memItems: MemoryItem[]
  colors: Record<string, string>
  claude: ClaudeSummary
  projects: Project[]
  worktrees: number
  go: (p: Page) => void
}) {
  const dev = memItems.reduce((n, p) => n + p.memUsed, 0)
  const [dv, du] = bytesParts(dev)
  const [hv, hu] = bytesParts(host.used)
  const [fv, fu] = bytesParts(host.available)
  const on = projects.filter((p) => p.running > 0)
  const count = (keys: string[]) => claude.sessions.filter((s) => keys.includes(view(s).key)).length
  const busy = count(['busy'])
  const waiting = count(['waiting', 'reply'])
  return (
    <>
      {/* Celular: só os dois números de memória. */}
      <section aria-label="Memória" className="grid grid-cols-2 gap-2.5 sm:hidden">
        <div className="rounded-[14px] border border-line bg-surface p-3.5">
          <div className="text-[11px] text-faint">Desenvolvimento</div>
          <div className="mt-1.5">
            <span className="tabular font-mono text-[22px]">{dv}</span> <span className="text-xs text-muted">{du}</span>
          </div>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-3.5">
          <div className="text-[11px] text-faint">Computador</div>
          <div className="mt-1.5">
            <span className="tabular font-mono text-[22px]">{fv}</span> <span className="text-xs text-muted">{fu} livres</span>
          </div>
        </div>
      </section>

      <section aria-label="Números-chave" className="hidden grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5 sm:grid">
        <Kpi label="Ambientes de desenvolvimento">
          <Figure value={dv} unit={du} aside={`${percent(dev, host.total)} do PC`} />
          <StackBar items={memItems} colors={colors} />
        </Kpi>
        <Kpi label="Computador">
          <Figure value={hv} unit={`${hu === 'GB' ? '' : hu + ' '}de ${bytes(host.total)}`} aside={`${fv}${fu === 'GB' ? '' : ' ' + fu} livre`} />
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-muted transition-[width] duration-700" style={{ width: `${host.total ? (host.used / host.total) * 100 : 0}%` }} />
          </div>
        </Kpi>
        <Kpi label="Sessões do Claude" onClick={() => go('sessoes')}>
          <Figure value={String(claude.sessions.length)} unit={claude.sessions.length === 1 ? 'aberta' : 'abertas'} aside={claude.memUsed > 0 ? bytes(claude.memUsed) : undefined} />
          <span className="flex flex-wrap gap-1.5 text-xs">
            {busy > 0 && <span className="rounded-full bg-on/10 px-2 py-0.5 text-on-ink">{busy} trabalhando</span>}
            {waiting > 0 && <span className="rounded-full bg-info/10 px-2 py-0.5 text-info-ink">{waiting} aguardam você</span>}
            {busy + waiting === 0 && <span className="py-0.5 text-faint">nenhuma pedindo você</span>}
          </span>
        </Kpi>
        <Kpi label="Projetos" onClick={() => go('projetos')}>
          <Figure value={String(on.length)} unit={`de ${projects.length} ${on.length === 1 ? 'ligado' : 'ligados'}`} aside={worktrees > 0 ? `+${worktrees} worktrees` : undefined} />
          <span className="flex flex-wrap gap-1">
            {projects.map((p) => (
              <span key={p.key} title={p.name} className="flex">
                <Dot tone={p.running === 0 ? 'off' : p.running < p.total ? 'warn' : 'on'} />
              </span>
            ))}
          </span>
        </Kpi>
      </section>
    </>
  )
}
