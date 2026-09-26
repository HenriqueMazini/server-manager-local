import type { ClaudeSummary, HostMem, Project } from '../types'
import { CLAUDE_KEY } from '../colors'
import type { Sample } from '../useSnapshot'
import { bytes, bytesParts, percent } from '../format'

export function MemoryCard({
  host,
  projects,
  claude,
  colors,
  history,
}: {
  host: HostMem
  projects: Project[]
  claude: ClaudeSummary
  colors: Record<string, string>
  history: Sample[]
}) {
  const items = [
    ...(claude.memUsed > 0 ? [{ key: CLAUDE_KEY, name: 'Sessões do Claude', memUsed: claude.memUsed }] : []),
    ...projects.map((p) => ({ key: p.key, name: p.name, memUsed: p.memUsed })),
  ]
  const active = items.filter((p) => p.memUsed > 0)
  const total = active.reduce((n, p) => n + p.memUsed, 0)
  const [value, unit] = bytesParts(total)

  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-faint">Memória dos ambientes de desenvolvimento</h2>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="tabular font-mono text-3xl font-medium tracking-tight">{value}</span>
            <span className="text-lg text-muted">{unit}</span>
            <span className="ml-1 text-sm text-faint">
              {percent(total, host.total)} dos {bytes(host.total)} do computador
            </span>
          </p>
        </div>
        <Sparkline history={history} />
      </div>

      {active.length === 0 ? (
        <p className="mt-3 text-sm text-faint">Nenhum ambiente ligado. Nada de desenvolvimento ocupando memória agora.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Memória por projeto">
            {active.map((p) => (
              <div
                key={p.key}
                title={`${p.name}: ${bytes(p.memUsed)}`}
                className="h-full transition-[flex-grow] duration-700 ease-out first:rounded-l-full last:rounded-r-full"
                style={{ flexGrow: p.memUsed, flexBasis: 0, minWidth: 4, background: colors[p.key] }}
              />
            ))}
          </div>
          <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
            {active.map((p) => (
              <div key={p.key} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: colors[p.key] }} />
                <dt className="text-muted">{p.name}</dt>
                <dd className="tabular font-mono text-fg">{bytes(p.memUsed)}</dd>
                <dd className="text-xs text-faint">{percent(p.memUsed, total)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

function Sparkline({ history }: { history: Sample[] }) {
  const W = 180
  const H = 40
  if (history.length < 2) return <div className="hidden h-10 w-[180px] sm:block" />
  const values = history.map((s) => s.dev)
  const max = Math.max(...values, 1)
  const hi = max * 1.15
  const step = W / (90 - 1)
  const x0 = W - (history.length - 1) * step
  const pts = history.map((s, i) => [x0 + i * step, H - (s.dev / hi) * H] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L${x0.toFixed(1)},${H} Z`
  const [lx, ly] = pts[pts.length - 1]
  const peak = Math.max(...values)
  return (
    <figure className="hidden shrink-0 text-right sm:block" title={`Pico nos últimos 3 min: ${bytes(peak)}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible text-on" aria-hidden>
        <defs>
          <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-line" strokeWidth="1" />
        <path d={area} fill="url(#spark)" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx={lx} cy={ly} r="4" fill="currentColor" className="stroke-surface" strokeWidth="2" />
      </svg>
      <figcaption className="mt-1 text-[11px] text-faint">últimos 3 min · pico {bytes(peak)}</figcaption>
    </figure>
  )
}
