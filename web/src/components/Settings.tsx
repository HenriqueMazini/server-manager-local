import { useEffect, useRef, useState } from 'react'
import { desktopPermission, testChime, testDesktop, type DesktopPermission } from '../alerts'
import { cx, Icon, Switch } from './ui'

function Row({ title, detail, checked, onChange, disabled, children }: {
  title: string
  detail: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={cx('flex items-start gap-4 px-5 py-4 [&+&]:border-t [&+&]:border-line', disabled && 'opacity-50')}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-faint">{detail}</p>
        {children}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} size="sm" />
    </div>
  )
}

// Configurações do painel, guardadas neste navegador.
export function SettingsModal({
  alerts,
  setAlerts,
  sound,
  setSound,
  desktop,
  setDesktop,
  onClose,
}: {
  alerts: boolean
  setAlerts: (v: boolean) => void
  sound: boolean
  setSound: (v: boolean) => void
  desktop: boolean
  setDesktop: (v: boolean) => Promise<DesktopPermission>
  onClose: () => void
}) {
  const [perm, setPerm] = useState<DesktopPermission>(desktopPermission)
  const permNote: Partial<Record<DesktopPermission, string>> = {
    denied: 'O navegador está bloqueando as notificações deste site. Libere no cadeado ao lado do endereço e ligue de novo.',
    unsupported: 'Este navegador não mostra notificações do sistema.',
  }
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id="settings-title" className="flex-1 text-base font-semibold tracking-tight">
            Configurações
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-8 place-items-center rounded-lg text-faint hover:bg-raised hover:text-fg">
            <Icon name="close" className="size-4" />
          </button>
        </header>
        <Row
          title="Exibir alertas"
          detail="Sino no topo e contador no título da aba quando uma sessão do Claude sai de trabalhando e fica aguardando resposta."
          checked={alerts}
          onChange={setAlerts}
        />
        <Row
          title="Notificação no computador"
          detail="Aviso do sistema (o mesmo das outras notificações da sua área de trabalho) quando uma sessão termina e o painel não está em foco. A aba do painel precisa estar aberta, mesmo minimizada."
          checked={desktop}
          onChange={async (v) => setPerm(await setDesktop(v))}
          disabled={!alerts || perm === 'unsupported'}
        >
          {permNote[perm] && <p className="mt-1.5 text-xs text-warn-ink">{permNote[perm]}</p>}
          <button
            type="button"
            onClick={testDesktop}
            disabled={!alerts || !desktop}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg disabled:opacity-50"
          >
            <Icon name="bell" className="size-3.5" />
            Testar notificação
          </button>
        </Row>
        <Row
          title="Tocar som"
          detail="Um toque curto quando chega um alerta novo. O navegador só toca som depois que você clicou na página."
          checked={sound}
          onChange={setSound}
          disabled={!alerts}
        >
          <button
            type="button"
            onClick={testChime}
            disabled={!alerts}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg"
          >
            <Icon name="volume" className="size-3.5" />
            Testar som
          </button>
        </Row>
        <p className="border-t border-line px-5 py-3 text-[11px] text-faint">As escolhas ficam guardadas neste navegador.</p>
      </div>
    </div>
  )
}
