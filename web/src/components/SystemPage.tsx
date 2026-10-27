import { useEffect, useState } from 'react'
import { removeOrphans } from '../api'
import type { Conflict, HostApp, HostMem, Orphan, PortEntry, Temporary } from '../types'
import { bytes, bytesParts, shortPath } from '../format'
import { copyText, cx, Icon, Spinner, useToast } from './ui'

// Conflito de porta: quem não sobe, quem ocupa, a porta sugerida e o prompt para o Claude Code do projeto.
export function ConflictCard({ c }: { c: Conflict }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const m = c.mover
  const where = m.app ? shortPath(m.appDir) : m.workingDir ? shortPath(m.workingDir) : null
  const copy = async () => {
    if (await copyText(c.prompt)) {
      setCopied(true)
      toast(where ? `Prompt copiado. Cole no Claude Code em ${where}` : 'Prompt copiado. Cole no Claude Code de qualquer pasta.')
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <article className="flex flex-col gap-2.5 rounded-[14px] border border-warn/25 bg-warn/[0.05] px-[18px] py-4">
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn-ink">Conflito de porta</span>
        <span className="font-mono text-[13px]">{c.hostPort}</span>
      </div>
      <p className="text-sm text-body">
        {m.projectName} ({m.label}) {m.running ? 'disputa a porta com' : 'não sobe porque'}{' '}
        {c.keeper ? (
          <>
            {c.keeper.projectName} {c.keeper.running ? 'já usa' : 'também usa'} a {c.hostPort}
          </>
        ) : (
          <>um processo do computador, fora do Docker, já usa a {c.hostPort}</>
        )}
        . Sugestão: mudar {m.projectName} para <span className="font-mono">{c.proposedPort}</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-[7px] text-xs font-semibold text-bg hover:opacity-90">
          {copied && <Icon name="check" className="size-3" />}
          {copied ? 'Copiado' : 'Copiar prompt para o Claude'}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-lg px-2 py-[7px] text-xs text-muted hover:text-fg">
          {open ? 'Esconder prompt' : 'Ver prompt'}
        </button>
      </div>
      {open && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-3.5 py-3 font-mono text-[11px] leading-relaxed text-muted">
          {c.prompt}
        </pre>
      )}
    </article>
  )
}

