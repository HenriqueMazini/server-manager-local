import { useEffect, useRef, useState } from 'react'
import { fetchLogs } from '../api'
import type { Container, Port, Project } from '../types'
import { bytes, displayURL, isWeb, shortPath } from '../format'
import { copyText, cx, Dot, Icon, Spinner, Switch, useToast, type Tone } from './ui'
import { AliasField } from './AliasField'

export type Pending = { running: boolean; busy: boolean; restarting?: boolean }

export type Actions = {
  pending?: Pending
  onToggle: (key: string, running: boolean) => void
  onRestart: (key: string) => void
}

const stateText: Record<Project['state'], string> = {
  on: 'ligado',
  off: 'desligado',
  partial: 'parcialmente ligado',
  starting: 'iniciando',
}

const stateTone: Record<Project['state'], Tone> = { on: 'on', off: 'off', partial: 'warn', starting: 'warn' }

const healthText: Record<string, string> = { healthy: 'saudável', starting: 'iniciando', unhealthy: 'com falha' }

export const toneText: Record<Tone, string> = { on: 'text-on-ink', warn: 'text-warn-ink', danger: 'text-danger', off: 'text-faint', info: 'text-info-ink' }

function itemStatus(c: Container): [string, Tone] {
  if (c.role === 'app') {
    if (c.external) return ['porta ocupada fora do painel', 'warn']
    if (!c.running) return ['desligado', 'off']
    if (c.ports.length && !c.listening) return ['iniciando', 'warn']
    return ['no ar', 'on']
  }
  if (c.state === 'dead' || c.health === 'unhealthy') return [healthText.unhealthy, 'danger']
  if (c.state === 'restarting') return ['reiniciando', 'warn']
  if (!c.running) return ['desligado', 'off']
  if (c.health) return [healthText[c.health] ?? c.health, c.health === 'healthy' ? 'on' : 'warn']
  return ['ligado', 'on']
}

export function projectStatus(p: Project, pending?: Pending): [string, Tone] {
  const text = pending?.busy
    ? pending.restarting
      ? 'reiniciando…'
      : pending.running
        ? 'ligando…'
        : 'desligando…'
    : stateText[p.state]
  return [text, pending?.busy ? 'warn' : stateTone[p.state]]
}

function ProjectSwitch({ project: p, pending, onToggle }: { project: Project } & Actions) {
  const checked = pending ? pending.running : p.running > 0
  return (
    <span onClick={(e) => e.stopPropagation()} className="contents">
      <Switch checked={checked} busy={pending?.busy} label={checked ? `Desligar ${p.name}` : `Ligar ${p.name}`} onChange={(next) => onToggle(p.key, next)} />
    </span>
  )
}

function RestartButton({ project: p, pending, onRestart }: { project: Project } & Actions) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onRestart(p.key)
      }}
      disabled={p.running === 0 || pending?.busy}
      title={p.apps.length ? 'Reiniciar os apps para liberar memória' : 'Reiniciar os containers'}
      aria-label={`Reiniciar ${p.name}`}
      className="grid size-8 shrink-0 place-items-center rounded-lg border border-edge text-muted transition-colors hover:border-faint/60 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
    >
      {pending?.restarting ? <Spinner className="size-3.5" /> : <Icon name="restart" className="size-3.5" />}
    </button>
  )
}

// Endereços do projeto num texto só, para a coluna "Acesso". Sem links, os serviços.
function accessText(p: Project): string {
  // Do segundo endereço em diante, sem o "localhost" repetido: "localhost:3000 · :3001/docs".
  if (p.links.length) return p.links.map((l, i) => (i ? displayURL(l.url).replace(/^localhost/, '') : displayURL(l.url))).join(' · ')
  const items = [...p.apps, ...p.infra]
  if (!items.length) return '—'
  const names = items.slice(0, 2).map((c) => c.label)
  return `${items.length} ${items.length === 1 ? 'serviço' : 'serviços'} · ${names.join(', ')}${items.length > 2 ? '…' : ''}`
}

