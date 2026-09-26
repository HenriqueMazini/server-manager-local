import { useState } from 'react'
import type { Conflict } from '../types'
import { shortPath } from '../format'
import { copyText, cx, Icon, useToast } from './ui'

export function Conflicts({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts.length) return null
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-warn-ink">
        <Icon name="alert" className="size-3.5" />
        {conflicts.length === 1 ? '1 conflito de porta' : `${conflicts.length} conflitos de porta`}
      </h2>
      {conflicts.map((c) => (
        <ConflictCard key={c.id} c={c} />
      ))}
    </section>
  )
}

function ConflictCard({ c }: { c: Conflict }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()
  const m = c.mover
  const where = m.app ? shortPath(m.appDir) : m.workingDir ? shortPath(m.workingDir) : null
  const occupant = c.keeper ? (
    <>
      <b className="font-medium text-fg">{c.keeper.label}</b>
      <span className="text-faint"> ({c.keeper.projectName}{c.keeper.running ? ', ligado' : ''})</span>
    </>
  ) : (
    <b className="font-medium text-fg">um processo do computador fora do Docker</b>
  )

  const copy = async () => {
    if (await copyText(c.prompt)) {
      setCopied(true)
      toast(where ? `Prompt copiado. Cole no Claude Code em ${where}` : 'Prompt copiado')
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-warn/30 bg-warn/[0.04]">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 font-mono text-lg">
          <span className="rounded-lg bg-warn/10 px-2.5 py-1 text-warn-ink line-through decoration-warn/50">{c.hostPort}</span>
          <Icon name="arrow" className="text-faint" />
          <span className="rounded-lg bg-on/10 px-2.5 py-1 text-on-ink">{c.proposedPort}</span>
        </div>
        <div className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
          <p>
            <b className="font-medium text-fg">{m.label}</b>
            <span className="text-faint"> ({m.projectName}{m.running ? ', ligado' : ', desligado'})</span> usa a porta{' '}
            {c.hostPort}, já ocupada por {occupant}.
          </p>
          <p className="mt-0.5 text-xs text-faint">
            {where ? (
              <>
                Cole o prompt no Claude Code em <span className="font-mono text-muted">{where}</span>
              </>
            ) : (
              'Container criado fora do compose: cole o prompt no Claude Code de qualquer pasta.'
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-fg"
            aria-expanded={open}
          >
            Ver prompt
            <Icon name="chevron" className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-fg px-3 py-2 text-sm font-medium text-bg hover:opacity-90"
          >
            <Icon name={copied ? 'check' : 'copy'} className="size-3.5" />
            {copied ? 'Copiado' : 'Copiar prompt'}
          </button>
        </div>
      </div>
      {open && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-warn/20 bg-surface/70 px-5 py-4 font-mono text-xs leading-relaxed text-muted">
          {c.prompt}
        </pre>
      )}
    </article>
  )
}
