import type { ClaudeSession, ClaudeSummary, ClosedSession, Project } from '../types'
import { deleteClaudeSession, deleteClosedSession } from '../api'
import { bytes, shortPath } from '../format'
import { copyText, cx, Dot, Icon, useToast, type Tone } from './ui'
import { useState } from 'react'
import { ConfirmDeleteSession, type DeleteTarget } from './ConfirmDelete'

const DAY = 24 * 60 * 60 * 1000
// Sessões paradas são classificadas pelo tempo desde a última atualização.
export const RECENT_DAYS = 3 // até 3 dias: recente
export const IDLE_DAYS = 7 // 7 dias ou mais: ociosa
export const REPLY_MINUTES = 30 // saiu de trabalhando há até 30 min: aguardando resposta

export type View = { tone: Tone; label: string; key: 'busy' | 'waiting' | 'reply' | 'recent' | 'stale' | 'idle' }

// Data em milissegundos, ou NaN quando falta ou é a data vazia (ano 1) que versões antigas do servidor mandavam.
export function stamp(iso?: string): number {
  const t = iso ? Date.parse(iso) : NaN
  return t > Date.UTC(2000, 0, 1) ? t : NaN
}

export function view(s: ClaudeSession, now = Date.now()): View {
  if (s.status === 'busy') return { tone: 'on', label: 'trabalhando', key: 'busy' }
  if (s.status === 'waiting') return { tone: 'warn', label: 'aguardando você', key: 'waiting' }
  const updated = stamp(s.updatedAt)
  if (Number.isNaN(updated)) return { tone: 'off', label: 'parada', key: 'stale' }
  const age = now - updated
  // O horário é o da última mudança de estado: parada há pouco = acabou de sair de trabalhando.
  if (age <= REPLY_MINUTES * 60 * 1000) return { tone: 'info', label: 'aguardando resposta', key: 'reply' }
  if (age <= RECENT_DAYS * DAY) return { tone: 'warn', label: 'recente', key: 'recent' }
  if (age >= IDLE_DAYS * DAY) return { tone: 'danger', label: 'ociosa', key: 'idle' }
  return { tone: 'off', label: 'parada', key: 'stale' }
}

const toneText: Record<Tone, string> = { on: 'text-on-ink', warn: 'text-warn-ink', danger: 'text-danger', off: 'text-faint', info: 'text-info-ink' }

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

function ago(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!(ms >= 0)) return ''
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d) return `${d}d ${h % 24}h`
  if (h) return `${h}h ${m % 60}min`
  if (m) return `${m}min`
  return 'agora'
}

function updated(iso?: string): string {
  const a = ago(iso)
  return a === 'agora' ? 'atualizada agora' : a && `atualizada há ${a}`
}

// Grupos da tela, na ordem do design: primeiro o que pede você, depois o resto.
export const GROUPS: { key: View['key']; title: string; hint: string; tone: Tone; rule: string }[] = [
  { key: 'waiting', title: 'Aguardando você', hint: 'o Claude pediu sua ação', tone: 'warn', rule: 'o Claude Code pediu sua ação, como uma permissão' },
  { key: 'reply', title: 'Aguardando resposta', hint: `terminou há menos de ${REPLY_MINUTES} min`, tone: 'info', rule: `saiu de trabalhando há até ${REPLY_MINUTES} min` },
  { key: 'busy', title: 'Trabalhando', hint: '', tone: 'on', rule: 'o Claude está executando' },
  { key: 'recent', title: 'Recentes', hint: `até ${RECENT_DAYS} dias`, tone: 'warn', rule: `atualizada há até ${RECENT_DAYS} dias` },
  { key: 'stale', title: 'Paradas', hint: `entre ${RECENT_DAYS} e ${IDLE_DAYS} dias`, tone: 'off', rule: `entre ${RECENT_DAYS} e ${IDLE_DAYS} dias, ou sem data` },
  { key: 'idle', title: 'Ociosas', hint: `${IDLE_DAYS} dias ou mais, pode encerrar`, tone: 'danger', rule: `sem atualização há ${IDLE_DAYS} dias ou mais` },
]

