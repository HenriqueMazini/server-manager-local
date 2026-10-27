import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { projectAction } from './api'
import { projectColors } from './colors'
import { GROUPS, placer, SessionsList, StatusHelp, view, type SessionsBy, type View } from './components/ClaudeCard'
import { useTheme } from './theme'
import { CreateServerModal } from './components/CreateServer'
import { bytes } from './format'
import { useSnapshot } from './useSnapshot'
import { ComputerBreakdown, MemoryBreakdown, memoryItems } from './components/Memory'
import { ProjectPanel, ProjectsTableHead, ProjectTableRow, RunningRow } from './components/ProjectCard'
import { WorktreeCleanup, WorktreeSummary } from './components/Worktrees'
import { ComputerMemory, ConflictCard, OrphansCard, PortsCard, TemporariesNote } from './components/SystemPage'
import { useReplyAlerts } from './alerts'
import { AlertBell } from './components/AlertBell'
import { SettingsModal } from './components/Settings'
import { attentionItems, AttentionList, Kpis } from './components/Overview'
import { MobileNav, Sidebar, type Badge } from './components/Nav'
import { Search } from './components/Search'
import { SwapCard } from './components/Swap'
import { DevRunsCard, DevRunsSummary } from './components/DevRuns'
import { ProjectPicker } from './components/ProjectPicker'
import { PAGES, usePage, type Page } from './pages'
import { cx, Dot, Icon, Spinner, useToast } from './components/ui'
import type { Project } from './types'

// Depois da resposta, o painel mantém o estado pedido até o snapshot confirmar (ou até este prazo).
const SETTLE_MS = 4000

type PendingEntry = { running: boolean; busy: boolean; until: number; restarting?: boolean }

type ProjectFilter = 'todos' | 'ligados' | 'desligados'

function PageHeader({ page, subtitle, children }: { page: Page; subtitle?: ReactNode; children?: ReactNode }) {
  const info = PAGES.find((p) => p.key === page)!
  return (
    <header className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-[1_1_220px]">
        <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] sm:text-[22px]">{info.title}</h1>
        <p className="mt-1 hidden text-[13px] text-faint sm:block">{subtitle ?? info.subtitle}</p>
      </div>
      {children}
    </header>
  )
}

