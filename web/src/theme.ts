import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'sm-theme'
const DAY_START = 6 // claro a partir das 6h
const NIGHT_START = 18 // escuro a partir das 18h

// Início da faixa de horário atual (dia 6h–18h ou noite 18h–6h). Muda duas vezes por dia.
export function periodStart(now = new Date()): number {
  const d = new Date(now)
  const h = d.getHours()
  d.setMinutes(0, 0, 0)
  if (h >= DAY_START && h < NIGHT_START) d.setHours(DAY_START)
  else if (h >= NIGHT_START) d.setHours(NIGHT_START)
  else {
    d.setDate(d.getDate() - 1)
    d.setHours(NIGHT_START)
  }
  return d.getTime()
}

export function scheduled(now = new Date()): Theme {
  const h = now.getHours()
  return h >= DAY_START && h < NIGHT_START ? 'light' : 'dark'
}

// A escolha manual vale só na faixa de horário em que foi feita.
function manual(): Theme | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && (raw.theme === 'light' || raw.theme === 'dark') && raw.period === periodStart()) return raw.theme
  } catch {
    /* valor antigo ou storage indisponível */
  }
  return null
}

function current(): Theme {
  return manual() ?? scheduled()
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Confere a cada 30 s e ao voltar para a aba: cobre a virada das 6h/18h e o computador acordando.
  useEffect(() => {
    const check = () => setTheme(current())
    const t = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      if (next === scheduled()) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify({ theme: next, period: periodStart() }))
    } catch {
      /* sem storage: vale só nesta aba */
    }
  }

  return { theme, toggle }
}
