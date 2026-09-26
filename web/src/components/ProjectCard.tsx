import { useEffect, useRef, useState } from 'react'
import { fetchLogs } from '../api'
import type { Container, Port, Project } from '../types'
import { bytes, displayURL, isWeb, shortPath } from '../format'
import { copyText, cx, Dot, Icon, Spinner, Switch, useToast, type Tone } from './ui'

export type Pending = { running: boolean; busy: boolean; restarting?: boolean }

const stateText: Record<Project['state'], string> = {
  on: 'ligado',
  off: 'desligado',
  partial: 'parcialmente ligado',
  starting: 'iniciando',
}

const stateTone: Record<Project['state'], Tone> = { on: 'on', off: 'off', partial: 'warn', starting: 'warn' }

const healthText: Record<string, string> = { healthy: 'saudável', starting: 'iniciando', unhealthy: 'com falha' }

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

function useStatus(p: Project, pending?: Pending): [string, Tone] {
  const text = pending?.busy
    ? pending.restarting
      ? 'reiniciando…'
      : pending.running
        ? 'ligando…'
        : 'desligando…'
    : stateText[p.state]
  return [text, pending?.busy ? 'warn' : stateTone[p.state]]
}

const toneText: Record<Tone, string> = { on: 'text-on-ink', warn: 'text-warn-ink', danger: 'text-danger', off: 'text-faint' }

type Actions = {
  pending?: Pending
  onToggle: (key: string, running: boolean) => void
  onRestart: (key: string) => void
}

function Controls({ project: p, pending, onToggle, onRestart }: { project: Project } & Actions) {
  const on = p.running > 0
  const checked = pending ? pending.running : on
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRestart(p.key)
        }}
        disabled={!on || pending?.busy}
        title={p.apps.length ? 'Reiniciar os apps para liberar memória' : 'Reiniciar os containers'}
        aria-label={`Reiniciar ${p.name}`}
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-faint/60 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
      >
        {pending?.restarting ? <Spinner className="size-3.5" /> : <Icon name="restart" className="size-3.5" />}
      </button>
      <span onClick={(e) => e.stopPropagation()} className="contents">
        <Switch
          size="sm"
          checked={checked}
          busy={pending?.busy}
          label={checked ? `Desligar ${p.name}` : `Ligar ${p.name}`}
          onChange={(next) => onToggle(p.key, next)}
        />
      </span>
    </>
  )
}

