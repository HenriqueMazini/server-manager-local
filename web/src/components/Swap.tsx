import type { ReactNode } from 'react'
import type { ClaudeSummary, DevRun, HostApp, HostMem, Pressure, Project } from '../types'
import { bytes, bytesParts, percent } from '../format'
import { devGroups } from './DevRuns'
import { copyText, cx, Icon, useToast, type Tone } from './ui'

// Limites padrão do systemd-oomd no Ubuntu e derivados: com o swap acima de 90%, ou a pressão de memória
// da sua sessão acima de 50% por 20 s, ele encerra processos. É daí que vem o aviso de "memória esgotada"
// mesmo com a RAM longe de cheia.
export const OOMD_SWAP = 90
export const OOMD_PRESSURE = 50

export function swapPct(host: HostMem): number {
  return host.swapTotal ? (host.swapUsed / host.swapTotal) * 100 : 0
}

export function swapTone(host: HostMem, pressure?: Pressure): Tone {
  const pct = swapPct(host)
  if (pct >= 75 || (pressure?.some10 ?? 0) >= 30) return 'danger'
  if (pct >= 50 || (pressure?.some10 ?? 0) >= 10) return 'warn'
  return 'on'
}

// Porcentagem com vírgula, como no resto do painel.
const pctText = (n: number) => n.toFixed(1).replace('.', ',')

const barColor: Record<Tone, string> = { on: 'bg-muted', warn: 'bg-warn', danger: 'bg-danger', off: 'bg-faint', info: 'bg-info' }
const textColor: Record<Tone, string> = { on: 'text-fg', warn: 'text-warn-ink', danger: 'text-danger', off: 'text-faint', info: 'text-info-ink' }

// Barra de uso com a marca do limite do systemd-oomd.
function LimitBar({ pct, limit, tone, label }: { pct: number; limit: number; tone: Tone; label: string }) {
  return (
    <div className="relative mt-2.5 h-2 rounded-full bg-track" role="img" aria-label={label}>
      <div className={cx('h-full rounded-full transition-[width] duration-700', barColor[tone])} style={{ width: `${Math.min(pct, 100)}%` }} />
      <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-danger/70" style={{ left: `${limit}%` }} title={`Limite do systemd-oomd: ${limit}%`} />
    </div>
  )
}

// Número-chave da visão geral.
export function SwapKpiBody({ host, pressure }: { host: HostMem; pressure?: Pressure }) {
  const [v, u] = bytesParts(host.swapUsed)
  const tone = swapTone(host, pressure)
  if (!host.swapTotal) return <span className="text-sm text-faint">Sem swap configurado.</span>
  return (
    <>
      <span className="flex items-baseline gap-1.5">
        <span className={cx('tabular font-mono text-[28px] font-medium leading-none', textColor[tone])}>{v}</span>
        <span className="text-sm text-muted">{u}</span>
        <span className="ml-auto truncate pl-2 text-xs text-faint">
          {percent(host.swapUsed, host.swapTotal)} de {bytes(host.swapTotal)}
        </span>
      </span>
      <div className="relative h-1.5 rounded-full bg-track">
        <div className={cx('h-full rounded-full transition-[width] duration-700', barColor[tone])} style={{ width: `${Math.min(swapPct(host), 100)}%` }} />
        <span className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-danger/70" style={{ left: `${OOMD_SWAP}%` }} />
      </div>
    </>
  )
}