// Linha de "Ligados agora" na visão geral: nome, links, memória, reiniciar e interruptor.
export function RunningRow({ project: p, onOpen, ...actions }: { project: Project; onOpen: (key: string) => void } & Actions) {
  const [, tone] = projectStatus(p, actions.pending)
  return (
    <li className="flex min-h-14 items-center gap-x-3 gap-y-3 border-t border-divider px-3.5 py-2 first:border-t-0 sm:flex-wrap sm:gap-x-4 sm:px-[18px] sm:py-3">
      <Dot tone={tone} />
      <button type="button" onClick={() => onOpen(p.key)} className="min-w-0 flex-1 text-left sm:flex-[1_1_180px]">
        <span className="block truncate text-sm font-semibold hover:underline hover:underline-offset-4">
          {p.name} {p.alias && <span className="font-normal text-faint">({p.alias})</span>}
        </span>
        <span className="tabular block font-mono text-[11px] text-faint sm:hidden">{bytes(p.memUsed)}</span>
      </button>
      <span className="hidden flex-[2_1_260px] flex-wrap gap-1.5 sm:flex">
        {p.links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            title={`Abrir ${l.url}`}
            className="rounded-md border border-edge bg-chip px-2 py-[3px] font-mono text-[11px] text-body transition-colors hover:border-faint/60 hover:text-fg"
          >
            {l.label} {displayURL(l.url)}
          </a>
        ))}
      </span>
      <span className="tabular hidden w-[70px] text-right font-mono text-xs text-muted sm:block">{bytes(p.memUsed)}</span>
      <span className="hidden sm:contents">
        <RestartButton project={p} {...actions} />
      </span>
      <ProjectSwitch project={p} {...actions} />
    </li>
  )
}

const COLS = 'grid-cols-[22px_minmax(0,1fr)_84px] sm:grid-cols-[22px_minmax(0,1.6fr)_minmax(0,1fr)_96px_84px]'

export function ProjectsTableHead() {
  return (
    <div role="row" className={cx('grid gap-3 border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.08em] text-faint', COLS)}>
      <span role="columnheader" />
      <span role="columnheader">Projeto</span>
      <span role="columnheader" className="hidden sm:block">
        Acesso
      </span>
      <span role="columnheader" className="hidden text-right sm:block">
        Memória
      </span>
      <span role="columnheader" className="text-right">
        Ações
      </span>
    </div>
  )
}

// Linha da tabela de projetos. Clicar abre os detalhes no painel ao lado.
export function ProjectTableRow({
  project: p,
  color,
  maxMem,
  conflict,
  selected,
  onSelect,
  ...actions
}: { project: Project; color: string; maxMem: number; conflict?: number; selected: boolean; onSelect: (key: string) => void } & Actions) {
  const [state, tone] = projectStatus(p, actions.pending)
  const on = p.running > 0
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onSelect(p.key)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect(p.key)
        }
      }}
      className={cx(
        'grid cursor-pointer items-center gap-3 border-t border-divider px-4 py-3 transition-colors first:border-t-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on',
        COLS,
        selected ? 'bg-raised/70' : 'hover:bg-raised/40',
      )}
      style={selected ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
    >
      <span role="cell">
        <Dot tone={tone} />
      </span>
      <span role="cell" className="min-w-0">
        <span className={cx('block truncate text-sm font-semibold', !on && 'text-muted')}>
          {p.name} {p.alias && <span className="font-normal text-faint">({p.alias})</span>}
        </span>
        <span className={cx('mt-0.5 block truncate text-xs', toneText[tone])}>
          {state}
          {conflict ? ` · conflito na ${conflict}` : p.kind === 'compose' && !on ? ' · compose' : ''}
        </span>
      </span>
      <span role="cell" className="hidden min-w-0 truncate font-mono text-[11px] text-muted sm:block">
        {accessText(p)}
      </span>
      <span role="cell" className="hidden text-right sm:block">
        <span className="tabular block font-mono text-xs">{on ? bytes(p.memUsed) : '—'}</span>
        <span className="mt-[5px] block h-[3px] overflow-hidden rounded-full bg-track">
          <span
            className="block h-full rounded-full transition-[width] duration-700"
            style={{ width: on && maxMem ? `${Math.max((p.memUsed / maxMem) * 100, 2)}%` : '0%', background: color }}
          />
        </span>
      </span>
      <span role="cell" className="flex justify-end">
        <ProjectSwitch project={p} {...actions} />
      </span>
    </div>
  )
}