// Containers de app que o painel criou para um projeto ou app que não existe mais no services.yml.
export function OrphansCard({ orphans }: { orphans: Orphan[] }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // A confirmação expira sozinha: um clique esquecido não vira remoção depois.
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(t)
  }, [confirming])

  if (!orphans.length) return null
  const n = orphans.length
  const remove = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setBusy(true)
    try {
      const r = await removeOrphans()
      toast(r === 1 ? '1 container antigo removido.' : `${r} containers antigos removidos.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const running = orphans.filter((o) => o.running).length
  return (
    <article className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-3.5">
      <span className="min-w-0 flex-[1_1_280px]" title="Apps que o painel criou para um projeto ou app que mudou de nome no services.yml. O código não é tocado: só o container sai.">
        <span className="block font-semibold">{n === 1 ? '1 container sem projeto' : `${n} containers sem projeto`}</span>
        <span className="mt-0.5 block truncate text-xs text-faint">
          {orphans.map((o) => o.name).join(', ')} · {running ? `${running} ${running === 1 ? 'ligado' : 'ligados'}` : n === 1 ? 'parado' : 'parados'}
        </span>
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-[7px] text-xs transition-colors',
          confirming ? 'bg-danger font-semibold text-white hover:opacity-90' : 'border border-edge bg-chip text-fg hover:border-faint/60',
        )}
      >
        {busy && <Spinner className="size-3" />}
        {confirming ? 'Confirmar' : 'Apagar'}
      </button>
    </article>
  )
}

// Containers que ferramentas criam e apagam sozinhas ficam fora da lista; esta linha diz quantos estão ocultos.
export function TemporariesNote({ items }: { items: Temporary[] }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <div className="text-xs text-faint">
      <p>
        Containers temporários de testes (testcontainers, --rm) ficam escondidos: {items.length} agora.{' '}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-muted underline-offset-2 hover:text-fg hover:underline">
          {open ? 'esconder' : 'ver quais'}
        </button>
      </p>
      {open && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          {items.map((t) => (
            <li key={t.name} className="flex gap-3">
              <span className="min-w-0 flex-1 truncate text-muted">{t.name}</span>
              <span className="hidden truncate sm:inline">{t.image}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Só aparecem aplicativos acima deste consumo.
const MIN_APP = 1024 ** 3

export function ComputerMemory({ host, dev, apps }: { host: HostMem; dev: number; apps: HostApp[] }) {
  const big = apps.filter((a) => a.name !== 'Outros' && a.memUsed >= MIN_APP)
  const others = Math.max(host.used - dev, 0)
  const w = (n: number) => `${host.total ? Math.min((n / host.total) * 100, 100) : 0}%`
  const [value, unit] = bytesParts(host.used)
  return (
    <section aria-labelledby="pc-title" className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-line bg-surface px-[18px] py-4">
      <h2 id="pc-title" className="text-sm font-semibold">
        Memória do computador
      </h2>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="tabular font-mono text-[26px] font-medium leading-none">{value}</span>
          <span className="text-muted">
            {unit === 'GB' ? '' : `${unit} `}de {bytes(host.total)} em uso
          </span>
        </div>
        <div className="mt-2.5 flex h-2 gap-[2px] overflow-hidden rounded-full bg-line" role="img" aria-label={`Desenvolvimento ${bytes(dev)}, outros apps ${bytes(others)}, livre ${bytes(host.available)}`}>
          <span className="h-full transition-[width] duration-700" style={{ width: w(dev), background: 'var(--series-1)' }} />
          <span className="h-full bg-muted transition-[width] duration-700" style={{ width: w(others) }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: 'var(--series-1)' }} />
            desenvolvimento {bytes(dev)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-muted" />
            outros apps {bytes(others)}
          </span>
          <span>livre {bytes(host.available)}</span>
        </div>
      </div>
      {big.length > 0 && (
        <ul title="Aplicativos acima de 1 GB. Cada um soma a memória de todos os seus processos.">
          {big.map((a) => (
            <li key={a.name} className="flex items-center gap-2.5 border-t border-divider py-[9px] text-[13px]">
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="tabular font-mono text-xs">{bytes(a.memUsed)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const PORTS_VISIBLE = 12

export function PortsCard({ ports }: { ports: PortEntry[] }) {
  const [all, setAll] = useState(false)
  const rank = (p: PortEntry) => (p.conflict ? 0 : p.running ? 1 : 2)
  const sorted = [...ports].sort((a, b) => rank(a) - rank(b) || a.hostPort - b.hostPort)
  const shown = all ? sorted : sorted.slice(0, PORTS_VISIBLE)
  const conflicts = new Set(ports.filter((p) => p.conflict).map((p) => p.hostPort)).size
  return (
    <section aria-labelledby="ports-title" className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <header className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        <h2 id="ports-title" className="text-sm font-semibold">
          Portas
        </h2>
        <span className="text-xs text-faint">
          {ports.length} em uso{conflicts > 0 && <span className="text-warn-ink"> · {conflicts} em conflito</span>}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-faint">
              <th className="px-[18px] py-2.5 font-medium">Porta</th>
              <th className="px-[18px] py-2.5 font-medium">Quem usa</th>
              <th className="px-[18px] py-2.5 font-medium">Projeto</th>
              <th className="px-[18px] py-2.5 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={`${p.hostPort}-${p.proto}-${p.containerName ?? 'host'}-${i}`} className="border-t border-divider">
                <td className="px-[18px] py-[9px] font-mono">{p.hostPort}</td>
                <td className="px-[18px] py-[9px]">{p.kind === 'host' ? <span className="text-muted">processo do computador</span> : p.label || p.containerName}</td>
                <td className="px-[18px] py-[9px] text-muted">{p.projectName ?? '—'}</td>
                <td className={cx('px-[18px] py-[9px]', p.conflict ? 'text-warn-ink' : p.running ? 'text-on-ink' : 'text-faint')}>
                  {p.conflict ? 'conflito' : p.running ? 'ligada' : 'reservada'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > PORTS_VISIBLE && (
        <button type="button" onClick={() => setAll((a) => !a)} className="w-full border-t border-divider px-[18px] py-2.5 text-left text-xs text-muted hover:text-fg">
          {all ? 'Mostrar menos' : `Mostrar todas as ${sorted.length}`}
        </button>
      )}
    </section>
  )
}