function Links({ project: p, className }: { project: Project; className?: string }) {
  if (!p.links.length) return null
  const live = p.state === 'on' || p.state === 'starting'
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {p.links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Abrir ${l.url}`}
          className={cx(
            'inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors',
            live ? 'border-line bg-raised text-fg hover:border-faint/60' : 'border-dashed border-line text-faint',
          )}
        >
          <span className="font-medium">{l.label}</span>
          <span className="truncate font-mono text-muted">{displayURL(l.url)}</span>
          <Icon name="external" className="size-3 shrink-0 text-faint" />
        </a>
      ))}
    </div>
  )
}

// Linha compacta da lista de projetos. Clicar seleciona o projeto e abre os detalhes à direita.
export function ProjectRow({
  project: p,
  color,
  selected,
  onSelect,
  ...actions
}: { project: Project; color: string; selected: boolean; onSelect: (key: string) => void } & Actions) {
  const [state, tone] = useStatus(p, actions.pending)
  const on = p.running > 0
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(p.key)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect(p.key)
        }
      }}
      className={cx(
        'group min-w-0 cursor-pointer rounded-xl border px-3.5 py-2 transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on',
        selected ? 'border-faint/60 bg-raised' : 'border-line bg-surface hover:border-faint/40',
        !on && !selected && 'bg-surface/60',
      )}
    >
      <div className="flex items-center gap-3">
        <Dot tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cx('truncate text-sm font-semibold tracking-tight', !on && 'text-muted')}>{p.name}</span>
            <span className={cx('shrink-0 text-[11px]', toneText[tone])}>{state}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-right">
          {on && <span className="size-1.5 rounded-full" style={{ background: color }} />}
          <span className="tabular w-14 font-mono text-xs text-muted">{on ? bytes(p.memUsed) : '—'}</span>
        </div>
        <Controls project={p} {...actions} />
        <Icon
          name="chevronRight"
          className={cx('size-4 shrink-0 transition-colors', selected ? 'text-fg' : 'text-faint group-hover:text-muted')}
        />
      </div>
      {(p.links.length > 0 || p.warnings.length > 0) && (
        <div className="mt-1 space-y-1 pl-5">
          <Links project={p} />
          {p.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-[11px] text-warn-ink">
              <Icon name="alert" className="mt-px size-3 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}
    </article>
  )
}

// Detalhes do projeto selecionado: apps e containers com estado, portas, memória e logs.
export function ProjectDetail({ project: p, color, onClose, ...actions }: { project: Project; color: string; onClose: () => void } & Actions) {
  const [state, tone] = useStatus(p, actions.pending)
  const on = p.running > 0
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-[7px]">
          <Dot tone={tone} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h2 className="text-base font-semibold tracking-tight">{p.name}</h2>
            <span className={cx('text-xs', toneText[tone])}>{state}</span>
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-faint">
            <span>
              {p.apps.length > 0 && `${p.apps.length} ${p.apps.length === 1 ? 'app' : 'apps'} · `}
              {p.infra.length} {p.infra.length === 1 ? 'container' : 'containers'}
            </span>
            {p.dir && <span className="truncate font-mono">{shortPath(p.dir)}</span>}
          </p>
          <Links project={p} className="mt-2" />
        </div>
        <div className="hidden text-right sm:block">
          <div className="tabular font-mono text-sm">{on ? bytes(p.memUsed) : '—'}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] text-faint">
            {on && <span className="size-1.5 rounded-full" style={{ background: color }} />}
            memória
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Controls project={p} {...actions} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhes"
            className="grid size-7 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg lg:hidden"
          >
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      </header>
      {p.apps.length > 0 && <Section title="Apps" items={p.apps} />}
      {p.infra.length > 0 && <Section title="Infraestrutura" items={p.infra} />}
    </article>
  )
}

function Section({ title, items }: { title: string; items: Container[] }) {
  return (
    <section className="[&+&]:border-t [&+&]:border-line/70">
      <h4 className="px-5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{title}</h4>
      <ul>
        {items.map((c) => (
          <Item key={c.id} c={c} />
        ))}
      </ul>
    </section>
  )
}

function Item({ c }: { c: Container }) {
  const [logs, setLogs] = useState(false)
  const [status, tone] = itemStatus(c)
  const sub =
    c.role === 'app'
      ? `${c.command} · ${shortPath(c.appDir)}`
      : `${c.composeService ? `${c.name} · ` : ''}${c.image}`
  return (
    <li className="px-5 py-2.5">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_4.5rem_auto]">
        <Dot tone={tone} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className={cx('truncate text-sm font-medium', !c.running && 'text-muted')}>{c.label}</span>
            <span className={cx('shrink-0 text-[11px]', tone === 'warn' || tone === 'danger' ? 'text-warn-ink' : 'text-faint')}>{status}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-faint">{sub}</div>
        </div>
        <div className="col-span-3 col-start-2 flex flex-wrap gap-1.5 sm:col-span-1 sm:col-start-auto sm:justify-end">
          {c.ports.map((pt) => (
            <PortChip key={`${pt.hostPort}/${pt.proto}`} port={pt} active={c.running} />
          ))}
        </div>
        <div className="tabular hidden text-right font-mono text-xs text-muted sm:block">{c.running ? bytes(c.memUsed) : '—'}</div>
        <button
          type="button"
          disabled={!c.exists}
          onClick={() => setLogs((l) => !l)}
          aria-expanded={logs}
          title={c.exists ? 'Ver logs' : 'Ainda não foi ligado'}
          className={cx(
            'row-start-1 col-start-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors sm:row-start-auto sm:col-start-auto',
            'text-faint hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-40',
            logs && 'bg-raised text-fg',
          )}
        >
          <Icon name="terminal" className="size-3.5" />
          logs
        </button>
      </div>
      {logs && <Logs id={c.id} live={c.running} />}
    </li>
  )
}

function Logs({ id, live }: { id: string; live: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLPreElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let alive = true
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
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-bg">
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
          className="max-h-72 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted"
        >
          {text.trim() || 'Sem saída ainda.'}
        </pre>
      )}
    </div>
  )
}

function PortChip({ port, active }: { port: Port; active: boolean }) {
  const toast = useToast()
  const base = cx(
    'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] transition-colors',
    active ? 'border-line bg-surface text-fg hover:border-faint/60' : 'border-dashed border-line text-faint',
  )
  if (!port.url) return <span className={base}>{port.hostPort}/{port.proto}</span>
  const scheme = port.url.split('://')[0]
  const content = (
    <>
      <span className={active ? 'text-faint' : ''}>{scheme}</span>
      <span>localhost:{port.hostPort}</span>
    </>
  )
  if (isWeb(port.url)) {
    return (
      <a href={port.url} target="_blank" rel="noreferrer" className={base} title={`Abrir ${port.url}`}>
        {content}
        <Icon name="external" className="size-3 text-faint" />
      </a>
    )
  }
  return (
    <button
      type="button"
      className={base}
      title={`Copiar ${port.url}`}
      onClick={async () => {
        if (await copyText(port.url)) toast(`Copiado: ${port.url}`)
      }}
    >
      {content}
      <Icon name="copy" className="size-3 text-faint" />
    </button>
  )
}
