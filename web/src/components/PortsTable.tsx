import { useState } from 'react'
import type { PortEntry } from '../types'
import { cx, Dot, Icon } from './ui'

export function PortsTable({ ports }: { ports: PortEntry[] }) {
  const [open, setOpen] = useState(false)
  const conflicts = new Set(ports.filter((p) => p.conflict).map((p) => p.hostPort)).size
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-faint">Portas</h2>
        <span className="text-xs text-faint">
          {ports.length} em uso{conflicts > 0 && <span className="text-warn-ink"> · {conflicts} em conflito</span>}
        </span>
        <Icon name="chevron" className={cx('ml-auto size-4 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-faint">
              <tr>
                <th className="px-5 py-2.5 font-medium">Porta</th>
                <th className="px-3 py-2.5 font-medium">Quem usa</th>
                <th className="px-3 py-2.5 font-medium">Destino</th>
                <th className="px-5 py-2.5 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((p, i) => (
                <tr key={`${p.hostPort}-${p.proto}-${p.containerName ?? 'host'}-${i}`} className={cx('border-t border-line/70', p.conflict && 'bg-warn/[0.05]')}>
                  <td className="px-5 py-2.5 font-mono">
                    <span className={cx(p.conflict && 'text-warn-ink')}>{p.hostPort}</span>
                    <span className="text-faint">/{p.proto}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.kind === 'host' ? (
                      <span className="text-muted">Processo do computador</span>
                    ) : (
                      <>
                        <span>{p.projectName}</span>
                        <span className="ml-2 text-xs text-faint">{p.label}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">{p.kind === 'host' ? 'fora do painel' : p.containerName?.startsWith('sm-') ? 'app' : `container:${p.containerPort}`}</td>
                  <td className="px-5 py-2.5">
                    <span className="inline-flex items-center gap-2 text-xs text-muted">
                      <Dot tone={p.conflict ? 'warn' : p.running ? 'on' : 'off'} />
                      {p.conflict ? 'conflito' : p.running ? 'em uso' : 'livre (desligado)'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
