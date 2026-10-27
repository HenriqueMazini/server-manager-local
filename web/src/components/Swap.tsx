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

type Holder = { key: string; label: string; swap: number; action?: { text: string; run: () => void }; hint?: string }

// Cartão em Sistema e limpeza: uso do swap, pressão de memória, quem está no swap e o que fazer.
export function SwapCard({
  host,
  pressure,
  claude,
  projects,
  devRuns,
  apps,
  onRestart,
  onSessions,
}: {
  host: HostMem
  pressure?: Pressure
  claude: ClaudeSummary
  projects: Project[]
  devRuns: DevRun[]
  apps: HostApp[]
  onRestart: (key: string) => void
  onSessions: () => void
}) {
  const toast = useToast()
  if (!host.swapTotal) return null
  const pct = swapPct(host)
  const tone = swapTone(host, pressure)

  // O que o painel sabe liberar: reiniciar projeto, encerrar sessão ou servidor fora do painel.
  const holders: Holder[] = [
    ...((claude.swapUsed ?? 0) > 0
      ? [{ key: 'claude', label: 'Sessões do Claude', swap: claude.swapUsed!, action: { text: 'Ver sessões', run: onSessions }, hint: 'encerre as paradas ou ociosas' }]
      : []),
    ...projects
      .filter((p) => (p.swapUsed ?? 0) > 0)
      .map((p) => ({ key: `p:${p.key}`, label: p.name, swap: p.swapUsed!, action: { text: 'Reiniciar', run: () => onRestart(p.key) } })),
    ...devGroups(devRuns)
      .map((g) => ({ key: `d:${g.key}`, label: `${g.label} · fora do painel`, swap: g.runs.reduce((n, r) => n + (r.swapUsed ?? 0), 0), hint: 'encerre no cartão acima' }))
      .filter((h) => h.swap > 0),
  ].sort((a, b) => b.swap - a.swap)

  const byApp = apps.filter((a) => (a.swap ?? 0) > 0)
  const inProcs = byApp.reduce((n, a) => n + (a.swap ?? 0), 0)
  const shared = Math.max(host.swapUsed - inProcs, 0)
  const fits = host.available > host.swapUsed * 1.2
  const command = 'sudo swapoff -a && sudo swapon -a'

  return (
    <section aria-labelledby="swap-title" className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-line bg-surface px-[18px] py-4">
      <header className="flex items-baseline gap-2.5">
        <h2 id="swap-title" className="text-sm font-semibold">
          Swap
        </h2>
        <span className="text-xs text-faint">memória do computador gravada no disco</span>
      </header>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className={cx('tabular font-mono text-[26px] font-medium leading-none', textColor[tone])}>{bytesParts(host.swapUsed)[0]}</span>
          <span className="text-muted">
            {bytesParts(host.swapUsed)[1]} de {bytes(host.swapTotal)} · {percent(host.swapUsed, host.swapTotal)}
          </span>
        </div>
        <LimitBar pct={pct} limit={OOMD_SWAP} tone={tone} label={`Swap em ${percent(host.swapUsed, host.swapTotal)}; o systemd-oomd age a partir de ${OOMD_SWAP}%`} />
        <p className="mt-2 text-xs text-faint">
          A marca vermelha é o limite do systemd-oomd ({OOMD_SWAP}%): passando dele, o sistema encerra processos e avisa que a memória acabou, mesmo com
          RAM livre.
        </p>
      </div>

      {pressure?.available && (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="text-body" title="Fração do tempo em que programas ficaram esperando memória (o computador travando para trocar páginas com o disco).">
              Pressão de memória
            </span>
            <span className="tabular font-mono text-xs text-muted">
              agora {pressure.some10.toFixed(1)}% · 1 min {pressure.some60.toFixed(1)}% · 5 min {pressure.some300.toFixed(1)}%
            </span>
          </div>
          <LimitBar
            pct={pressure.some10}
            limit={OOMD_PRESSURE}
            tone={pressure.some10 >= 30 ? 'danger' : pressure.some10 >= 10 ? 'warn' : 'on'}
            label={`Pressão de memória ${pressure.some10.toFixed(1)}%; o systemd-oomd age acima de ${OOMD_PRESSURE}% por 20 segundos`}
          />
        </div>
      )}

      {holders.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-faint">O que dá para liberar pelo painel</h3>
          <ul>
            {holders.map((h) => (
              <li key={h.key} className="flex items-center gap-2.5 border-t border-divider py-2 text-[13px] first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{h.label}</span>
                  {h.hint && <span className="block truncate text-[11px] text-faint">{h.hint}</span>}
                </span>
                <span className="tabular font-mono text-xs">{bytes(h.swap)}</span>
                {h.action && (
                  <button type="button" onClick={h.action.run} className="shrink-0 rounded-lg border border-edge px-2.5 py-1 text-xs text-fg transition-colors hover:border-faint/60 hover:bg-raised">
                    {h.action.text}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-faint">Por aplicativo</h3>
        <ul title="Cada aplicativo soma o swap de todos os seus processos (inclui os que já aparecem acima).">
          {byApp.map((a) => (
            <li key={a.name} className="flex items-center gap-2.5 border-t border-divider py-[7px] text-[13px] first:border-t-0">
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="tabular font-mono text-xs">{bytes(a.swap ?? 0)}</span>
            </li>
          ))}
          {shared > 0 && (
            <li
              className="flex items-center gap-2.5 border-t border-divider py-[7px] text-[13px]"
              title="Memória compartilhada e arquivos em tmpfs (/dev/shm, /tmp em memória) não pertencem a um processo: vão para o swap sem aparecer na lista."
            >
              <span className="min-w-0 flex-1 truncate text-muted">Memória compartilhada e tmpfs</span>
              <span className="tabular font-mono text-xs text-muted">{bytes(shared)}</span>
            </li>
          )}
        </ul>
      </div>

      <div className="rounded-xl border border-line bg-soft px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-[1_1_220px] text-[13px] font-medium">Esvaziar o swap</span>
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
        <p className="mt-1.5 text-xs leading-relaxed text-faint">
          <code className="font-mono text-muted">{command}</code> traz tudo de volta para a RAM e precisa de root.{' '}
          {fits ? (
            <span className="text-on-ink">Cabe agora: {bytes(host.available)} livres para {bytes(host.swapUsed)} no swap.</span>
          ) : (
            <span className="text-danger">
              Não cabe agora: {bytes(host.available)} livres para {bytes(host.swapUsed)} no swap. Libere memória antes, ou o sistema pode travar.
            </span>
          )}
        </p>
      </div>
    </section>
  )
}
