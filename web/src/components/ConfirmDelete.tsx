import { useEffect, useRef, useState } from 'react'
import { shortPath } from '../format'
import { Icon, Spinner, useToast } from './ui'

export type DeleteTarget = {
  name: string
  cwd?: string
  open: boolean // sessão aberta: será encerrada antes de apagar
  working: boolean // está trabalhando agora
  run: () => Promise<{ name: string; stopped: boolean }>
}

// Confirmação antes de apagar uma sessão do Claude, aberta ou fechada. O foco começa em "Cancelar".
export function ConfirmDeleteSession({ target: s, onClose }: { target: DeleteTarget; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const toast = useToast()
  const running = s.working

  useEffect(() => {
    cancel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const confirm = async () => {
    setBusy(true)
    try {
      const r = await s.run()
      toast(r.stopped ? `Sessão "${r.name}" encerrada e apagada.` : `Sessão "${r.name}" apagada.`)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-desc" className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
            <Icon name="trash" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="del-title" className="text-base font-semibold tracking-tight">
              Apagar a sessão "{s.name}"?
            </h2>
            {s.cwd && <p className="mt-0.5 truncate font-mono text-xs text-faint">{shortPath(s.cwd)}</p>}
            <p id="del-desc" className="mt-3 text-sm leading-relaxed text-muted">
              {s.open ? 'A sessão será encerrada e a conversa' : 'A conversa'}, o histórico de arquivos e o ambiente dela serão apagados. Ela some do{' '}
              <span className="font-mono text-xs">claude --resume</span>. <b className="font-medium text-fg">Não dá para desfazer.</b>
            </p>
            {running && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warn-ink">
                <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                Esta sessão está trabalhando agora; o que ela estiver fazendo será interrompido.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-raised/40 px-5 py-3">
          <button ref={cancel} type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-fg hover:border-faint/60">
            Cancelar
          </button>
          <button type="button" onClick={confirm} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
            {busy && <Spinner className="size-3.5" />}
            Apagar sessão
          </button>
        </div>
      </div>
    </div>
  )
}
