import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectAction } from './api'
import { CLAUDE_KEY, projectColors } from './colors'
import { ClaudeDetail, ClaudeRow } from './components/ClaudeCard'
import { useTheme } from './theme'
import { CreateServerModal } from './components/CreateServer'
import { bytes } from './format'
import { useSnapshot, type Connection } from './useSnapshot'
import { MemoryCard } from './components/MemoryCard'
import { ProjectDetail, ProjectRow } from './components/ProjectCard'
import { Conflicts } from './components/Conflicts'
import { PortsTable } from './components/PortsTable'
import { cx, Dot, Icon, Spinner, useToast } from './components/ui'

// Depois da resposta, o painel mantém o estado pedido até o snapshot confirmar (ou até este prazo).
const SETTLE_MS = 4000

type PendingEntry = { running: boolean; busy: boolean; until: number; restarting?: boolean }

export default function App() {
  const { snap, history, connection } = useSnapshot()
  const [pending, setPending] = useState<Record<string, PendingEntry>>({})
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem('sm-selected')
    } catch {
      return null
    }
  })
  const select = useCallback((key: string | null) => {
    setSelected((cur) => {
      const next = cur === key ? null : key
      try {
        if (next) localStorage.setItem('sm-selected', next)
        else localStorage.removeItem('sm-selected')
      } catch {
        /* sem storage: vale só nesta aba */
      }
      return next
    })
  }, [])
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
  const colors = useMemo(() => projectColors(projects), [projects])
  const on = projects.filter((p) => p.running > 0).length
  const claude = snap?.claude ?? { available: false, sessions: [], memUsed: 0 }
  const devMem = projects.reduce((n, p) => n + p.memUsed, 0) + claude.memUsed

  const current = projects.find((p) => p.key === selected) ?? null
  const detail = selected === CLAUDE_KEY ? (
    <ClaudeDetail claude={claude} color={colors[CLAUDE_KEY]} onClose={() => select(null)} />
  ) : current && (
    <ProjectDetail
      project={current}
      color={colors[current.key]}
      pending={pending[current.key]}
      onToggle={onToggle}
      onRestart={onRestart}
      onClose={() => select(null)}
    />
  )

  return (
    <div className="flex flex-col lg:h-dvh">
      <div className="mx-auto w-full max-w-7xl shrink-0 px-4 pt-5 sm:px-6">
        <header className="mb-4 flex items-center gap-3">
          <Logo />
          <div className="flex-1">
            <h1 className="text-base font-semibold tracking-tight">Server Manager</h1>
            <p className="text-xs text-faint">
              {snap ? (
                <>
                  {on} de {projects.length} {projects.length === 1 ? 'projeto ligado' : 'projetos ligados'} · {bytes(devMem)} em uso
                </>
              ) : (
                'Conectando ao Docker…'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on"
          >
            <Icon name="plus" className="size-3.5" />
            Criar server
          </button>
          <LiveBadge connection={connection} />
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            className="grid size-8 place-items-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="size-4" />
          </button>
        </header>

        {snap?.error && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/[0.05] px-4 py-3 text-sm text-danger">
            <Icon name="alert" className="mt-0.5 shrink-0" />
            <span className="break-words">{snap.error}</span>
          </div>
        )}

        {snap && (
          <div className="mb-4">
            <MemoryCard host={snap.host} projects={projects} claude={claude} colors={colors} history={history} />
          </div>
        )}
      </div>

      {!snap ? (
        <Loading />
      ) : (
        <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-3 sm:px-6 lg:min-h-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="scroll-area space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1" aria-label="Projetos">
            <Conflicts conflicts={snap.conflicts} />

            <div className="space-y-2">
              <h2 className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-faint">
                Projetos <span className="normal-case tracking-normal">· {projects.length}</span>
              </h2>
              <div className="space-y-2">
                <ClaudeRow claude={claude} color={colors[CLAUDE_KEY]} selected={selected === CLAUDE_KEY} onSelect={() => select(CLAUDE_KEY)} />
                {selected === CLAUDE_KEY && <div className="lg:hidden">{detail}</div>}
              </div>
              {projects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-faint">
                  Nenhum container encontrado. Suba um projeto com <code className="font-mono text-muted">docker compose up -d</code> e ele aparece aqui.
                </div>
              ) : (
                projects.map((p) => (
                  <div key={p.key} className="space-y-2">
                    <ProjectRow
                      project={p}
                      color={colors[p.key]}
                      selected={p.key === selected}
                      onSelect={select}
                      pending={pending[p.key]}
                      onToggle={onToggle}
                      onRestart={onRestart}
                    />
                    {p.key === selected && <div className="lg:hidden">{detail}</div>}
                  </div>
                ))
              )}
            </div>

            <PortsTable ports={snap.ports} />
          </section>

          <section className="scroll-area hidden lg:block lg:min-h-0 lg:overflow-y-auto lg:pr-1" aria-label="Detalhes do projeto">
            {detail ?? (
              <div className="grid h-full min-h-48 place-items-center rounded-2xl border border-dashed border-line px-6 text-center text-sm text-faint">
                <p>
                  Selecione um projeto à esquerda para ver
                  <br />
                  apps, containers, portas e logs.
                </p>
              </div>
            )}
          </section>
        </main>
      )}
      {creating && <CreateServerModal onClose={() => setCreating(false)} />}
      <footer className="mx-auto flex w-full max-w-7xl shrink-0 items-center gap-2 px-4 pb-4 text-[11px] text-faint sm:px-6">
        <span>
          Server Manager <span className="font-mono">v{__APP_VERSION__}</span>
        </span>
        {snap?.version && snap.version !== __APP_VERSION__ && (
          <>
            <span aria-hidden>·</span>
            <span className="text-warn-ink">
              servidor atualizado para <span className="font-mono">v{snap.version}</span>
            </span>
            <button type="button" onClick={() => location.reload()} className="rounded-md px-1.5 py-0.5 text-fg underline-offset-2 hover:underline">
              recarregar
            </button>
          </>
        )}
      </footer>
    </div>
  )
}

function LiveBadge({ connection }: { connection: Connection }) {
  const live = connection === 'live'
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs',
        live ? 'text-muted' : 'text-warn-ink',
      )}
    >
      <Dot tone={live ? 'on' : 'warn'} pulse={live} />
      {live ? 'ao vivo' : connection === 'connecting' ? 'conectando' : 'reconectando'}
    </span>
  )
}

function Logo() {
  return (
    <span className="grid size-9 place-items-center rounded-xl border border-line bg-surface">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
        <rect x="4" y="5" width="16" height="5" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
        <rect x="4" y="14" width="16" height="5" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="16.5" cy="7.5" r="1.1" className="fill-on" />
        <circle cx="16.5" cy="16.5" r="1.1" className="fill-faint" />
      </svg>
    </span>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-sm text-faint">
      <Spinner className="size-4" />
      Carregando containers…
    </div>
  )
}
