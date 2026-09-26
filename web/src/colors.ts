import type { Project } from './types'

// Chave das sessões do Claude na lista e no gráfico. Não colide com chaves de projeto.
export const CLAUDE_KEY = '__claude'

// Cor fixa por item, na ordem da lista: a primeira cor é sempre das sessões do Claude,
// e ligar ou desligar um projeto não repinta os outros.
export function projectColors(projects: Project[]): Record<string, string> {
  const out: Record<string, string> = { [CLAUDE_KEY]: 'var(--series-1)' }
  projects.forEach((p, i) => {
    out[p.key] = i + 2 <= 8 ? `var(--series-${i + 2})` : 'var(--faint)'
  })
  return out
}