// Três medidores do computador, lado a lado: RAM, swap e pressão de memória, cada um com o limite
// em que o sistema começa a encerrar processos.
export function MemoryMeters({ host, dev, pressure, children }: { host: HostMem; dev: number; pressure?: Pressure; children?: ReactNode }) {
  const w = (n: number) => `${host.total ? Math.min((n / host.total) * 100, 100) : 0}%`
  const others = Math.max(host.used - dev, 0)
  const sTone = swapTone(host)
  const p10 = pressure?.some10 ?? 0
  const pTone: Tone = p10 >= 30 ? 'danger' : p10 >= 10 ? 'warn' : 'on'
  const card = 'flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-4'
  const label = 'text-[11px] uppercase tracking-[0.1em] text-faint'
  return (
    <section aria-label="Memória e disco do computador" className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3.5">
      <div className={card}>
        <span className={label}>RAM</span>
        <span className="flex items-baseline gap-1.5">
          <span className="tabular font-mono text-[26px] font-medium leading-none">{bytesParts(host.used)[0]}</span>
          <span className="text-sm text-muted">{bytesParts(host.used)[1]}</span>
          <span className="ml-auto text-xs text-faint">de {bytes(host.total)}</span>
        </span>
        <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-track" role="img" aria-label={`Desenvolvimento ${bytes(dev)}, outros ${bytes(others)}, livre ${bytes(host.available)}`}>
          <span className="h-full transition-[width] duration-700" style={{ width: w(dev), background: 'var(--series-1)' }} />
          <span className="h-full bg-muted transition-[width] duration-700" style={{ width: w(others) }} />
        </div>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-faint">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: 'var(--series-1)' }} />
            desenvolvimento {bytes(dev)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-muted" />
            outros {bytes(others)}
          </span>
          <span>livre {bytes(host.available)}</span>
        </span>
      </div>

      <div className={card}>
        <span className={label}>Swap</span>
        {host.swapTotal ? (
          <>
            <span className="flex items-baseline gap-1.5">
              <span className={cx('tabular font-mono text-[26px] font-medium leading-none', textColor[sTone])}>{bytesParts(host.swapUsed)[0]}</span>
              <span className="text-sm text-muted">{bytesParts(host.swapUsed)[1]}</span>
              <span className="ml-auto text-xs text-faint">
                {percent(host.swapUsed, host.swapTotal)} de {bytes(host.swapTotal)}
              </span>
            </span>
            <LimitBar pct={swapPct(host)} limit={OOMD_SWAP} tone={sTone} label={`Swap em ${percent(host.swapUsed, host.swapTotal)}`} />
            <span className="text-[11px] text-faint">Acima de {OOMD_SWAP}% (marca vermelha) o sistema encerra processos, mesmo com RAM livre.</span>
          </>
        ) : (
          <span className="text-sm text-faint">Este computador não tem swap.</span>
        )}
      </div>

      <div className={card}>
        <span className={label} title="Fração do tempo em que programas ficaram esperando memória: o computador travando para trocar páginas com o disco.">
          Pressão de memória
        </span>
        {pressure?.available ? (
          <>
            <span className="flex items-baseline gap-1.5">
              <span className={cx('tabular font-mono text-[26px] font-medium leading-none', textColor[pTone])}>{pctText(p10)}</span>
              <span className="text-sm text-muted">%</span>
              <span className="ml-auto text-xs text-faint">
                1 min {pctText(pressure.some60)}% · 5 min {pctText(pressure.some300)}%
              </span>
            </span>
            <LimitBar pct={p10} limit={OOMD_PRESSURE} tone={pTone} label={`Pressão de memória ${pctText(p10)}%`} />
            <span className="text-[11px] text-faint">Acima de {OOMD_PRESSURE}% por 20 s o sistema encerra processos da sua sessão.</span>
          </>
        ) : (
          <span className="text-sm text-faint">Indisponível neste computador.</span>
        )}
      </div>
      {children}
    </section>
  )
}

type Holder = { key: string; label: string; swap: number; action?: { text: string; run: () => void }; hint?: string }

// Cartão do swap em Sistema e limpeza: o que dá para liberar pelo painel, o swap por aplicativo e o
// comando para esvaziar. O uso e os limites ficam nos medidores do topo.
export function SwapCard({
  host,
  claude,
  projects,
  devRuns,
  apps,
  onRestart,
  onSessions,
}: {
  host: HostMem
  claude: ClaudeSummary
  projects: Project[]
  devRuns: DevRun[]
  apps: HostApp[]
  onRestart: (key: string) => void
  onSessions: () => void
}) {
  const toast = useToast()
  if (!host.swapTotal || !host.swapUsed) return null

  const holders: Holder[] = [
    ...((claude.swapUsed ?? 0) > 0
      ? [{ key: 'claude', label: 'Sessões do Claude', swap: claude.swapUsed!, action: { text: 'Ver sessões', run: onSessions }, hint: 'encerre as paradas ou ociosas' }]
      : []),
    ...projects
      .filter((p) => (p.swapUsed ?? 0) > 0)
      .map((p) => ({ key: `p:${p.key}`, label: p.name, swap: p.swapUsed!, action: { text: 'Reiniciar', run: () => onRestart(p.key) } })),
    ...devGroups(devRuns)
      .map((g) => ({ key: `d:${g.key}`, label: `${g.label} · fora do painel`, swap: g.runs.reduce((n, r) => n + (r.swapUsed ?? 0), 0), hint: 'encerre em "Rodando fora do painel"' }))
      .filter((h) => h.swap > 0),
  ].sort((a, b) => b.swap - a.swap)

  const byApp = apps.filter((a) => a.name !== 'Outros' && (a.swap ?? 0) > 0)
  const inProcs = apps.reduce((n, a) => n + (a.swap ?? 0), 0)
  const shared = Math.max(host.swapUsed - inProcs, 0)
  const appRows = [...byApp.map((a) => ({ name: a.name, v: a.swap ?? 0, muted: false })), ...(shared > 0 ? [{ name: 'Memória compartilhada e tmpfs', v: shared, muted: true }] : [])].sort(
    (a, b) => b.v - a.v,
  )
  const fits = host.available > host.swapUsed * 1.2
  const command = 'sudo swapoff -a && sudo swapon -a'
  const h3 = 'mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-faint'

  return (
    <section aria-labelledby="swap-title" className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <header className="flex flex-wrap items-baseline gap-x-2.5 border-b border-line px-[18px] py-3.5">
        <h2 id="swap-title" className="text-sm font-semibold">
          O que está no swap
        </h2>
        <span className="text-xs text-faint">
          {bytes(host.swapUsed)} gravados no disco · liberar devolve para a RAM
        </span>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 px-[18px] py-4 lg:grid-cols-2">
        <div>
          <h3 className={h3}>Dá para liberar pelo painel</h3>
          {holders.length === 0 ? (
            <p className="text-sm text-faint">Nada dos seus projetos ou sessões está no swap.</p>
          ) : (
            <ul>
              {holders.map((h) => (
                <li key={h.key} className="flex min-h-11 items-center gap-2.5 border-t border-divider py-1.5 text-[13px] first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.label}</span>
                    {h.hint && <span className="block truncate text-[11px] text-faint">{h.hint}</span>}
                  </span>
                  <span className="tabular font-mono text-xs">{bytes(h.swap)}</span>
                  {h.action ? (
                    <button type="button" onClick={h.action.run} className="w-24 shrink-0 rounded-lg border border-edge px-2.5 py-1 text-xs text-fg transition-colors hover:border-faint/60 hover:bg-raised">
                      {h.action.text}
                    </button>
                  ) : (
                    <span className="w-24 shrink-0" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className={h3}>Por aplicativo</h3>
          <ul title="Cada aplicativo soma o swap de todos os seus processos (inclui o que aparece ao lado).">
            {appRows.map((a) => (
              <li key={a.name} className="flex min-h-9 items-center gap-2.5 border-t border-divider py-1 text-[13px] first:border-t-0">
                <span className={cx('min-w-0 flex-1 truncate', a.muted && 'text-muted')} title={a.muted ? 'Memória compartilhada e arquivos em tmpfs não pertencem a um processo.' : undefined}>
                  {a.name}
                </span>
                <span className={cx('tabular font-mono text-xs', a.muted && 'text-muted')}>{bytes(a.v)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-soft px-[18px] py-3">
        <span className="min-w-0 flex-[1_1_320px] text-xs leading-relaxed text-faint">
          <span className="font-medium text-fg">Esvaziar o swap:</span> <code className="font-mono text-muted">{command}</code> traz tudo de volta para a RAM e pede a sua senha.{' '}
          {fits ? (
            <span className="text-on-ink">Cabe agora ({bytes(host.available)} livres).</span>
          ) : (
            <span className="text-danger">Não cabe agora ({bytes(host.available)} livres): libere memória antes.</span>
          )}
        </span>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(command)) toast('Comando copiado. Cole num terminal: ele pede a sua senha.')
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-chip px-2.5 py-1 text-xs text-fg hover:border-faint/60"
        >
          <Icon name="copy" className="size-3" />
          Copiar comando
        </button>
      </div>
    </section>
  )
}
