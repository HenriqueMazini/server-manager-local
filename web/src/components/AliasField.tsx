import { useEffect, useRef, useState } from 'react'
import { setAlias } from '../api'
import { cx, Icon, useToast } from './ui'

/**
 * Apelido editável depois do nome do projeto: "Loja (Vendas)".
 * Clique para editar; grava ao sair do campo ou com Enter; Esc desfaz.
 * Fica dentro da linha clicável do projeto, então não deixa o clique selecionar a linha.
 */
export function AliasField({ projectKey, alias, className }: { projectKey: string; alias?: string; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(alias ?? '')
  const [shown, setShown] = useState(alias ?? '')
  const input = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  const toast = useToast()

  // O snapshot é a fonte de verdade quando não há edição em curso.
  useEffect(() => {
    if (!editing) {
      setShown(alias ?? '')
      setValue(alias ?? '')
    }
  }, [alias, editing])

  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])

  const save = async () => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      setValue(shown)
      return
    }
    const next = value.trim()
    if (next === shown) return
    const before = shown
    setShown(next)
    try {
      setShown(await setAlias(projectKey, next))
    } catch (e) {
      setShown(before)
      setValue(before)
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  if (editing) {
    return (
      <span className={cx('inline-flex items-baseline text-faint', className)} onClick={stop}>
        (
        <input
          ref={input}
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
          placeholder="apelido"
          aria-label="Apelido do projeto"
          size={Math.max(value.length, 7)}
          className="min-w-0 border-b border-faint/60 bg-transparent px-0.5 font-normal text-fg outline-none placeholder:text-faint focus:border-fg"
        />
        )
      </span>
    )
  }

  if (shown) {
    return (
      <button
        type="button"
        onClick={(e) => {
          stop(e)
          setEditing(true)
        }}
        onKeyDown={stop}
        title="Editar apelido"
        aria-label={`Editar apelido: ${shown}`}
        className={cx('inline-flex items-baseline font-normal text-faint decoration-dotted underline-offset-4 hover:text-muted hover:underline', className)}
      >
        ({shown})
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e)
        setEditing(true)
      }}
      onKeyDown={stop}
      title="Dar um apelido ao projeto (ex.: o nome antigo, que o repositório ainda usa)"
      aria-label="Adicionar apelido"
      className={cx(
        'inline-flex items-center self-center rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60',
        className,
      )}
    >
      <Icon name="pencil" className="size-3" />
    </button>
  )
}
