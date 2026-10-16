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
