import type { ClaudeSession, ClaudeSummary } from '../types'
import { bytes } from '../format'
import { cx, Dot, Icon, type Tone } from './ui'

const DAY = 24 * 60 * 60 * 1000
// Sessões paradas são classificadas pelo tempo desde a última atualização.
export const RECENT_DAYS = 3 // até 3 dias: recente
export const IDLE_DAYS = 7 // 7 dias ou mais: ociosa

type View = { tone: Tone; label: string; key: 'busy' | 'waiting' | 'recent' | 'stale' | 'idle' }

export function view(s: ClaudeSession, now = Date.now()): View {
  if (s.status === 'busy') return { tone: 'on', label: 'trabalhando', key: 'busy' }
  if (s.status === 'waiting') return { tone: 'warn', label: 'aguardando você', key: 'waiting' }
  const updated = s.updatedAt ? Date.parse(s.updatedAt) : NaN
  if (Number.isNaN(updated)) return { tone: 'off', label: 'parada', key: 'stale' }
  const age = now - updated
  if (age <= RECENT_DAYS * DAY) return { tone: 'warn', label: 'recente', key: 'recent' }
  if (age >= IDLE_DAYS * DAY) return { tone: 'danger', label: 'ociosa', key: 'idle' }
  return { tone: 'off', label: 'parada', key: 'stale' }
}

const toneText: Record<Tone, string> = { on: 'text-on-ink', warn: 'text-warn-ink', danger: 'text-danger', off: 'text-faint' }

// Ordem dos grupos: trabalhando, aguardando você, ociosa, parada, recente. Dentro de cada grupo, por nome.
const groupOrder: Record<View['key'], number> = { busy: 0, waiting: 1, idle: 2, stale: 3, recent: 4 }
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

export function sortSessions(sessions: ClaudeSession[], now = Date.now()): ClaudeSession[] {
  return [...sessions].sort((a, b) => {
    const g = groupOrder[view(a, now).key] - groupOrder[view(b, now).key]
    return g || collator.compare(a.name, b.name) || a.pid - b.pid
  })
}

function summaryText(c: ClaudeSummary): string {
  if (!c.available) return 'indisponível'
  const n = c.sessions.length
  if (n === 0) return 'nenhuma sessão aberta'
  const count = (k: View['key']) => c.sessions.filter((s) => view(s).key === k).length
  const parts = [`${n} ${n === 1 ? 'aberta' : 'abertas'}`]
  const busy = count('busy')
  const waiting = count('waiting')
  const idle = count('idle')
  if (busy) parts.push(`${busy} trabalhando`)
  if (waiting) parts.push(`${waiting} aguardando você`)
  if (idle) parts.push(`${idle} ${idle === 1 ? 'ociosa' : 'ociosas'}`)
  return parts.join(' · ')
}

function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-4', className)} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  )
}

// Linha fixa no topo da lista. Só leitura: o painel não abre nem fecha sessões.
export function ClaudeRow({ claude: c, color, selected, onSelect }: { claude: ClaudeSummary; color: string; selected: boolean; onSelect: () => void }) {
  const busy = c.sessions.some((s) => s.status === 'busy')
  const waiting = c.sessions.some((s) => s.status === 'waiting')
  const tone: Tone = !c.available || c.sessions.length === 0 ? 'off' : waiting ? 'warn' : busy ? 'on' : 'off'
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cx(
        'group min-w-0 rounded-xl border px-3.5 py-2 transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on',
        selected ? 'border-faint/60 bg-raised' : 'border-line bg-surface hover:border-faint/40',
      )}
    >
      <div className="flex items-center gap-3">
        <Dot tone={tone} pulse={busy} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="flex items-center gap-1.5 truncate text-sm font-semibold tracking-tight">
              <ClaudeMark className="size-3.5 text-faint" />
              Sessões do Claude
            </span>
            <span className={cx('truncate text-[11px]', toneText[tone])}>{summaryText(c)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-right">
          {c.memUsed > 0 && <span className="size-1.5 rounded-full" style={{ background: color }} />}
          <span className="tabular w-14 font-mono text-xs text-muted">{c.memUsed > 0 ? bytes(c.memUsed) : '—'}</span>
        </div>
        <Icon name="chevronRight" className={cx('size-4 shrink-0 transition-colors', selected ? 'text-fg' : 'text-faint group-hover:text-muted')} />
      </div>
    </article>
  )
}

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

function since(iso?: string): string {
  const a = ago(iso)
  return a && a !== 'agora' ? `aberta há ${a}` : ''
}

export function ClaudeDetail({ claude: c, color, onClose }: { claude: ClaudeSummary; color: string; onClose: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <ClaudeMark className="mt-1 text-faint" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">Sessões do Claude</h2>
          <p className="mt-0.5 text-xs text-faint">{summaryText(c)} · por grupo e, em cada grupo, por nome</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1.5"><Dot tone="on" /> trabalhando</span>
            <span className="inline-flex items-center gap-1.5"><Dot tone="warn" /> recente: até {RECENT_DAYS} dias, ou aguardando você</span>
            <span className="inline-flex items-center gap-1.5"><Dot tone="off" /> parada</span>
            <span className="inline-flex items-center gap-1.5"><Dot tone="danger" /> ociosa: {IDLE_DAYS} dias ou mais</span>
          </p>
        </div>
        <div className="text-right">
          <div className="tabular font-mono text-sm">{c.memUsed > 0 ? bytes(c.memUsed) : '—'}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] text-faint">
            {c.memUsed > 0 && <span className="size-1.5 rounded-full" style={{ background: color }} />}
            memória
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar detalhes" className="grid size-7 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg lg:hidden">
          <Icon name="close" className="size-3.5" />
        </button>
      </header>
      {!c.available ? (
        <p className="px-5 py-6 text-sm text-faint">O painel não consegue ver os processos do computador. Suba o painel pelo docker-compose do projeto, que monta o /proc em modo somente leitura.</p>
      ) : c.sessions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-faint">Nenhuma sessão do Claude Code aberta agora.</p>
      ) : (
        <ul>
          {sortSessions(c.sessions).map((s) => {
            const v = view(s)
            const extra = s.children.slice(0, 3)
            return (
              <li key={s.pid} className="px-5 py-3 [&+&]:border-t [&+&]:border-line/70">
                <div className="flex items-center gap-4">
                  <Dot tone={v.tone} pulse={s.status === 'busy'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      <span className={cx('shrink-0 text-[11px]', toneText[v.tone])}>{v.label}</span>
                      {s.updatedAt && <span className="shrink-0 text-[11px] text-faint">· {updated(s.updatedAt)}</span>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-faint">
                      {[s.cwd, since(s.startedAt), s.version && `v${s.version}`, `pid ${s.pid}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular font-mono text-xs text-muted">{bytes(s.memUsed)}</div>
                    <div className="text-[11px] text-faint">
                      {s.procs} {s.procs === 1 ? 'processo' : 'processos'}
                    </div>
                  </div>
                </div>
                {extra.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 pl-6 font-mono text-[11px] text-faint">
                    {extra.map((ch, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="min-w-0 flex-1 truncate">↳ {ch.name}</span>
                        <span className="tabular shrink-0">{bytes(ch.memUsed)}</span>
                      </li>
                    ))}
                    {s.children.length > extra.length && <li>↳ mais {s.children.length - extra.length}</li>}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </article>
  )
}
