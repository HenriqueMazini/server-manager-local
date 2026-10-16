import { useState } from 'react'
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
    <section className="h-full rounded-2xl border border-line bg-surface px-5 py-4">
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

const SPARK_W = 200
const SPARK_H = 48
const HISTORY_LEN = 90 // 3 minutos, uma amostra a cada 2 s
const MB = 1024 ** 2

// Escala com zoom: do menor ao maior valor do período, com margem. A faixa mínima (64 MB ou 2% do
// valor) evita que um ruído de poucos MB vire uma montanha.
function domain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const floor = Math.max(64 * MB, max * 0.02)
  const span = Math.max(max - min, floor)
  const mid = (max + min) / 2
  return [Math.max(0, mid - span * 0.65), mid + span * 0.65]
}

function agoText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 5) return 'agora'
  if (s < 60) return `há ${s} s`
  const m = Math.floor(s / 60)
  return `há ${m} min${s % 60 ? ` ${s % 60} s` : ''}`
}

function Sparkline({ history }: { history: Sample[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (history.length < 2) return <div className="hidden h-12 w-[200px] sm:block" />

  const values = history.map((s) => s.dev)
  const [lo, hi] = domain(values)
  const step = SPARK_W / (HISTORY_LEN - 1)
  const x0 = SPARK_W - (history.length - 1) * step
  const y = (v: number) => SPARK_H - ((v - lo) / (hi - lo)) * SPARK_H
  const pts = history.map((s, i) => [x0 + i * step, y(s.dev)] as const)
  const line = pts.map(([x, py], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const area = `${line} L${SPARK_W},${SPARK_H} L${x0.toFixed(1)},${SPARK_H} Z`
  const last = pts.length - 1
  const min = Math.min(...values)
  const max = Math.max(...values)
  const yMax = y(max)
  const yMin = y(min)

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * SPARK_W
    const i = Math.round((x - x0) / step)
    setHover(i < 0 ? null : Math.min(i, last))
  }

  const hi_ = hover ?? last
  const [hx, hy] = pts[hi_]
  const sample = history[hi_]
  const caption =
    hover === null
      ? `últimos 3 min · ${bytes(min)} a ${bytes(max)}`
      : `${bytes(sample.dev)} · ${agoText(history[last].t - sample.t)}`

  return (
    <figure className="hidden shrink-0 text-right sm:block">
      <svg
        width={SPARK_W}
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        className="cursor-crosshair overflow-visible text-on-ink"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Memória dos ambientes nos últimos 3 minutos: de ${bytes(min)} a ${bytes(max)}, agora ${bytes(values[last])}`}
      >
        <defs>
          <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Linhas guia do máximo e do mínimo do período */}
        <line x1="0" x2={SPARK_W} y1={yMax} y2={yMax} className="stroke-line" strokeWidth="1" strokeDasharray="2 3" />
        <line x1="0" x2={SPARK_W} y1={yMin} y2={yMin} className="stroke-line" strokeWidth="1" strokeDasharray="2 3" />
        <path d={area} fill="url(#spark)" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={hx} x2={hx} y1={0} y2={SPARK_H} className="stroke-faint" strokeWidth="1" />}
        <circle cx={hx} cy={hy} r="4" fill="currentColor" className="stroke-surface" strokeWidth="2" />
        {/* Área de toque maior que o desenho */}
        <rect x="0" y="-6" width={SPARK_W} height={SPARK_H + 12} fill="transparent" />
      </svg>
      <figcaption className="tabular mt-1 text-[11px] text-faint">{caption}</figcaption>
    </figure>
  )
}
