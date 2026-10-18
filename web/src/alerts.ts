import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaudeSession, Snapshot } from './types'
import { view } from './components/ClaudeCard'

// Alerta de sessão do Claude que entrou em "aguardando resposta".
export type ReplyAlert = { pid: number; name: string; cwd?: string; since: string; key: string }

const DISMISSED = 'sm-alertas-fechados'
const SOUND = 'sm-alertas-som'
const ENABLED = 'sm-alertas-exibir'
const DESKTOP = 'sm-alertas-computador'
const MUTED = 'sm-alertas-mudos'
const DAY = 24 * 60 * 60 * 1000

// Fechados ficam guardados pela parada específica (pid + horário): a mesma parada não volta ao
// recarregar, mas uma parada nova da mesma sessão gera alerta de novo.
function loadDismissed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED) ?? '{}') as Record<string, number>
    const now = Date.now()
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => now - t < DAY))
  } catch {
    return {}
  }
}

function saveDismissed(d: Record<string, number>) {
  try {
    localStorage.setItem(DISMISSED, JSON.stringify(d))
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

const alertKey = (s: ClaudeSession) => `${s.pid}:${s.updatedAt ?? ''}`

// ---- som: "plim" de duas notas gerado no navegador, sem arquivo de áudio

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    return ctx
  } catch {
    return null
  }
}

