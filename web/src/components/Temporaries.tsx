import { useState } from 'react'
import type { Temporary } from '../types'
import { cx, Icon } from './ui'

const originText: Record<Temporary['origin'], string> = {
  testcontainers: 'teste (Testcontainers)',
  '--rm': 'descartável (docker run --rm)',
}

// Containers que ferramentas criam e apagam sozinhas. Ficam fora da lista de projetos; esta linha só
// avisa quantos estão ocultos, para nada sumir sem explicação.
export function Temporaries({ items }: { items: Temporary[] }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const n = items.length
  return (
    <div className="rounded-xl border border-dashed border-line px-3.5 py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-xs text-faint hover:text-muted">
        <Icon name="infoCircle" className="size-3.5 shrink-0" />
        <span className="flex-1">
          {n} {n === 1 ? 'container temporário oculto' : 'containers temporários ocultos'} · criados por testes e comandos descartáveis
        </span>
        <Icon name="chevron" className={cx('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-2 space-y-0.5 border-t border-line/70 pt-2 font-mono text-[11px] text-faint">
          {items.map((t) => (
            <li key={t.name} className="flex gap-3">
              <span className="min-w-0 flex-1 truncate text-muted">{t.name}</span>
              <span className="hidden truncate sm:inline">{t.image}</span>
              <span className="shrink-0">{originText[t.origin]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