export default function App() {
  const { snap, history, connection } = useSnapshot()
  const [pending, setPending] = useState<Record<string, PendingEntry>>({})
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const [creating, setCreating] = useState(false)
  const [settings, setSettings] = useState(false)
  const [page, go] = usePage()
  const alerts = useReplyAlerts(snap, () => go('sessoes'))
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('todos')
  const [sessionFilter, setSessionFilter] = useState<View['key'] | null>(null)
  const [sessionProject, setSessionProject] = useState<string | null>(null)
  const [sessionsBy, setSessionsBy] = useState<SessionsBy>(() => {
    try {
      return localStorage.getItem('sm-sessoes-por') === 'projeto' ? 'projeto' : 'status'
    } catch {
      return 'status'
    }
  })
  const chooseSessionsBy = (by: SessionsBy) => {
    setSessionsBy(by)
    try {
      localStorage.setItem('sm-sessoes-por', by)
    } catch {
      /* sem storage: vale só nesta aba */
    }
  }
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem('sm-selected')
    } catch {
      return null
    }
  })
  const remember = (key: string | null) => {
    try {
      if (key) localStorage.setItem('sm-selected', key)
      else localStorage.removeItem('sm-selected')
    } catch {
      /* sem storage: vale só nesta aba */
    }
  }
  const select = useCallback((key: string | null) => {
    setSelected((cur) => {
      const next = cur === key ? null : key
      remember(next)
      return next
    })
  }, [])
  // Vindo de outra tela: abre o projeto na tela de projetos, sem alternar.
  const openProject = useCallback(
    (key: string) => {
      setSelected(key)
      remember(key)
      go('projetos')
    },
    [go],
  )
  const latest = useRef(snap)
  latest.current = snap

  useEffect(() => {
    if (!snap) return
    setPending((cur) => {
      const now = Date.now()
      const next: Record<string, PendingEntry> = {}
      for (const [k, v] of Object.entries(cur)) {
        const p = snap.projects.find((x) => x.key === k)
        const done = !p || (v.running ? p.running === p.total : p.running === 0)
        if (v.busy || (now < v.until && !done)) next[k] = v
      }
      return next
    })
  }, [snap])

  const onToggle = useCallback(
    async (key: string, running: boolean) => {
      setPending((p) => ({ ...p, [key]: { running, busy: true, until: Infinity } }))
      try {
        await projectAction(key, running ? 'start' : 'stop')
        setPending((p) => ({ ...p, [key]: { running, busy: false, until: Date.now() + SETTLE_MS } }))
      } catch (e) {
        setPending(({ [key]: _, ...rest }) => rest)
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [toast],
  )

  const onRestart = useCallback(
    async (key: string) => {
      const memOf = () => latest.current?.projects.find((p) => p.key === key)?.memUsed ?? 0
      const before = memOf()
      setPending((p) => ({ ...p, [key]: { running: true, busy: true, restarting: true, until: Infinity } }))
      try {
        await projectAction(key, 'restart')
        setPending((p) => ({ ...p, [key]: { running: true, busy: false, until: Date.now() + SETTLE_MS } }))
        // Mede depois que os apps voltam a responder: logo após o restart eles ainda estão compilando.
        const started = Date.now()
        const check = setInterval(() => {
          const p = latest.current?.projects.find((x) => x.key === key)
          const ready = p?.state === 'on'
          if (!ready && Date.now() - started < 90_000) return
          clearInterval(check)
          setTimeout(() => {
            const after = memOf()
            const freed = before - after
            toast(
              freed > 0
                ? `Reiniciado: ${bytes(before)} → ${bytes(after)} com tudo no ar. ${bytes(freed)} liberados.`
                : `Reiniciado: ${bytes(after)} em uso com tudo no ar.`,
            )
          }, 2000)
        }, 1000)
      } catch (e) {
        setPending(({ [key]: _, ...rest }) => rest)
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [toast],
  )

  const projects = snap?.projects ?? []
  // Worktrees ficam juntas do projeto principal, e não como projetos soltos.
  const mainProjects = useMemo(
    () => projects.filter((p) => !p.worktree || !projects.some((m) => m.dir === p.worktree!.mainDir)),
    [projects],
  )
  const worktreesOf = (m: Project) => projects.filter((p) => p.worktree && p.worktree.mainDir === m.dir)
  const worktrees = projects.filter((p) => p.worktree && !mainProjects.includes(p))
  const colors = useMemo(() => projectColors(mainProjects), [mainProjects])
  const claude = snap?.claude ?? { available: false, sessions: [], memUsed: 0 }
  const devRuns = useMemo(() => snap?.devRuns ?? [], [snap])
  const memItems = useMemo(() => memoryItems(projects, claude, devRuns, colors), [projects, claude, devRuns, colors])
  const devMem = memItems.reduce((n, p) => n + p.memUsed, 0)
  const on = mainProjects.filter((p) => p.running > 0)
  const attention = snap ? attentionItems(snap, worktrees) : []
  const now = Date.now()
  const waiting = claude.sessions.filter((s) => !s.cwdGone && ['waiting', 'reply'].includes(view(s, now).key)).length
  const system = attention.filter((a) => a.page === 'sistema').length
  const maxMem = Math.max(0, ...mainProjects.map((p) => p.memUsed))
  const conflictOf = (key: string) => snap?.conflicts.find((c) => c.mover.projectKey === key || c.keeper?.projectKey === key)?.hostPort

  const badges: Record<Page, Badge> = {
    geral: attention.length ? { text: String(attention.length), tone: 'warn' } : null,
    projetos: snap ? { text: `${on.length}/${mainProjects.length}`, tone: 'plain' } : null,
    sessoes: waiting ? { text: String(waiting), tone: 'info' } : null,
    sistema: system ? { text: String(system), tone: 'warn' } : null,
  }

  const current = projects.find((p) => p.key === selected) ?? null
  const panel = current && (
    <ProjectPanel project={current} pending={pending[current.key]} onToggle={onToggle} onRestart={onRestart} onClose={() => select(null)} />
  )
  const actions = (p: Project) => ({ pending: pending[p.key], onToggle, onRestart })

  const outdated = snap?.version && snap.version !== __APP_VERSION__
  const version = outdated ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-warn-ink">
        servidor em <span className="font-mono">v{snap!.version}</span>
      </span>
      <button type="button" onClick={() => location.reload()} className="text-fg underline-offset-2 hover:underline">
        recarregar
      </button>
    </span>
  ) : null

  const bell = alerts.enabled && (
    <AlertBell alerts={alerts.alerts} ring={alerts.ring} onDismiss={alerts.dismiss} onDismissAll={alerts.dismissAll} onOpenSessions={() => go('sessoes')} />
  )

  // No celular não há barra lateral: criar server, tema, ajustes e versão ficam no fim de cada tela.
  const mobileFooter = (
    <footer className="mt-8 flex flex-col gap-3 text-xs text-faint lg:hidden">
      <div className="flex gap-2">
        <button type="button" onClick={() => setCreating(true)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-fg text-[13px] font-semibold text-bg">
          <Icon name="plus" className="size-4" />
          Criar server
        </button>
        <button type="button" onClick={toggle} aria-label="Trocar o tema" className="grid size-11 place-items-center rounded-[10px] border border-edge text-muted">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="size-4" />
        </button>
        <button type="button" onClick={() => setSettings(true)} aria-label="Configurações" className="grid size-11 place-items-center rounded-[10px] border border-edge text-muted">
          <Icon name="gear" className="size-4" />
        </button>
      </div>
      <span className="flex items-center gap-2">
        <Dot tone={connection === 'live' ? 'on' : 'warn'} />
        {connection === 'live' ? 'ao vivo' : 'reconectando'} · v{__APP_VERSION__}
      </span>
      {version}
    </footer>
  )

  const error = snap?.error && (
    <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/[0.05] px-4 py-3 text-sm text-danger">
      <Icon name="alert" className="mt-0.5 shrink-0" />
      <span className="break-words">{snap.error}</span>
    </div>
  )

  const shownProjects = mainProjects.filter((p) => (projectFilter === 'todos' ? true : projectFilter === 'ligados' ? p.running > 0 : p.running === 0))
  const withWorktrees = mainProjects.filter((m) => worktreesOf(m).length > 0)
  const nothingToClean = !snap?.conflicts.length && !withWorktrees.length && !(snap?.orphans ?? []).length && !devRuns.length
  const main = 'flex min-w-0 flex-col gap-5 px-4 pb-10 pt-[18px] sm:gap-[22px] sm:px-8 sm:pt-6'

  let content: ReactNode
  if (!snap) {
    content = (
      <main className={main}>
        <PageHeader page={page} subtitle="Conectando ao Docker…" />
        <div className="flex items-center justify-center gap-3 py-24 text-sm text-faint">
          <Spinner className="size-4" />
          Carregando containers…
        </div>
      </main>
    )
  } else if (page === 'geral') {
    content = (
      <main className={main}>
        <PageHeader page="geral">
          <Search snap={snap} go={go} openProject={openProject} />
          {bell}
        </PageHeader>
        {error}
        <Kpis host={snap.host} memItems={memItems} colors={colors} claude={claude} projects={mainProjects} worktrees={worktrees.length} pressure={snap.pressure} go={go} />
        <div className="flex flex-wrap items-start gap-[18px]">
          <AttentionList items={attention} go={go} />
          <div className="hidden min-w-0 flex-[2_1_280px] sm:flex">
            <MemoryBreakdown items={memItems} colors={colors} history={history} />
          </div>
          <div className="hidden min-w-0 flex-[2_1_280px] sm:flex">
            <ComputerBreakdown host={snap.host} apps={snap.apps ?? []} devRuns={devRuns} />
          </div>
        </div>
        <section aria-labelledby="on-title" className="overflow-hidden rounded-[14px] border border-line bg-surface">
          <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-3 sm:px-[18px] sm:py-3.5">
            <h2 id="on-title" className="text-[13px] font-semibold sm:text-sm">
              Ligados agora
            </h2>
            <button type="button" onClick={() => go('projetos')} className="ml-auto hidden text-xs text-muted hover:text-fg sm:block">
              Ver todos os projetos
            </button>
          </header>
          {on.length === 0 ? (
            <p className="px-[18px] py-5 text-sm text-faint">Nenhum projeto ligado agora.</p>
          ) : (
            <ul>
              {on.map((p) => (
                <RunningRow key={p.key} project={p} onOpen={openProject} {...actions(p)} />
              ))}
            </ul>
          )}
        </section>
        {mobileFooter}
      </main>
    )
  } else if (page === 'projetos') {
    content = (
      <div className="flex min-h-dvh">
        <main className={cx(main, 'flex-1 gap-[18px] sm:gap-[18px] sm:px-7')}>
          <PageHeader page="projetos">
            <div role="group" aria-label="Filtrar por status" className="flex rounded-[10px] border border-edge bg-surface p-[3px]">
              {(
                [
                  ['todos', 'Todos', mainProjects.length],
                  ['ligados', 'Ligados', on.length],
                  ['desligados', 'Desligados', mainProjects.length - on.length],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={projectFilter === k}
                  onClick={() => setProjectFilter(k)}
                  className={cx('rounded-[7px] px-3 py-1.5 text-xs transition-colors', projectFilter === k ? 'bg-raised font-medium text-fg' : 'text-muted hover:text-fg')}
                >
                  {label} {n}
                </button>
              ))}
            </div>
          </PageHeader>
          {error}
          {mainProjects.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-line px-6 py-10 text-center text-sm text-faint">
              Nenhum container encontrado. Suba um projeto com <code className="font-mono text-muted">docker compose up -d</code> ou use Criar server.
            </div>
          ) : (
            <div role="table" aria-label="Projetos" className="overflow-hidden rounded-[14px] border border-line bg-surface">
              <ProjectsTableHead />
              {shownProjects.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-faint">Nenhum projeto {projectFilter === 'ligados' ? 'ligado' : 'desligado'}.</p>
              )}
              {shownProjects.map((p) => (
                <div key={p.key} role="rowgroup" className="border-t border-divider first:border-t-0 [&>[role=row]:first-child]:border-t-0">
                  <ProjectTableRow
                    project={p}
                    color={colors[p.key]}
                    maxMem={maxMem}
                    conflict={conflictOf(p.key)}
                    selected={p.key === selected}
                    onSelect={select}
                    {...actions(p)}
                  />
                  {p.key === selected && <div className="border-t border-line bg-panel lg:hidden">{panel}</div>}
                  {worktreesOf(p).length > 0 && <WorktreeSummary items={worktreesOf(p)} onManage={() => go('sistema')} />}
                  {devRuns.some((r) => r.projectKey === p.key) && <DevRunsSummary runs={devRuns.filter((r) => r.projectKey === p.key)} onManage={() => go('sistema')} />}
                </div>
              ))}
            </div>
          )}
          {mobileFooter}
        </main>
        <aside aria-label="Detalhes do projeto" className="scroll-area sticky top-0 hidden h-dvh w-[420px] shrink-0 overflow-y-auto border-l border-line bg-panel lg:block xl:w-[480px]">
          {panel ?? (
            <div className="grid h-full place-items-center px-8 text-center text-sm text-faint">
              <p>
                Selecione um projeto para ver
                <br />
                apps, containers, portas e logs.
              </p>
            </div>
          )}
        </aside>
      </div>
    )
  } else if (page === 'sessoes') {
    // Projetos com sessões, abertas ou encerradas, para o seletor, em ordem alfabética.
    const place = placer(projects)
    const options = new Map<string, { label: string; open: number; closed: number }>()
    for (const s of claude.sessions) {
      const pl = place(s.cwd)
      const o = options.get(pl.key) ?? { label: pl.label, open: 0, closed: 0 }
      o.open++
      options.set(pl.key, o)
    }
    for (const s of claude.closed ?? []) {
      const pl = place(s.cwd)
      const o = options.get(pl.key) ?? { label: pl.label, open: 0, closed: 0 }
      o.closed++
      options.set(pl.key, o)
    }
    const projectOptions = [...options.entries()].map(([key, o]) => ({ key, ...o })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base', numeric: true }))
    const proj = sessionProject && options.has(sessionProject) ? sessionProject : null
    const scoped = proj ? claude.sessions.filter((s) => place(s.cwd).key === proj) : claude.sessions
    const scopedCount = (k: View['key']) => scoped.filter((s) => view(s, now).key === k).length
    const filter = sessionFilter && scopedCount(sessionFilter) ? sessionFilter : null
    const chip = (active: boolean) =>
      cx(
        'flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] text-fg transition-colors',
        active ? 'border-faint/40 bg-raised' : 'border-edge bg-surface hover:border-faint/40',
      )
    content = (
      <main className={cx(main, 'max-w-[1180px]')}>
        <PageHeader
          page="sessoes"
          subtitle={
            claude.sessions.length
              ? `${claude.sessions.length} ${claude.sessions.length === 1 ? 'aberta' : 'abertas'} · ${bytes(claude.memUsed)} · as que pedem você ficam no topo.`
              : undefined
          }
        >
          <span className="hidden sm:inline-flex">
            <StatusHelp />
          </span>
        </PageHeader>
        {error}
        {(claude.sessions.length > 0 || projectOptions.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            <ProjectPicker value={proj} options={projectOptions} onChange={setSessionProject} />
            <div role="group" aria-label="Agrupar sessões" className="flex rounded-[10px] border border-edge bg-surface p-[3px]">
              {(
                [
                  ['status', 'Por status'],
                  ['projeto', 'Por projeto'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={sessionsBy === k}
                  onClick={() => chooseSessionsBy(k)}
                  className={cx('rounded-[7px] px-3 py-1.5 text-xs transition-colors', sessionsBy === k ? 'bg-raised font-medium text-fg' : 'text-muted hover:text-fg')}
                >
                  {label}
                </button>
              ))}
            </div>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-line sm:block" />
            <div role="group" aria-label="Filtrar por status" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={!filter} onClick={() => setSessionFilter(null)} className={chip(!filter)}>
                <span className="size-2 rounded-full bg-fg" />
                Todas
                <span className="tabular font-mono text-xs text-faint">{scoped.length}</span>
              </button>
              {GROUPS.map((g) => {
                const n = scopedCount(g.key)
                if (!n) return null
                return (
                  <button key={g.key} type="button" aria-pressed={filter === g.key} onClick={() => setSessionFilter(filter === g.key ? null : g.key)} className={chip(filter === g.key)}>
                    <Dot tone={g.tone} />
                    {g.title}
                    <span className="tabular font-mono text-xs text-faint">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <SessionsList
          claude={claude}
          muted={alerts.enabled ? alerts.muted : undefined}
          onToggleMute={alerts.toggleMute}
          projects={projects}
          filter={filter ? [filter] : undefined}
          by={sessionsBy}
          project={proj ?? undefined}
        />
        {mobileFooter}
      </main>
    )
  } else {
    content = (
      <main className={main}>
        <PageHeader page="sistema" />
        {error}
        <div className="flex flex-wrap items-start gap-[18px]">
          <section aria-labelledby="clean-title" className="flex min-w-0 flex-[3_1_520px] flex-col gap-3">
            <h2 id="clean-title" className="text-sm font-semibold">
              Para resolver
            </h2>
            {nothingToClean && (
              <p className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-4 text-sm text-muted">
                <Icon name="checkCircle" className="size-4 text-on-ink" />
                Nenhum conflito de porta e nada para limpar.
              </p>
            )}
            {snap.conflicts.map((c) => (
              <ConflictCard key={c.id} c={c} />
            ))}
            {withWorktrees.map((m) => (
              <WorktreeCleanup key={m.key} main={m.name} items={worktreesOf(m)} />
            ))}
            <DevRunsCard runs={devRuns} canStop={!!claude.canDelete} />
            <OrphansCard orphans={snap.orphans ?? []} />
            <TemporariesNote items={snap.temporary ?? []} />
          </section>
          <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-[18px]">
            <ComputerMemory host={snap.host} dev={devMem} apps={snap.apps ?? []} />
            <SwapCard
              host={snap.host}
              pressure={snap.pressure}
              claude={claude}
              projects={mainProjects}
              devRuns={devRuns}
              apps={snap.swapApps ?? []}
              onRestart={onRestart}
              onSessions={() => go('sessoes')}
            />
          </div>
        </div>
        <PortsCard ports={snap.ports} />
        {mobileFooter}
      </main>
    )
  }

  return (
    <div className="lg:flex">
      <Sidebar
        page={page}
        go={go}
        badges={badges}
        onCreate={() => setCreating(true)}
        connection={connection}
        version={version}
        themeIcon={theme === 'dark' ? 'sun' : 'moon'}
        onTheme={toggle}
        onSettings={() => setSettings(true)}
      />
      <div className="min-w-0 flex-1 pb-24 lg:pb-0">{content}</div>
      <MobileNav page={page} go={go} />
      {creating && <CreateServerModal onClose={() => setCreating(false)} />}
      {settings && (
        <SettingsModal
          alerts={alerts.enabled}
          setAlerts={alerts.setEnabled}
          sound={alerts.sound}
          setSound={alerts.setSound}
          desktop={alerts.desktop}
          setDesktop={alerts.setDesktop}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  )
}
