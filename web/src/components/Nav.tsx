import type { ReactNode } from 'react'
import { PAGES, type Page } from '../pages'
import type { Connection } from '../useSnapshot'
import { cx, Dot, Icon } from './ui'

export type Badge = { text: string; tone: 'warn' | 'info' | 'plain' } | null

const pageIcon: Record<Page, string> = {
  geral: 'M5.5 4h4A1.5 1.5 0 0 1 11 5.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5v-4A1.5 1.5 0 0 1 5.5 4ZM14.5 4h4A1.5 1.5 0 0 1 20 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13 9.5v-4A1.5 1.5 0 0 1 14.5 4ZM5.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-4A1.5 1.5 0 0 1 5.5 13ZM14.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5Z',
  projetos: 'M5.8 5h12.4A1.8 1.8 0 0 1 20 6.8v1.4A1.8 1.8 0 0 1 18.2 10H5.8A1.8 1.8 0 0 1 4 8.2V6.8A1.8 1.8 0 0 1 5.8 5ZM5.8 14h12.4a1.8 1.8 0 0 1 1.8 1.8v1.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2v-1.4A1.8 1.8 0 0 1 5.8 14Z',
  sessoes: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  sistema: 'M4 18h16M6 18V9M10 18V5M14 18v-6M18 18v-9',
}

export function PageIcon({ page, className }: { page: Page; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('size-4', className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d={pageIcon[page]} />
    </svg>
  )
}

function BadgeView({ badge, active }: { badge: Badge; active: boolean }) {
  if (!badge) return null
  if (badge.tone === 'plain') return <span className={cx('tabular font-mono text-[11px]', active ? 'text-muted' : 'text-faint')}>{badge.text}</span>
  return (
    <span
      className={cx(
        'tabular min-w-5 rounded-full px-1.5 py-px text-center text-[11px] font-semibold',
        badge.tone === 'warn' ? 'bg-warn/15 text-warn-ink' : 'bg-info/15 text-info-ink',
      )}
    >
      {badge.text}
    </span>
  )
}

export function Logo() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-edge bg-chip">
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" aria-hidden>
        <rect x="4" y="5" width="16" height="5" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
        <rect x="4" y="14" width="16" height="5" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="16.5" cy="7.5" r="1.1" className="fill-on" />
      </svg>
    </span>
  )
}

// Barra lateral das telas grandes: telas, criar server e, no pé, conexão, versão, tema e ajustes.
export function Sidebar({
  page,
  go,
  badges,
  onCreate,
  connection,
  version,
  themeIcon,
  onTheme,
  onSettings,
}: {
  page: Page
  go: (p: Page) => void
  badges: Record<Page, Badge>
  onCreate: () => void
  connection: Connection
  version: ReactNode
  themeIcon: 'sun' | 'moon'
  onTheme: () => void
  onSettings: () => void
}) {
  const live = connection === 'live'
  const footButton = 'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-edge text-muted transition-colors hover:text-fg'
  return (
    <nav aria-label="Telas" className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-[22px] border-r border-line bg-panel px-3.5 py-5 lg:flex">
      <div className="flex items-center gap-2.5 px-1.5">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Server Manager</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {PAGES.map((p) => {
          const active = p.key === page
          return (
            <li key={p.key}>
              <a
                href={`#${p.key}`}
                onClick={(e) => {
                  e.preventDefault()
                  go(p.key)
                }}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-sm transition-colors',
                  active ? 'bg-raised font-medium text-fg' : 'text-muted hover:bg-raised/50 hover:text-fg',
                )}
              >
                <PageIcon page={p.key} />
                <span className="flex-1">{p.title}</span>
                <BadgeView badge={badges[p.key]} active={active} />
              </a>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center justify-center gap-2 rounded-[10px] bg-fg px-3 py-2.5 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on"
      >
        <Icon name="plus" className="size-[15px]" />
        Criar server
      </button>
      <div className="mt-auto flex flex-col gap-2.5 px-1.5 text-xs text-faint">
        <span className={cx('flex items-center gap-2', !live && 'text-warn-ink')}>
          <Dot tone={live ? 'on' : 'warn'} pulse={live} />
          {live ? 'ao vivo' : connection === 'connecting' ? 'conectando' : 'reconectando'} · v{__APP_VERSION__}
        </span>
        <div className="flex gap-1.5">
          <button type="button" onClick={onTheme} aria-label="Trocar o tema" className={footButton}>
            <Icon name={themeIcon} className="size-3.5" />
            Tema
          </button>
          <button type="button" onClick={onSettings} aria-label="Configurações" className={footButton}>
            <Icon name="gear" className="size-3.5" />
            Ajustes
          </button>
        </div>
        {version}
      </div>
    </nav>
  )
}

// Navegação de baixo nas telas pequenas.
export function MobileNav({ page, go }: { page: Page; go: (p: Page) => void }) {
  return (
    <nav
      aria-label="Telas"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-panel px-2 pb-[max(1.125rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden"
    >
      {PAGES.map((p) => {
        const active = p.key === page
        return (
          <a
            key={p.key}
            href={`#${p.key}`}
            onClick={(e) => {
              e.preventDefault()
              go(p.key)
            }}
            aria-current={active ? 'page' : undefined}
            className={cx('flex flex-col items-center gap-1 py-2 text-[11px]', active ? 'font-medium text-fg' : 'text-faint')}
          >
            <PageIcon page={p.key} className="size-5" />
            {p.short}
          </a>
        )
      })}
    </nav>
  )
}
