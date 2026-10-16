import type React from 'react'
import type { Project } from './types'

// Chave das sessões do Claude na lista e no gráfico. Não colide com chaves de projeto.
export const CLAUDE_KEY = '__claude'

// Cor fixa por item. A primeira cor é sempre das sessões do Claude; os projetos recebem as
// seguintes pela ordem alfabética da chave, que não muda. A lista é ordenada por status, então
// usar a posição dela faria ligar um projeto repintar os outros.
export function projectColors(projects: Project[]): Record<string, string> {
  const out: Record<string, string> = { [CLAUDE_KEY]: 'var(--series-1)' }
  const keys = projects.map((p) => p.key).sort((a, b) => a.localeCompare(b))
  keys.forEach((k, i) => {
    out[k] = i + 2 <= 8 ? `var(--series-${i + 2})` : 'var(--faint)'
  })
  return out
}

// Linha com a cor do projeto: borda leve e um brilho sutil por dentro da borda, mais forte quando selecionada.
// O fundo fica neutro. A cor entra pela variável --tint, então as mesmas classes servem para qualquer projeto.
export const TINT_CLASSES =
  'bg-surface border-[color-mix(in_oklab,var(--tint)_35%,transparent)] shadow-[inset_0_0_16px_-4px_color-mix(in_oklab,var(--tint)_50%,transparent)] hover:border-[color-mix(in_oklab,var(--tint)_55%,transparent)] hover:shadow-[inset_0_0_20px_-4px_color-mix(in_oklab,var(--tint)_65%,transparent)] transition-shadow'
export const TINT_SELECTED_CLASSES =
  'bg-raised border-[color-mix(in_oklab,var(--tint)_70%,transparent)] shadow-[inset_0_0_24px_-4px_color-mix(in_oklab,var(--tint)_70%,transparent)]'

export function tintStyle(color: string): React.CSSProperties {
  return { ['--tint' as string]: color }
}