const toneColor: Record<Tone, string> = { on: 'var(--on)', warn: 'var(--warn)', info: 'var(--info)', danger: 'var(--danger)', off: 'var(--faint)' }

// Há quanto tempo a sessão mudou de estado, em texto curto.
function when(s: ClaudeSession): string {
  if (s.status === 'busy') return 'agora'
  const t = stamp(s.updatedAt)
  if (Number.isNaN(t)) return 'sem data'
  const m = Math.floor((Date.now() - t) / 60000)
  if (!(m >= 1)) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

// Botão "O que cada status quer dizer": abre a legenda com o mouse, o foco ou um clique.
export function StatusHelp() {
  const [open, setOpen] = useState(false)
  return (
    <span className="group/help relative inline-flex" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-describedby="status-help"
        className="inline-flex items-center gap-1.5 rounded-[10px] border border-edge bg-surface px-3 py-2 text-xs text-muted transition-colors hover:text-fg"
      >
        <Icon name="infoCircle" className="size-3.5" />
        O que cada status quer dizer
      </button>
      <span
        id="status-help"
        role="tooltip"
        className={cx(
          'absolute right-0 top-11 z-30 w-80 rounded-xl border border-line bg-surface p-3 text-left shadow-2xl transition-opacity',
          open ? 'visible opacity-100' : 'invisible opacity-0 group-hover/help:visible group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:opacity-100',
        )}
      >
        <span className="block space-y-1.5">
          {GROUPS.map((g) => (
            <span key={g.key} className="flex items-start gap-2 text-xs leading-snug">
              <span className="mt-1">
                <Dot tone={g.tone} />
              </span>
              <span>
                <span className={cx('font-medium', toneText[g.tone])}>{g.title}</span>
                <span className="text-muted">: {g.rule}</span>
              </span>
            </span>
          ))}
        </span>
        <span className="mt-2.5 block border-t border-line pt-2 text-[11px] text-faint">A lista segue esta ordem e, dentro de cada status, da atualizada mais recentemente para a mais antiga.</span>
      </span>
    </span>
  )
}

export type SessionsBy = 'status' | 'projeto'

const square = 'grid size-8 shrink-0 place-items-center rounded-lg border border-edge transition-colors'
const groupIndex = (k: View['key']) => GROUPS.findIndex((g) => g.key === k)
// Dentro do mesmo status, a atualizada mais recentemente primeiro; empate, pelo nome.
const recency = (s: ClaudeSession) => stamp(s.updatedAt) || stamp(s.startedAt) || 0
const byTime = (a: ClaudeSession, b: ClaudeSession) => recency(b) - recency(a) || collator.compare(a.name, b.name) || a.pid - b.pid

// Uma sessão aberta. Na visão por projeto, o status vira uma coluna.
function SessionRow({
  s,
  v,
  showStatus,
  muted,
  onToggleMute,
  onDelete,
}: {
  s: ClaudeSession
  v: View
  showStatus?: boolean
  muted?: Set<number>
  onToggleMute?: (pid: number) => void
  onDelete?: () => void
}) {
  const g = GROUPS[groupIndex(v.key)]
  return (
    <li
      className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-divider px-4 py-[13px] first:border-t-0"
      style={{ boxShadow: `inset 3px 0 0 ${toneColor[g.tone]}` }}
    >
      <span className="min-w-0 flex-[1_1_260px]">
        <span className="block truncate text-sm font-semibold">{s.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span
            className={cx('truncate font-mono text-[11px] text-faint', s.cwdGone && 'line-through')}
            title={`pid ${s.pid}${s.version ? ` · v${s.version}` : ''} · ${s.procs} ${s.procs === 1 ? 'processo' : 'processos'}`}
          >
            {s.cwd}
          </span>
          {s.cwdGone && (
            <span
              className="shrink-0 rounded-full bg-danger/10 px-2 py-px text-[11px] font-medium text-danger"
              title="A pasta foi apagada com a sessão aberta (por exemplo, uma worktree removida). O Claude continua rodando sem lugar para trabalhar: encerre a sessão."
            >
              pasta apagada
            </span>
          )}
        </span>
      </span>
      {showStatus && (
        <span className={cx('flex w-[150px] items-center gap-2 text-xs', toneText[g.tone])}>
          <Dot tone={g.tone} pulse={s.status === 'busy'} />
          {g.title}
        </span>
      )}
      <span className="w-[120px] text-xs text-muted">{when(s)}</span>
      <span className="tabular w-16 text-right font-mono text-xs">{bytes(s.memUsed)}</span>
      <span className="flex gap-1">
        {muted && onToggleMute && (
          <button
            type="button"
            onClick={() => onToggleMute(s.pid)}
            aria-pressed={muted.has(s.pid)}
            aria-label={muted.has(s.pid) ? `Reativar alertas de ${s.name}` : `Silenciar alertas de ${s.name}`}
            title={muted.has(s.pid) ? 'Silenciada: sem alerta e som. Clique para reativar.' : 'Silenciar alerta e som desta sessão'}
            className={cx(square, muted.has(s.pid) ? 'text-faint hover:text-fg' : 'text-muted hover:text-fg')}
          >
            <Icon name={muted.has(s.pid) ? 'bellOff' : 'bell'} className="size-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Encerrar e apagar a sessão ${s.name}`}
            title="Encerrar e apagar esta sessão"
            className={cx(square, 'text-muted hover:border-danger/40 hover:text-danger')}
          >
            <Icon name="trash" className="size-3.5" />
          </button>
        )}
      </span>
    </li>
  )
}

// Sessões abertas agrupadas por status ou por projeto, com silenciar e apagar; as encerradas ficam recolhidas no fim.
export function SessionsList({
  claude: c,
  muted,
  onToggleMute,
  projects = [],
  filter,
  by = 'status',
  project,
}: {
  claude: ClaudeSummary
  muted?: Set<number> // ausente quando os alertas estão desligados nas configurações
  onToggleMute?: (pid: number) => void
  projects?: Project[]
  filter?: View['key'][] // só estes status; sem filtro também mostra as encerradas
  by?: SessionsBy
  project?: string // chave de um projeto (de placer): só as sessões dele, abertas e encerradas
}) {
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const askDelete = (s: ClaudeSession) =>
    setDeleting({ name: s.name, cwd: s.cwd, open: true, working: s.status === 'busy', run: () => deleteClaudeSession(s.pid) })
  const now = Date.now()
  const place = placer(projects)
  const inProject = (cwd?: string) => !project || place(cwd).key === project
  const open = c.sessions
    .filter((s) => inProject(s.cwd))
    .map((s) => ({ s, v: view(s, now) }))
    .filter(({ v }) => !filter || filter.includes(v.key))
  const row = ({ s, v }: { s: ClaudeSession; v: View }, showStatus?: boolean) => (
    <SessionRow
      key={s.pid}
      s={s}
      v={v}
      showStatus={showStatus}
      muted={muted}
      onToggleMute={onToggleMute}
      onDelete={c.canDelete && s.id ? () => askDelete(s) : undefined}
    />
  )

  let body
  if (by === 'projeto') {
    const map = new Map<string, Place & { items: typeof open }>()
    for (const it of open) {
      const pl = place(it.s.cwd)
      const g = map.get(pl.key) ?? { ...pl, items: [] }
      g.items.push(it)
      map.set(pl.key, g)
    }
    // Dentro do projeto, por status e depois pelo tempo; os projetos com algo pedindo você vêm primeiro.
    const groups = [...map.values()].map((g) => ({
      ...g,
      items: g.items.sort((a, b) => groupIndex(a.v.key) - groupIndex(b.v.key) || byTime(a.s, b.s)),
    }))
    groups.sort((a, b) => groupIndex(a.items[0].v.key) - groupIndex(b.items[0].v.key) || b.items.length - a.items.length || collator.compare(a.label, b.label))
    body = groups.map((g) => {
      const mem = g.items.reduce((n, it) => n + it.s.memUsed, 0)
      return (
        <section key={g.key} className="flex flex-col gap-2">
          <h2 className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-sm font-semibold">{g.label}</span>
            {g.path !== g.label && <span className="truncate font-mono text-[11px] text-faint">{g.path}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {GROUPS.map((st) => {
                const n = g.items.filter((it) => it.v.key === st.key).length
                return (
                  n > 0 && (
                    <span key={st.key} className={cx('flex items-center gap-1.5', toneText[st.tone])} title={st.title}>
                      <Dot tone={st.tone} />
                      {n} {st.title.toLowerCase()}
                    </span>
                  )
                )
              })}
              <span className="tabular font-mono text-faint">{bytes(mem)}</span>
            </span>
          </h2>
          <ul className="overflow-hidden rounded-[14px] border border-line bg-surface">{g.items.map((it) => row(it, true))}</ul>
        </section>
      )
    })
  } else {
    body = GROUPS.map((g) => ({ ...g, items: open.filter((it) => it.v.key === g.key).sort((a, b) => byTime(a.s, b.s)) }))
      .filter((g) => g.items.length)
      .map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <h2 className={cx('flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em]', toneText[g.tone])}>
            {g.title}
            {g.hint && <span className="normal-case tracking-normal text-faint">· {g.hint}</span>}
          </h2>
          <ul className="overflow-hidden rounded-[14px] border border-line bg-surface">{g.items.map((it) => row(it))}</ul>
        </section>
      ))
  }

  return (
    <>
      {deleting && <ConfirmDeleteSession target={deleting} onClose={() => setDeleting(null)} />}
      {!c.available ? (
        <p className="rounded-[14px] border border-line bg-surface px-5 py-6 text-sm text-faint">
          O painel não consegue ver os processos do computador. Suba o painel pelo docker-compose do projeto, que monta o /proc em modo somente leitura.
        </p>
      ) : open.length === 0 ? (
        <p className="rounded-[14px] border border-line bg-surface px-5 py-6 text-sm text-faint">
          {project || filter ? 'Nenhuma sessão aberta com este filtro.' : 'Nenhuma sessão do Claude Code aberta agora.'}
        </p>
      ) : (
        body
      )}
      {!filter && (
        <ClosedList
          closed={(c.closed ?? []).filter((x) => inProject(x.cwd))}
          projects={projects}
          canDelete={!!c.canDelete}
          onDelete={(x) => setDeleting({ name: x.name, cwd: x.cwd, open: false, working: false, run: () => deleteClosedSession(x.id) })}
        />
      )}
    </>
  )
}

const PER_GROUP = 5

function sizeText(b: number): string {
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

type ClosedGroup = { key: string; label: string; path?: string; items: ClosedSession[] }

export type Place = { key: string; label: string; path: string }

// Projeto de uma pasta: a pasta de um projeto do painel (a mais específica ganha) ou, para uma worktree,
// o projeto principal. Pasta irmã "<projeto>-algo" sem containers também conta como worktree dele.
// Fora disso, o nome da própria pasta.
export function placer(projects: Project[]): (cwd?: string) => Place {
  const dirs = projects
    .filter((p) => p.dir)
    .map((p) => ({
      name: p.worktree ? p.worktree.mainName : p.name,
      main: shortPath(p.worktree ? p.worktree.mainDir : p.dir).replace(/\/$/, ''),
      dir: shortPath(p.dir).replace(/\/$/, ''),
    }))
    .sort((a, b) => b.dir.length - a.dir.length)
  const mains = dirs.filter((d) => d.dir === d.main)
  return (raw) => {
    const cwd = (raw ?? '').replace(/\/$/, '')
    const hit = dirs.find((d) => cwd === d.dir || cwd.startsWith(d.dir + '/'))
    if (hit) return { key: `p:${hit.main}`, label: hit.name, path: hit.main }
    const sibling = mains.find((m) => {
      const parent = m.main.slice(0, m.main.lastIndexOf('/'))
      const base = m.main.slice(parent.length + 1)
      return cwd.startsWith(`${parent}/${base}-`)
    })
    if (sibling) return { key: `p:${sibling.main}`, label: sibling.name, path: sibling.main }
    return { key: `d:${cwd}`, label: cwd.split('/').filter(Boolean).pop() || 'sem pasta', path: cwd }
  }
}

// Agrupa por projeto. Grupos pela conversa mais recente; dentro, da mais recente para a mais antiga.
function groupClosed(closed: ClosedSession[], projects: Project[]): ClosedGroup[] {
  const place = placer(projects)
  const groups = new Map<string, ClosedGroup>()
  for (const c of closed) {
    const pl = place(c.cwd)
    const g = groups.get(pl.key) ?? { ...pl, items: [] }
    g.items.push(c)
    groups.set(pl.key, g)
  }
  const byDate = (a: ClosedSession, b: ClosedSession) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  const out = [...groups.values()]
  out.forEach((g) => g.items.sort(byDate))
  return out.sort((a, b) => byDate(a.items[0], b.items[0]))
}

// Conversas guardadas sem processo aberto, no fim da lista e em cinza, agrupadas por projeto.
function ClosedList({
  closed,
  projects,
  canDelete,
  onDelete,
}: {
  closed: ClosedSession[]
  projects: Project[]
  canDelete: boolean
  onDelete: (c: ClosedSession) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState(false)
  const toast = useToast()
  if (!closed.length) return null
  const groups = groupClosed(closed, projects)
  const resume = async (c: ClosedSession) => {
    const dir = c.cwd ? (c.cwd.startsWith('~/') ? `"$HOME/${c.cwd.slice(2)}"` : `"${c.cwd}"`) : ''
    const cmd = dir ? `cd ${dir} && claude --resume ${c.id}` : `claude --resume ${c.id}`
    if (await copyText(cmd)) toast('Comando copiado. Cole num terminal para retomar a conversa.')
  }
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-soft">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3.5 text-left text-muted hover:text-fg"
      >
        <Icon name="chevronRight" className={cx('size-3.5 transition-transform', expanded && 'rotate-90')} />
        <span className="flex-1 font-medium">Encerradas</span>
        <span className="text-xs text-faint">
          {closed.length} {closed.length === 1 ? 'sessão' : 'sessões'} em {groups.length} {groups.length === 1 ? 'projeto' : 'projetos'} · retomáveis com claude --resume
        </span>
      </button>
      {expanded && groups.map((g) => {
        const all = open[g.key]
        const shown = all ? g.items : g.items.slice(0, PER_GROUP)
        return (
          <div key={g.key} className="pb-1">
            <div className="flex items-baseline gap-2 px-5 pb-1 pt-2.5">
              <span className="text-xs font-semibold text-muted">{g.label}</span>
              <span className="text-[11px] text-faint">{g.items.length}</span>
              {g.path && g.path !== g.label && <span className="truncate font-mono text-[11px] text-faint">{g.path}</span>}
            </div>
            <ul className="mx-3 overflow-hidden rounded-lg border border-line/70">
              {shown.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 [&+&]:border-t [&+&]:border-line/70">
                  <Dot tone="off" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-muted">{c.name}</span>
                      <span className="shrink-0 text-[11px] text-faint">{updated(c.updatedAt)}</span>
                    </div>
                    {c.cwd && c.cwd.replace(/\/$/, '') !== g.path && (
                      <div className="truncate font-mono text-[11px] text-faint">{c.cwd}</div>
                    )}
                  </div>
                  <span className="tabular shrink-0 font-mono text-[11px] text-faint" title="Tamanho da conversa guardada">
                    {sizeText(c.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => resume(c)}
                    aria-label={`Copiar comando para retomar ${c.name}`}
                    title="Copiar o comando para retomar esta conversa"
                    className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-fg"
                  >
                    <Icon name="terminal" className="size-3.5" />
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(c)}
                      aria-label={`Apagar a conversa ${c.name}`}
                      title="Apagar esta conversa"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Icon name="trash" className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
              {g.items.length > PER_GROUP && (
                <li className="border-t border-line/70">
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [g.key]: !all }))}
                    className="w-full px-3 py-2 text-left text-xs text-muted hover:bg-raised hover:text-fg"
                  >
                    {all ? 'Mostrar menos' : `Mostrar mais ${g.items.length - PER_GROUP}`}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )
      })}
      {expanded && <div className="h-2" />}
    </section>
  )
}
