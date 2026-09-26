import { useEffect, useRef, useState, type FormEvent } from 'react'
import { analyzeProject, fetchFolders, type Analysis, type Check, type CheckStatus, type FolderList } from '../api'
import { copyText, cx, Icon, Spinner, useToast } from './ui'

const GROUPS = ['Pasta', 'Infraestrutura', 'Apps', 'Portas', 'Segurança', 'Preparação']

const statusView: Record<CheckStatus, { icon: 'checkCircle' | 'xCircle' | 'alertCircle' | 'infoCircle'; color: string; ink: string; label: string }> = {
  ok: { icon: 'checkCircle', color: 'text-on', ink: 'text-on-ink', label: 'ok' },
  fail: { icon: 'xCircle', color: 'text-danger', ink: 'text-danger', label: 'pendente' },
  warn: { icon: 'alertCircle', color: 'text-warn', ink: 'text-warn-ink', label: 'atenção' },
  info: { icon: 'infoCircle', color: 'text-faint', ink: 'text-faint', label: 'informação' },
}

export function CreateServerModal({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState('~/projetos/')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Analysis | null>(null)
  const [folders, setFolders] = useState<FolderList | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    fetchFolders()
      .then((l) => {
        setFolders(l)
        // A pasta padrão vem do servidor; ajusta o campo se ele ainda está no valor inicial.
        setPath((p) => (p === '~/projetos/' ? l.root.replace(/\/?$/, '/') : p))
      })
      .catch(() => setFolders(null))
  }, [])

  // Foco e Esc só na abertura: o painel redesenha a cada 2 s e não pode mexer no cursor.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const el = input.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = async (e?: FormEvent, target = path) => {
    e?.preventDefault()
    setPath(target)
    setBusy(true)
    setError(null)
    try {
      const r = await analyzeProject(target)
      setResult(r)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast(`${what} copiado. Cole no Claude Code do projeto.`)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <h2 id="create-title" className="text-base font-semibold tracking-tight">
              Criar server
            </h2>
            <p className="mt-0.5 text-xs text-faint">Validações antes de criar o ambiente. A análise só lê os arquivos do projeto: nada é criado nem alterado.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-8 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg">
            <Icon name="close" className="size-4" />
          </button>
        </header>

        <form onSubmit={run} className="flex gap-2 border-b border-line px-5 py-4">
          <label className="sr-only" htmlFor="create-path">
            Pasta do projeto
          </label>
          <input
            id="create-path"
            ref={input}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/projetos/meu-projeto"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-faint"
          />
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-60">
            {busy && <Spinner className="size-3.5" />}
            {result ? 'Analisar de novo' : 'Analisar'}
          </button>
        </form>

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p className="m-5 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.05] px-4 py-3 text-sm text-danger">
              <Icon name="alert" className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {!result && <Folders list={folders} filter={path} busy={busy} onPick={(p) => run(undefined, p)} />}
          {result && (
            <>
              <button
                type="button"
                onClick={() => {
                  setResult(null)
                  setError(null)
                  setPath(folders ? folders.root.replace(/\/?$/, '/') : '~/projetos/')
                  input.current?.focus()
                }}
                className="mx-5 mt-3 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-faint hover:bg-raised hover:text-fg"
              >
                <Icon name="chevronRight" className="size-3.5 rotate-180" />
                Projetos
              </button>
              <Report result={result} onCopy={copy} />
            </>
          )}
        </div>

        {result && (
          <footer className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
            <p className={cx('flex-1 text-xs', result.ready ? 'text-on-ink' : 'text-danger')}>
              {result.ready
                ? 'Nenhuma pendência obrigatória. A criação automática é a próxima etapa.'
                : `${result.summary.fail} ${result.summary.fail === 1 ? 'pendência obrigatória impede' : 'pendências obrigatórias impedem'} a criação.`}
            </p>
            {result.allPrompts && (
              <button type="button" onClick={() => copy(result.allPrompts!, 'Prompt com todas as pendências')} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-fg">
                <Icon name="copy" className="size-3.5" />
                Copiar todos os prompts
              </button>
            )}
            <button type="button" disabled title="Próxima etapa: a criação automática ainda não está disponível" className="rounded-lg bg-on px-4 py-2 text-sm font-medium text-bg opacity-40">
              Criar server
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

function Folders({ list, filter, busy, onPick }: { list: FolderList | null; filter: string; busy: boolean; onPick: (path: string) => void }) {
  if (!list) {
    return (
      <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-faint">
        <Spinner className="size-3.5" /> Carregando projetos…
      </p>
    )
  }
  if (!list.exists) {
    return (
      <p className="px-5 py-10 text-center text-sm text-faint">
        A pasta <span className="font-mono text-muted">{list.root}</span> não existe. Os projetos do painel ficam nela.
      </p>
    )
  }
  const prefix = list.root.endsWith('/') ? list.root : list.root + '/'
  const q = (filter.startsWith(prefix) ? filter.slice(prefix.length) : filter).trim().toLowerCase().replace(/\/$/, '')
  const shown = q ? list.folders.filter((f) => f.name.toLowerCase().includes(q)) : list.folders
  return (
    <div className="px-5 py-4">
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
        Projetos em <span className="normal-case tracking-normal font-mono">{list.root}</span> · {shown.length}
      </h3>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          {list.folders.length === 0 ? 'A pasta está vazia.' : 'Nenhuma pasta com esse nome.'}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line">
          {shown.map((f) => (
            <li key={f.name} className="[&+&]:border-t [&+&]:border-line">
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(f.path)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="block truncate font-mono text-[11px] text-faint">{f.path}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {f.registered && <Tag tone="on">no painel</Tag>}
                  {f.compose && <Tag>compose</Tag>}
                  {f.node && <Tag>node</Tag>}
                  {!f.compose && !f.node && <Tag>sem compose</Tag>}
                </span>
                <Icon name="chevronRight" className="size-4 shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Tag({ children, tone }: { children: string; tone?: 'on' }) {
  return (
    <span className={cx('rounded-md border px-1.5 py-px text-[11px]', tone === 'on' ? 'border-on/40 text-on-ink' : 'border-line text-faint')}>
      {children}
    </span>
  )
}

function Report({ result, onCopy }: { result: Analysis; onCopy: (text: string, what: string) => void }) {
  const s = result.summary
  return (
    <div className="px-5 pb-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{result.name}</div>
          <div className="truncate font-mono text-xs text-faint">{result.displayDir}</div>
        </div>
        <Count status="ok" n={s.ok} />
        <Count status="fail" n={s.fail} />
        <Count status="warn" n={s.warn} />
        <Count status="info" n={s.info} />
      </div>

      <div className="space-y-4">
        {GROUPS.map((g) => {
          const checks = result.checks.filter((c) => c.group === g)
          if (!checks.length) return null
          return (
            <section key={g}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{g}</h3>
              <ul className="overflow-hidden rounded-xl border border-line">
                {checks.map((c, i) => (
                  <Row key={`${c.title}-${i}`} check={c} onCopy={onCopy} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {result.ready && (
        <section className="mt-5">
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="flex-1 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Configuração proposta</h3>
            <button type="button" onClick={() => onCopy(result.proposal, 'Bloco do services.yml')} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg">
              <Icon name="copy" className="size-3.5" />
              Copiar
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-line bg-bg px-4 py-3 font-mono text-xs leading-relaxed text-muted">{result.proposal}</pre>
        </section>
      )}
    </div>
  )
}

function Count({ status, n }: { status: CheckStatus; n: number }) {
  const v = statusView[status]
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs', n ? v.ink : 'text-faint')} title={v.label}>
      <Icon name={v.icon} className={cx('size-4', n ? v.color : 'text-faint')} />
      <span className="tabular font-mono">{n}</span>
      <span className="text-faint">{v.label}</span>
    </span>
  )
}

function Row({ check: c, onCopy }: { check: Check; onCopy: (text: string, what: string) => void }) {
  const [open, setOpen] = useState(false)
  const v = statusView[c.status]
  const actionable = !!c.prompt && (c.status === 'fail' || c.status === 'warn')
  return (
    <li className={cx('px-4 py-3 [&+&]:border-t [&+&]:border-line', c.status === 'fail' && 'bg-danger/[0.04]')}>
      <div className="flex items-start gap-3">
        <Icon name={v.icon} className={cx('mt-0.5 size-[18px] shrink-0', v.color)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{c.title}</span>
            <span className={cx('text-[11px]', v.ink)}>{v.label}</span>
          </div>
          {c.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted">{c.detail}</p>}
          {c.items && c.items.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-faint">
              {c.items.map((it) => (
                <li key={it} className="break-words">
                  · {it}
                </li>
              ))}
            </ul>
          )}
        </div>
        {c.prompt && (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-md px-2 py-1 text-xs text-faint hover:bg-raised hover:text-fg">
              {open ? 'Ocultar' : 'Ver prompt'}
            </button>
            {actionable && (
              <button type="button" onClick={() => onCopy(c.prompt!, 'Prompt')} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-fg hover:border-faint/60">
                <Icon name="copy" className="size-3.5" />
                Copiar prompt
              </button>
            )}
          </div>
        )}
      </div>
      {open && c.prompt && (
        <div className="mt-2 flex gap-2 pl-[30px]">
          <pre className="max-h-60 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{c.prompt}</pre>
          {!actionable && (
            <button type="button" onClick={() => onCopy(c.prompt!, 'Prompt')} className="self-start rounded-md p-1.5 text-faint hover:bg-raised hover:text-fg" aria-label="Copiar prompt">
              <Icon name="copy" className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </li>
  )
}
