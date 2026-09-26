import { useEffect, useState } from 'react'
import type { Snapshot } from './types'

export type Sample = { t: number; dev: number }
export type Connection = 'connecting' | 'live' | 'reconnecting'

const HISTORY = 90 // 3 minutos a cada 2 s

export function useSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<Sample[]>([])
  const [connection, setConnection] = useState<Connection>('connecting')

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.addEventListener('snapshot', (e) => {
      const s: Snapshot = JSON.parse((e as MessageEvent).data)
      setSnap(s)
      setConnection('live')
      const dev = s.projects.reduce((n, p) => n + p.memUsed, 0) + (s.claude?.memUsed ?? 0)
      setHistory((h) => {
        const t = Date.parse(s.at)
        if (h.length && h[h.length - 1].t === t) return h
        return [...h, { t, dev }].slice(-HISTORY)
      })
    })
    es.onerror = () => setConnection('reconnecting')
    return () => es.close()
  }, [])

  return { snap, history, connection }
}