// O navegador só libera áudio depois de uma interação com a página.
if (typeof window !== 'undefined') {
  const unlock = () => void audio()?.resume().catch(() => {})
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

function saveMuted(m: Set<number>) {
  try {
    localStorage.setItem(MUTED, JSON.stringify([...m]))
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

function readFlag(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v !== '0'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

// Toca o som mesmo que o áudio ainda não tenha sido liberado (usado pelo botão "Testar som").
export function testChime() {
  void audio()?.resume().then(playChime).catch(() => {})
}

export function playChime() {
  const ac = audio()
  if (!ac || ac.state !== 'running') return
  const t0 = ac.currentTime
  for (const [freq, at] of [
    [880, 0],
    [1318.5, 0.14],
  ] as const) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t0 + at)
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6)
    osc.connect(gain).connect(ac.destination)
    osc.start(t0 + at)
    osc.stop(t0 + at + 0.65)
  }
}

/**
 * Um alerta por sessão (pelo pid). Some sozinho quando a sessão volta a trabalhar, fica
 * aguardando você ou é encerrada. Fechar guarda a parada como vista.
 */
// ---- notificação do sistema (GNOME, macOS...), pelo navegador

export type DesktopPermission = NotificationPermission | 'unsupported'

export function desktopPermission(): DesktopPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

function showDesktop(a: ReplyAlert, onOpen?: () => void) {
  if (desktopPermission() !== 'granted') return
  try {
    const n = new Notification(`${a.name} terminou`, {
      body: a.cwd ? `Aguardando sua resposta · ${a.cwd}` : 'Aguardando sua resposta',
      tag: `sm-${a.key}`, // a mesma parada não vira duas notificações, nem com duas abas abertas
      icon: '/icon.svg',
    })
    n.onclick = () => {
      window.focus()
      onOpen?.()
      n.close()
    }
  } catch {
    /* navegador sem suporte a notificação fora de service worker */
  }
}

// Mostra uma notificação de exemplo (botão "Testar" nas configurações).
export function testDesktop() {
  showDesktop({ pid: 0, name: 'Sessão de exemplo', cwd: '~/projetos/exemplo', since: new Date().toISOString(), key: `teste-${Date.now()}` })
}

export function useReplyAlerts(snap: Snapshot | null, onOpen?: () => void) {
  const [alerts, setAlerts] = useState<ReplyAlert[]>([])
  const [ring, setRing] = useState(0) // muda a cada alerta novo: dispara a animação do sino
  const [sound, setSoundState] = useState(() => readFlag(SOUND))
  const [enabled, setEnabledState] = useState(() => readFlag(ENABLED))
  const [desktop, setDesktopState] = useState(() => readFlag(DESKTOP, false) && desktopPermission() === 'granted')
  const desktopRef = useRef(desktop)
  desktopRef.current = desktop
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const dismissed = useRef(loadDismissed())
  // Sessões silenciadas, pelo pid: valem enquanto a sessão estiver aberta.
  const [muted, setMuted] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(MUTED) ?? '[]') as number[])
    } catch {
      return new Set()
    }
  })
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const first = useRef(true)
  const soundRef = useRef(sound)
  soundRef.current = sound

  // O cálculo é feito aqui, e não dentro de setAlerts(fn): o React roda essa função depois, e o
  // som precisa saber agora se surgiu alerta novo.
  const current = useRef<ReplyAlert[]>([])
  useEffect(() => {
    if (!snap) return
    const sessions = snap.claude?.sessions ?? []
    // Sessão encerrada esquece o silêncio: o próximo processo com o mesmo pid é outra sessão.
    if (snap.claude?.available && [...mutedRef.current].some((pid) => !sessions.some((s) => s.pid === pid))) {
      const kept = new Set([...mutedRef.current].filter((pid) => sessions.some((s) => s.pid === pid)))
      mutedRef.current = kept
      setMuted(kept)
      saveMuted(kept)
    }
    const byPid = new Map(sessions.filter((s) => !mutedRef.current.has(s.pid)).map((s) => [s.pid, s]))
    let fresh = false
    const born: ReplyAlert[] = [] // alertas que acabaram de surgir
    const next: ReplyAlert[] = []
    const seen = new Set<number>()
    // Mantém os que continuam valendo; a sessão voltou a trabalhar ou foi fechada: o alerta some.
    for (const a of current.current) {
      const s = byPid.get(a.pid)
      if (!s) continue
      const k = view(s).key
      if (k === 'busy' || k === 'waiting') continue
      seen.add(a.pid)
      const key = alertKey(s)
      // Mesma sessão com horário novo sem ter voltado a trabalhar: atualiza em silêncio, sem
      // duplicar nem tocar. Uma parada nova de verdade passa por "trabalhando", que remove o
      // alerta antes, e então ela entra como alerta novo lá embaixo.
      if (k === 'reply' && key !== a.key) {
        next.push({ ...a, key, name: s.name })
      } else {
        next.push(a)
      }
    }
    for (const s of sessions) {
      if (seen.has(s.pid) || mutedRef.current.has(s.pid) || view(s).key !== 'reply') continue
      const key = alertKey(s)
      if (dismissed.current[key]) continue
      const alert = { pid: s.pid, name: s.name, cwd: s.cwd, since: s.updatedAt ?? new Date().toISOString(), key }
      next.push(alert)
      born.push(alert)
      fresh = true
    }
    next.sort((a, b) => Date.parse(b.since) - Date.parse(a.since))
    current.current = next
    setAlerts(next)
    // Na primeira carga não toca som: são paradas que já existiam antes de abrir o painel.
    if (fresh && !first.current && enabledRef.current) {
      setRing((r) => r + 1)
      if (soundRef.current) playChime()
      // No computador só quando o painel não está na sua frente: com ele em foco, o sino já avisa.
      if (desktopRef.current && !document.hasFocus()) born.forEach((a) => showDesktop(a, onOpenRef.current))
    }
    first.current = false
  }, [snap])

  const dismiss = useCallback((pid: number) => {
    const a = current.current.find((x) => x.pid === pid)
    if (a) {
      dismissed.current[a.key] = Date.now()
      saveDismissed(dismissed.current)
    }
    current.current = current.current.filter((x) => x.pid !== pid)
    setAlerts(current.current)
  }, [])

  // Silencia ou reativa uma sessão. Silenciar tira o alerta dela na hora.
  const toggleMute = useCallback((pid: number) => {
    const next = new Set(mutedRef.current)
    if (next.has(pid)) {
      next.delete(pid)
    } else {
      next.add(pid)
      current.current = current.current.filter((x) => x.pid !== pid)
      setAlerts(current.current)
    }
    mutedRef.current = next
    setMuted(next)
    saveMuted(next)
  }, [])


  const dismissAll = useCallback(() => {
    for (const a of current.current) dismissed.current[a.key] = Date.now()
    saveDismissed(dismissed.current)
    current.current = []
    setAlerts([])
  }, [])

  const setSound = useCallback((on: boolean) => {
    setSoundState(on)
    writeFlag(SOUND, on)
  }, [])

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on)
    writeFlag(ENABLED, on)
  }, [])

  // Título da aba com o número de alertas: chama atenção com o painel em segundo plano.
  const shown = enabled ? alerts : []
  useEffect(() => {
    document.title = shown.length ? `(${shown.length}) Server Manager` : 'Server Manager'
  }, [shown.length])

  // Ligar pede a permissão do navegador; sem permissão, a opção volta a desligada.
  const setDesktop = useCallback(async (on: boolean): Promise<DesktopPermission> => {
    if (!on) {
      setDesktopState(false)
      writeFlag(DESKTOP, false)
      return desktopPermission()
    }
    let perm = desktopPermission()
    if (perm === 'default') perm = await Notification.requestPermission()
    const ok = perm === 'granted'
    setDesktopState(ok)
    writeFlag(DESKTOP, ok)
    return perm
  }, [])

  return {
    alerts: shown,
    ring,
    enabled,
    setEnabled,
    sound,
    setSound,
    dismiss,
    dismissAll,
    muted,
    toggleMute,
    desktop,
    setDesktop,
  }
}
