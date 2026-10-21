import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Switch({
  checked,
  busy,
  disabled,
  onChange,
  label,
  size = 'md',
}: {
  checked: boolean
  busy?: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  label: string
  size?: 'sm' | 'md'
}) {
  const dims = size === 'md' ? 'h-6 w-10' : 'h-5 w-9'
  const knob = size === 'md' ? 'size-5' : 'size-4'
  const shift = 'translate-x-4'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on',
        'disabled:cursor-default',
        dims,
        checked ? 'bg-switch' : 'bg-edge',
        busy && 'opacity-80',
      )}
    >
      <span
        className={cx(
          'grid place-items-center rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200',
          knob,
          checked ? shift : 'translate-x-0',
        )}
      >
        {busy && <Spinner className={cx('size-3', checked ? 'text-on' : 'text-faint')} />}
      </span>
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('animate-spin', className)} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export type Tone = 'on' | 'warn' | 'off' | 'danger' | 'info'

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const color = { on: 'text-on', warn: 'text-warn', danger: 'text-danger', off: 'text-faint', info: 'text-info' }[tone]
  return (
    <span className={cx('relative inline-block size-2 shrink-0 rounded-full', color, pulse && 'live-dot')}>
      <span
        className={cx(
          'absolute inset-0 rounded-full',
          tone === 'off' ? 'border-[1.5px] border-current' : 'bg-current',
        )}
      />
    </span>
  )
}

const paths = {
  copy: 'M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16M5.5 8h9A1.5 1.5 0 0 1 16 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5v-9A1.5 1.5 0 0 1 5.5 8Z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  external: 'M14 5h5v5M19 5l-8 8M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10',
  chevron: 'm8 10 4 4 4-4',
  alert: 'M12 9v4M12 16.5v.01M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  power: 'M12 4v8M7.05 6.6a7 7 0 1 0 9.9 0',
  terminal: 'm5 8 4 4-4 4M12 16h7',
  restart: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.2h3.2',
  chevronRight: 'm10 8 4 4-4 4',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  branch: 'M6 4v12M6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 8c0 5-6 4-12 8',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2.2 2.2 0 0 0 4 0',
  bellOff: 'M6 16V11a6 6 0 0 1 9.3-5M18 9.5V16l1.5 2H8M10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16',
  volume: 'M5 9.5h3l4-3.5v12l-4-3.5H5v-5ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1-1.5 2.6-1.8-.6a7 7 0 0 1-1.7 1l-.4 1.9h-3l-.4-1.9a7 7 0 0 1-1.7-1l-1.8.6L7 14.5l1.4-1.2a7 7 0 0 1 0-2L7 10l1.5-2.6 1.8.6a7 7 0 0 1 1.7-1l.4-1.9h3l.4 1.9a7 7 0 0 1 1.7 1l1.8-.6L21 10l-1.6 1a7 7 0 0 1 0 2.5Z',
  volumeOff: 'M5 9.5h3l4-3.5v12l-4-3.5H5v-5ZM16.5 9.5l5 5M21.5 9.5l-5 5',
  checkCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8.5 12.5l2.5 2.5 4.5-5',
  xCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.5 9.5l5 5M14.5 9.5l-5 5',
  alertCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 8v4.5M12 16v.01',
  infoCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v5M12 8v.01',
  sun: 'M12 3v1.5M12 19.5V21M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M3 12h1.5M19.5 12H21M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  search: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM20 20l-4.5-4.5',
}

export function Icon({ name, className }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx('size-4', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  )
}

type Toast = { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 2600)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex max-w-lg items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg backdrop-blur',
              'border-line bg-surface/95',
              t.tone === 'error' && 'text-danger',
            )}
          >
            <Icon name={t.tone === 'error' ? 'alert' : 'check'} className={t.tone === 'error' ? 'text-danger' : 'text-on'} />
            <span className="break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
