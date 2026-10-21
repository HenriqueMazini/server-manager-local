import { useCallback, useEffect, useState } from 'react'

export type Page = 'geral' | 'projetos' | 'sessoes' | 'sistema'

export const PAGES: { key: Page; title: string; short: string; subtitle: string }[] = [
  { key: 'geral', title: 'Visão geral', short: 'Geral', subtitle: 'O que está ligado, quanto ocupa e o que precisa de você.' },
  { key: 'projetos', title: 'Projetos', short: 'Projetos', subtitle: 'Liga, desliga e reinicia o conjunto inteiro de cada projeto.' },
  { key: 'sessoes', title: 'Sessões do Claude', short: 'Sessões', subtitle: 'As que pedem você ficam no topo.' },
  { key: 'sistema', title: 'Sistema e limpeza', short: 'Sistema', subtitle: 'Memória do computador, portas e sobras que dá para apagar.' },
]

function fromHash(): Page {
  const h = location.hash.slice(1)
  return PAGES.some((p) => p.key === h) ? (h as Page) : 'geral'
}

// A tela fica no endereço (#projetos, #sessoes...): recarregar mantém a tela e voltar do navegador funciona.
export function usePage(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(fromHash)
  useEffect(() => {
    const on = () => setPage(fromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = useCallback((p: Page) => {
    if (location.hash.slice(1) !== p) location.hash = p
    window.scrollTo({ top: 0 })
  }, [])
  return [page, go]
}