type Tab = 'visao' | 'logs' | 'portas'

// Painel de detalhes do projeto: ações, apps e infraestrutura, logs e portas.
export function ProjectPanel({ project: p, onClose, ...actions }: { project: Project; onClose: () => void } & Actions) {
  const [tab, setTab] = useState<Tab>('visao')
  const [state, tone] = projectStatus(p, actions.pending)
  const on = p.running > 0
  const checked = actions.pending ? actions.pending.running : on
  const web = p.links.find((l) => isWeb(l.url))
  const all = [...p.apps, ...p.infra]
  const ports = all.flatMap((c) => c.ports.map((pt) => ({ c, pt })))
  const secondary =
    'inline-flex items-center gap-1.5 rounded-lg border border-edge bg-chip px-3 py-[7px] text-xs text-fg transition-colors hover:border-faint/60 disabled:pointer-events-none disabled:opacity-40'

  useEffect(() => setTab('visao'), [p.key])

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-line px-[22px] pb-4 pt-[22px]">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="group flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
              {p.name}
              <AliasField projectKey={p.key} alias={p.alias} className="text-lg font-normal" />
            </h2>
            <p className="mt-1 text-xs text-faint">
              <span className={toneText[tone]}>{state}</span>
              {p.apps.length > 0 && ` · ${p.apps.length} ${p.apps.length === 1 ? 'app' : 'apps'}`} · {p.infra.length}{' '}
              {p.infra.length === 1 ? 'container' : 'containers'}
              {p.dir && (
                <>
                  {' · '}
                  <span className="break-all font-mono">{shortPath(p.dir)}</span>
                </>
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar detalhes" className="grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg">
            <Icon name="close" className="size-[15px]" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => actions.onRestart(p.key)} disabled={!on || actions.pending?.busy} className={secondary}>
            {actions.pending?.restarting ? <Spinner className="size-3" /> : <Icon name="restart" className="size-[13px]" />}
            {p.apps.length ? 'Reiniciar apps' : 'Reiniciar'}
          </button>
          <button type="button" onClick={() => actions.onToggle(p.key, !checked)} disabled={actions.pending?.busy} className={secondary}>
            {actions.pending?.busy && !actions.pending.restarting ? <Spinner className="size-3" /> : <Icon name="power" className="size-[13px]" />}
            {checked ? 'Desligar' : 'Ligar'}
          </button>
          {web && (
            <a
              href={web.url}
              target="_blank"
              rel="noreferrer"
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-[7px] text-xs font-semibold text-bg transition-opacity hover:opacity-90',
                !on && 'pointer-events-none opacity-40',
              )}
            >
              Abrir {web.label.toLowerCase() === 'sistema' ? 'sistema' : web.label}
              <Icon name="external" className="size-3" />
            </a>
          )}
        </div>
        <div role="tablist" aria-label="Detalhes" className="-mb-[17px] flex gap-1">
          {(
            [
              ['visao', 'Visão'],
              ['logs', 'Logs'],
              ['portas', 'Portas'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx(
                'border-b-2 px-2.5 py-2 text-[13px] transition-colors',
                tab === k ? 'border-fg font-medium text-fg' : 'border-transparent text-faint hover:text-muted',
              )}
            >
              {label}
              {k === 'portas' && ports.length > 0 && <span className="ml-1 text-faint">{ports.length}</span>}
            </button>
          ))}
        </div>
      </header>
      <div className="flex flex-col gap-[18px] px-[22px] py-[18px]">
        {tab === 'visao' && (
          <>
            {p.apps.length > 0 && <Section title="Apps" items={p.apps} />}
            {p.infra.length > 0 && <Section title="Infraestrutura" items={p.infra} />}
            {!all.length && <p className="text-sm text-faint">Nenhum container neste projeto.</p>}
          </>
        )}
        {tab === 'logs' && <LogsTab items={all} />}
        {tab === 'portas' &&
          (ports.length === 0 ? (
            <p className="text-sm text-faint">Este projeto não publica portas.</p>
          ) : (
            <ul>
              {ports.map(({ c, pt }) => (
                <li key={`${c.id}-${pt.hostPort}-${pt.proto}`} className="flex items-center gap-2.5 border-b border-divider py-2.5">
                  <span className="tabular w-14 font-mono text-[13px]">{pt.hostPort}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.label}</span>
                    <span className="block truncate text-[11px] text-faint">
                      {pt.proto} · porta interna {pt.containerPort}
                    </span>
                  </span>
                  <PortLink port={pt} active={c.running} />
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}

function Section({ title, items }: { title: string; items: Container[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-faint">{title}</h3>
      <ul>
        {items.map((c) => {
          const [status, tone] = itemStatus(c)
          const port = c.ports[0]
          return (
            <li key={c.id} className="flex items-center gap-2.5 border-b border-divider py-2.5">
              <Dot tone={tone} />
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-sm font-medium', !c.running && 'text-muted')}>{c.label}</span>
                {c.role === 'app' ? (
                  <span className="block truncate font-mono text-[11px] text-faint" title={shortPath(c.appDir)}>
                    {c.command}
                    {tone !== 'on' && <span className={toneText[tone]}> · {status}</span>}
                  </span>
                ) : (
                  <span className={cx('block truncate text-[11px]', tone === 'on' ? (c.health ? 'text-on-ink' : 'text-faint') : toneText[tone])}>
                    {status}
                  </span>
                )}
              </span>
              {port && <PortLink port={port} active={c.running} compact />}
              <span className="tabular w-14 text-right font-mono text-xs">{c.running ? bytes(c.memUsed) : '—'}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Porta como link (web) ou botão que copia a URL (banco, cache).
function PortLink({ port, active, compact }: { port: Port; active: boolean; compact?: boolean }) {
  const toast = useToast()
  const text = compact ? `:${port.hostPort}` : `localhost:${port.hostPort}`
  const cls = cx('inline-flex items-center gap-1 font-mono text-[11px] transition-colors', active ? 'text-muted hover:text-fg' : 'text-faint')
  if (!port.url) return <span className={cls}>{text}</span>
  if (isWeb(port.url))
    return (
      <a href={port.url} target="_blank" rel="noreferrer" className={cls} title={`Abrir ${port.url}`}>
        {text}
        {!compact && <Icon name="external" className="size-3" />}
      </a>
    )
  return (
    <button
      type="button"
      className={cls}
      title={`Copiar ${port.url}`}
      onClick={async () => {
        if (await copyText(port.url)) toast(`Copiado: ${port.url}`)
      }}
    >
      {text}
      {!compact && <Icon name="copy" className="size-3" />}
    </button>
  )
}

function LogsTab({ items }: { items: Container[] }) {
  const usable = items.filter((c) => c.exists)
  const [id, setId] = useState(() => (usable.find((c) => c.running) ?? usable[0])?.id)
  const current = usable.find((c) => c.id === id) ?? usable[0]
  if (!current) return <p className="text-sm text-faint">Nenhum container foi ligado ainda.</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {usable.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === current.id}
            onClick={() => setId(c.id)}
            className={cx(
              'rounded-md border px-2 py-1 text-xs transition-colors',
              c.id === current.id ? 'border-faint/50 bg-raised text-fg' : 'border-edge text-muted hover:text-fg',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <Logs id={current.id} live={current.running} />
    </div>
  )
}

function Logs({ id, live }: { id: string; live: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let alive = true
    setText(null)
    const load = () =>
      fetchLogs(id)
        .then((t) => alive && (setText(t), setError(null)))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    load()
    const t = live ? setInterval(load, 2000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id, live])

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      {error ? (
        <p className="px-4 py-3 text-xs text-danger">{error}</p>
      ) : text === null ? (
        <p className="flex items-center gap-2 px-4 py-3 text-xs text-faint">
          <Spinner className="size-3" /> Carregando logs…
        </p>
      ) : (
        <pre
          ref={ref}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="max-h-[60vh] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted"
        >
          {text.trim() || 'Sem saída ainda.'}
        </pre>
      )}
    </div>
  )
}
