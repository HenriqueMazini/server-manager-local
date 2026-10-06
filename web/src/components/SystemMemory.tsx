import type { HostApp, HostMem } from '../types'
import { bytes, bytesParts, percent } from '../format'
import { Icon } from './ui'

// Só aparecem aplicativos acima deste consumo.
const MIN_APP = 1024 ** 3

// Memória da máquina inteira e os aplicativos que passam de 1 GB. Mesmo desenho do cartão dos ambientes.
export function SystemMemory({ host, apps }: { host: HostMem; apps: HostApp[] }) {
  const big = apps.filter((a) => a.name !== 'Outros' && a.memUsed >= MIN_APP)
  const cache = Math.min(host.cached, host.available)
  const w = (n: number) => `${host.total ? Math.min((n / host.total) * 100, 100) : 0}%`
  const [value, unit] = bytesParts(host.used)

  return (
    <section className="h-full rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-faint">
            Memória do computador
            <span
              className="normal-case tracking-normal"
              title="Aplicativos acima de 1 GB. Cada um soma a memória de todos os seus processos; memória compartilhada entre processos entra em cada um, então a soma passa do total em uso."
            >
              <Icon name="infoCircle" className="size-3.5" />
            </span>
          </h2>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="tabular font-mono text-3xl font-medium tracking-tight">{value}</span>
            <span className="text-lg text-muted">{unit}</span>
            <span className="ml-1 text-sm text-faint">
              {percent(host.used, host.total)} de {bytes(host.total)}
            </span>
          </p>
        </div>
        <div className="shrink-0 pt-0.5 text-right">
          <div className="tabular font-mono text-sm text-fg">{bytes(host.available)}</div>
          <div className="text-[11px] text-faint">disponível</div>
        </div>
      </div>

      <div
        className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full bg-track"
        role="img"
        aria-label={`${bytes(host.used)} em uso e ${bytes(cache)} em cache, de ${bytes(host.total)}`}
      >
        <div className="h-full rounded-l-full bg-fg/75 transition-[width] duration-700" style={{ width: w(host.used) }} title={`Em uso: ${bytes(host.used)}`} />
        <div className="h-full bg-faint/35 transition-[width] duration-700" style={{ width: w(cache) }} title={`Cache, liberado quando preciso: ${bytes(cache)}`} />
      </div>

      {big.length === 0 ? (
        <p className="mt-2.5 text-xs text-faint">Nenhum aplicativo passa de 1 GB.</p>
      ) : (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
          {big.map((a) => (
            <div key={a.name} className="min-w-0" title={`${a.name}: ${bytes(a.memUsed)} somando ${a.procs} ${a.procs === 1 ? 'processo' : 'processos'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-muted">{a.name}</dt>
                <dd className="tabular shrink-0 font-mono text-fg">{bytes(a.memUsed)}</dd>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-muted/70 transition-[width] duration-700" style={{ width: w(a.memUsed) }} />
              </div>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
