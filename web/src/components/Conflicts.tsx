import { useState } from 'react'
import type { Conflict } from '../types'
import { shortPath } from '../format'
import { copyText, cx, Icon, useToast } from './ui'

export function Conflicts({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts.length) return null
  return (
    <section className="space-y-2">
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
    <article className="overflow-hidden rounded-xl border border-warn/30 bg-warn/[0.04]">
      {/* Linha 1: porta atual, porta sugerida e ações. Linha 2: explicação em largura total.
          O cartão fica na coluna estreita dos projetos, então nada divide a mesma linha com o texto. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 pt-3">
        <div className="flex items-center gap-2 font-mono text-sm" aria-label={`Porta ${c.hostPort} para ${c.proposedPort}`}>
          <span className="rounded-md bg-warn/10 px-2 py-0.5 text-warn-ink line-through decoration-warn/50">{c.hostPort}</span>
          <Icon name="arrow" className="size-3.5 text-faint" />
          <span className="rounded-md bg-on/10 px-2 py-0.5 text-on-ink">{c.proposedPort}</span>
        </div>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:text-fg"
            aria-expanded={open}
          >
            Ver prompt
            <Icon name="chevron" className={cx('size-3 transition-transform', open && 'rotate-180')} />
          </button>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md bg-fg px-2.5 py-1 text-xs font-medium text-bg hover:opacity-90"
          >
            <Icon name={copied ? 'check' : 'copy'} className="size-3" />
            {copied ? 'Copiado' : 'Copiar prompt'}
          </button>
        </div>
      </div>
      <div className="px-3.5 pb-3 pt-2 text-xs leading-relaxed text-muted">
        <p>
          <b className="font-medium text-fg">{m.label}</b>
          <span className="text-faint"> ({m.projectName}{m.running ? ', ligado' : ', desligado'})</span> usa a porta{' '}
          {c.hostPort}, já ocupada por {occupant}.
        </p>
        <p className="mt-0.5 text-[11px] text-faint">
          {where ? (
            <>
              Cole o prompt no Claude Code em <span className="break-all font-mono text-muted">{where}</span>
            </>
          ) : (
            'Container criado fora do compose: cole o prompt no Claude Code de qualquer pasta.'
          )}
        </p>
      </div>
      {open && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-warn/20 bg-surface/70 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-muted">
          {c.prompt}
        </pre>
      )}
    </article>
  )
}
