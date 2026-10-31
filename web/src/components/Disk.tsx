import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchDisk, pruneDisk, removeVolumes, type PruneKind } from '../api'
import type { DiskFS, DiskVolume, DockerDisk, VolumeSource } from '../types'
import { bytes, shortPath } from '../format'
import { copyText, cx, Icon, Spinner, useToast, type Tone } from './ui'

// Avisos de disco: a partir de 85% pede atenção; acima de 95% o computador está perto de travar
// (builds, bancos e o próprio Docker param quando o disco enche).
export const DISK_WARN = 85
export const DISK_DANGER = 95

// Como o df: o uso sobre o espaço que o usuário pode usar (fora a reserva do root).
export function diskPct(d: DiskFS): number {
  return d.used + d.free ? (d.used / (d.used + d.free)) * 100 : 0
}

export function diskTone(d?: DiskFS): Tone {
  if (!d) return 'on'
  const p = diskPct(d)
  return p >= DISK_DANGER ? 'danger' : p >= DISK_WARN ? 'warn' : 'on'
}

const barColor: Record<Tone, string> = { on: 'bg-muted', warn: 'bg-warn', danger: 'bg-danger', off: 'bg-faint', info: 'bg-info' }
const textColor: Record<Tone, string> = { on: 'text-fg', warn: 'text-warn-ink', danger: 'text-danger', off: 'text-faint', info: 'text-info-ink' }

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (!(m >= 1)) return 'agora'
  if (m < 60) return `há ${m} min`
  return `há ${Math.floor(m / 60)} h`
}

function date(iso: string): string {
  const t = Date.parse(iso)
  if (!(t > Date.UTC(2000, 0, 1))) return '—'
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// Medidor do disco, com as marcas de 85% e 95%. Vai ao lado dos medidores de memória.
export function DiskMeter({ disk }: { disk: DiskFS }) {
  const p = diskPct(disk)
  const tone = diskTone(disk)
  const [v, u] = bytes(disk.used).split(' ')
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-[18px] py-4">
      <span className="text-[11px] uppercase tracking-[0.1em] text-faint">Disco</span>
      <span className="flex items-baseline gap-1.5">
        <span className={cx('tabular font-mono text-[26px] font-medium leading-none', textColor[tone])}>{v}</span>
        <span className="text-sm text-muted">{u}</span>
        <span className="ml-auto text-xs text-faint">
          {Math.round(p)}% de {bytes(disk.total)}
        </span>
      </span>
      <div className="relative mt-0.5 h-2 rounded-full bg-track" role="img" aria-label={`Disco em ${Math.round(p)}%`}>
        <div className={cx('h-full rounded-full transition-[width] duration-700', barColor[tone])} style={{ width: `${Math.min(p, 100)}%` }} />
        <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-warn/80" style={{ left: `${DISK_WARN}%` }} title={`Aviso em ${DISK_WARN}%`} />
        <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-danger/80" style={{ left: `${DISK_DANGER}%` }} title={`Alerta em ${DISK_DANGER}%`} />
      </div>
      <span className="text-[11px] text-faint">
        {bytes(disk.free)} livres. Aviso em {DISK_WARN}%, alerta em {DISK_DANGER}%.
      </span>
    </div>
  )
}

type Pending = { title: string; body: ReactNode; confirm: string; danger?: boolean; run: () => Promise<string> }

// Seção "Disco e Docker" em Sistema e limpeza: o que o Docker ocupa, o que dá para liberar e por que acumula.
export function DiskSection({ disk }: { disk?: DiskFS }) {
  const [data, setData] = useState<DockerDisk | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      setData(await fetchDisk(refresh))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const docker = data ? data.build.total + data.images.total + data.volumes.total + data.containers.total : 0
  const prune = (kind: PruneKind) => async () => {
    const r = await pruneDisk(kind)
    await load(true)
    return `${bytes(r.reclaimed)} liberados.`
  }

  const askBuild = (all: boolean) =>
    data &&
    setPending({
      title: all ? 'Apagar todo o cache de build sem uso?' : 'Limpar o cache de build?',
      confirm: all ? 'Apagar todo o cache' : 'Limpar',
      danger: all,
      body: all ? (
        <p>
          Apaga todo o cache que nenhum build em andamento usa, até <b className="text-fg">{bytes(data.build.reclaimable)}</b>. Os próximos builds de cada projeto
          baixam e instalam tudo de novo e demoram bem mais.
        </p>
      ) : (
        <p>
          O modo padrão (<code className="font-mono">docker builder prune</code>) apaga só o cache que não serve mais e mantém o que acelera os próximos builds. Libera
          parte dos {bytes(data.build.reclaimable)} sem uso; o painel mostra quanto depois.
        </p>
      ),
      run: prune(all ? 'build-all' : 'build'),
    })

  const askVolumes = () =>
    data &&
    setPending({
      title: `Apagar ${data.anonUnused.count} ${data.anonUnused.count === 1 ? 'volume anônimo' : 'volumes anônimos'} sem uso?`,
      confirm: `Apagar e liberar ${bytes(data.anonUnused.total)}`,
      body: (
        <>
          <p>
            Volumes sem nome que nenhum container usa: o container que os criou já foi apagado, e nenhum outro consegue reaproveitá-los. Costumam ser bancos de teste.
            Volumes com nome não entram.
          </p>
          <VolumeList items={data.anonSample} more={data.anonUnused.count - data.anonSample.length} />
        </>
      ),
      run: prune('volumes'),
    })

  const askImages = () => {
    if (!data) return
    const local = data.unusedImages.filter((i) => i.local)
    setPending({
      title: `Apagar ${data.unusedImages.length} ${data.unusedImages.length === 1 ? 'imagem' : 'imagens'} sem uso?`,
      confirm: `Apagar e liberar ${bytes(data.images.reclaimable)}`,
      danger: local.length > 0,
      body: (
        <>
          {local.length > 0 && (
            <p className="text-warn-ink">
              {local.length} {local.length === 1 ? 'foi construída' : 'foram construídas'} neste computador: só {local.length === 1 ? 'volta' : 'voltam'} com um novo build
              do projeto. As outras são baixadas de novo quando precisar.
            </p>
          )}
          <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line/70 px-3 py-1.5 text-[11px]">
            {data.unusedImages.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate font-mono text-muted">{i.tags[0] ?? i.id.slice(0, 12)}</span>
                {i.local && <span className="shrink-0 rounded-full bg-warn/10 px-1.5 text-[10px] text-warn-ink">construída aqui</span>}
                <span className="shrink-0 text-faint">{date(i.created)}</span>
                <span className="tabular w-16 shrink-0 text-right font-mono">{bytes(i.size)}</span>
              </li>
            ))}
          </ul>
        </>
      ),
      run: prune('images'),
    })
  }

  const askNamed = () => {
    if (!data) return
    const items = data.namedUnused.filter((v) => picked.has(v.name))
    const total = items.reduce((n, v) => n + v.size, 0)
    setPending({
      title: `Apagar ${items.length} ${items.length === 1 ? 'volume' : 'volumes'} com nome?`,
      confirm: `Apagar e liberar ${bytes(total)}`,
      danger: true,
      body: (
        <>
          <p>Os dados guardados neles, como bancos e uploads, somem de vez. Não dá para desfazer.</p>
          <VolumeList items={items} more={0} />
        </>
      ),
      run: async () => {
        const r = await removeVolumes(items.map((v) => v.name))
        const failed = r.results.filter((x) => !x.ok)
        setPicked(new Set())
        await load(true)
        return failed.length ? `${bytes(r.reclaimed)} liberados; ${failed.length} não ${failed.length === 1 ? 'pôde' : 'puderam'} ser apagados (${failed[0].error}).` : `${bytes(r.reclaimed)} liberados.`
      },
    })
  }

  return (
    <section aria-labelledby="disk-title" className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line px-[18px] py-3.5">
        <h2 id="disk-title" className="text-sm font-semibold">
          Disco e Docker
        </h2>
        <span className="text-xs text-faint">
          {data ? `o Docker ocupa ${bytes(docker)}${disk ? ` dos ${bytes(disk.used)} usados` : ''}` : 'quanto o Docker ocupa e o que dá para liberar'}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-faint">
          {data && !loading && `atualizado ${ago(data.at)}`}
          <button type="button" onClick={() => load(true)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs text-fg hover:border-faint/60 disabled:opacity-50">
            {loading ? <Spinner className="size-3" /> : <Icon name="restart" className="size-3" />}
            Recalcular
          </button>
        </span>
      </header>

      {error && <p className="px-[18px] py-3 text-sm text-danger">{error}</p>}
      {!data && loading && (
        <p className="flex items-center gap-2 px-[18px] py-5 text-sm text-faint">
          <Spinner className="size-4" /> Calculando o que o Docker ocupa (leva alguns segundos)…
        </p>
      )}
      {data?.error && <p className="px-[18px] py-3 text-sm text-danger">{data.error}</p>}

      {data && (
        <>
          <ul>
            <Category
              name="Cache de build"
              hint="camadas guardadas para acelerar os próximos builds"
              total={data.build.total}
              free={data.build.reclaimable}
              action={
                data.build.reclaimable > 0 && (
                  <span className="flex gap-1.5">
                    <Btn onClick={() => askBuild(false)}>Limpar</Btn>
                    <Btn onClick={() => askBuild(true)} title="docker builder prune -a: apaga todo o cache sem uso; os próximos builds demoram mais">
                      Tudo
                    </Btn>
                  </span>
                )
              }
            />
            <Category
              name="Volumes anônimos sem uso"
              hint={`${data.anonUnused.count} ${data.anonUnused.count === 1 ? 'volume' : 'volumes'} · nenhum container consegue reaproveitar · seguro apagar`}
              total={data.anonUnused.total}
              free={data.anonUnused.total}
              action={data.anonUnused.count > 0 && <Btn onClick={askVolumes}>Limpar</Btn>}
            />
            <Category
              name="Imagens"
              hint={`${data.images.count} no total · ${data.unusedImages.length} sem container usando${data.unusedImages.some((i) => i.local) ? ` · ${data.unusedImages.filter((i) => i.local).length} construídas aqui` : ''}`}
              total={data.images.total}
              free={data.images.reclaimable}
              action={data.unusedImages.length > 0 && <Btn onClick={askImages}>Limpar sem uso</Btn>}
            />
            <Category
              name="Volumes com nome sem uso"
              hint={`${data.namedUnused.length} ${data.namedUnused.length === 1 ? 'volume' : 'volumes'} de ambientes antigos · podem ter dados de banco: escolha um a um`}
              total={data.namedUnused.reduce((n, v) => n + v.size, 0)}
              free={data.namedUnused.reduce((n, v) => n + v.size, 0)}
              action={data.namedUnused.length > 0 && <Btn onClick={() => setChoosing((c) => !c)}>{choosing ? 'Fechar' : 'Escolher'}</Btn>}
            />
            {choosing && <NamedChooser items={data.namedUnused} picked={picked} setPicked={setPicked} onRemove={askNamed} />}
            <Category
              name="Containers"
              hint={`${data.containers.count} no total · ${data.containers.count - data.containers.active} parados · remova pelos projetos e worktrees`}
              total={data.containers.total}
              free={data.containers.reclaimable}
            />
          </ul>
          <Cause history={data.history} anon={data.anonUnused} />
        </>
      )}
      {pending && <Confirm p={pending} onClose={() => setPending(null)} />}
    </section>
  )
}

function Btn({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="shrink-0 rounded-lg border border-edge px-2.5 py-1 text-xs text-fg transition-colors hover:border-faint/60 hover:bg-raised">
      {children}
    </button>
  )
}

function Category({ name, hint, total, free, action }: { name: string; hint: string; total: number; free: number; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-divider px-[18px] py-3 first:border-t-0">
      <span className="min-w-0 flex-[1_1_260px]">
        <span className="block text-sm font-medium">{name}</span>
        <span className="block truncate text-[11px] text-faint">{hint}</span>
      </span>
      <span className="w-20 text-right">
        <span className="tabular block font-mono text-xs">{bytes(total)}</span>
        <span className="block text-[10px] text-faint">ocupa</span>
      </span>
      <span className="w-24 text-right">
        <span className={cx('tabular block font-mono text-xs', free > 0 ? 'text-on-ink' : 'text-faint')}>{free > 0 ? bytes(free) : '—'}</span>
        <span className="block text-[10px] text-faint">dá para liberar</span>
      </span>
      <span className="flex w-[8.5rem] justify-end">{action}</span>
    </li>
  )
}

function VolumeList({ items, more }: { items: DiskVolume[]; more: number }) {
  if (!items.length) return null
  return (
    <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line/70 px-3 py-1.5 font-mono text-[11px]">
      {items.map((v) => (
        <li key={v.name} className="flex gap-2 py-0.5">
          <span className="min-w-0 flex-1 truncate text-muted">{v.name.length === 64 ? v.name.slice(0, 12) + '…' : v.name}</span>
          <span className="shrink-0 text-faint">{date(v.createdAt)}</span>
          <span className="tabular w-16 shrink-0 text-right">{bytes(v.size)}</span>
        </li>
      ))}
      {more > 0 && <li className="py-0.5 text-faint">e mais {more}</li>}
    </ul>
  )
}

// Volumes com nome sem uso, por projeto, para marcar um a um. Nunca em massa: podem ter dados de banco.
function NamedChooser({ items, picked, setPicked, onRemove }: { items: DiskVolume[]; picked: Set<string>; setPicked: (s: Set<string>) => void; onRemove: () => void }) {
  const groups = new Map<string, DiskVolume[]>()
  for (const v of items) {
    const k = v.project || 'sem projeto'
    groups.set(k, [...(groups.get(k) ?? []), v])
  }
  const toggle = (name: string) => {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setPicked(next)
  }
  const total = items.filter((v) => picked.has(v.name)).reduce((n, v) => n + v.size, 0)
  return (
    <li className="border-t border-divider bg-soft px-[18px] py-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3">
        {[...groups.entries()].map(([project, vols]) => (
          <div key={project} className="rounded-xl border border-line bg-surface px-3 py-2">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{project}</span>
              <span className="tabular font-mono text-[11px] text-faint">{bytes(vols.reduce((n, v) => n + v.size, 0))}</span>
            </div>
            <ul>
              {vols.map((v) => (
                <li key={v.name}>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-[12px]">
                    <input type="checkbox" checked={picked.has(v.name)} onChange={() => toggle(v.name)} className="accent-[var(--danger)]" />
                    <span className="min-w-0 flex-1 truncate font-mono text-muted" title={v.name}>
                      {v.project && v.name.startsWith(v.project + '_') ? v.name.slice(v.project.length + 1) : v.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-faint">{date(v.createdAt)}</span>
                    <span className="tabular w-14 shrink-0 text-right font-mono text-[11px]">{bytes(v.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-faint">
          {picked.size ? `${picked.size} ${picked.size === 1 ? 'marcado' : 'marcados'} · ${bytes(total)}` : 'Marque os volumes que pode apagar. Os dados deles somem de vez.'}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={!picked.size}
          className="ml-auto rounded-lg border border-danger/35 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/15 disabled:opacity-40"
        >
          Apagar os marcados
        </button>
      </div>
    </li>
  )
}

// Prompt para o Claude Code do projeto de origem parar de deixar volumes de teste para trás.
function fixPrompt(s: VolumeSource): string {
  const where = s.origin === 'testcontainers' ? 'os testes que usam Testcontainers' : s.origin ? `o projeto "${s.origin}"` : 'o projeto que sobe essa imagem'
  return [
    `Meu Docker está acumulando volumes anônimos: o Server Manager registrou ${s.count} criados por containers da imagem ${s.image} (${where}). Cada container de teste é apagado, mas o volume anônimo do banco fica para trás e enche o disco.`,
    '',
    'Ajuste para não deixar volumes de teste:',
    `- Em docker run, use --rm (apaga os volumes anônimos junto) ou troque o volume do banco por tmpfs: --tmpfs /var/lib/postgresql/data (ajuste o caminho de dados da imagem ${s.image}).`,
    '- No docker-compose de testes, use tmpfs no lugar de volume para o diretório de dados, ou derrube com docker compose down -v.',
    '- Em scripts que removem containers, use docker rm -v.',
    s.origin === 'testcontainers' ? '- No Testcontainers, confira se o Ryuk está ativo e use withTmpFs para o diretório de dados do banco.' : '',
    '',
    'Não apague volumes com nome nem dados de desenvolvimento. Mostre o que mudou e como conferir com docker volume ls -f dangling=true.',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
}

// A causa do acúmulo: volumes anônimos criados por semana e quem os criou.
function Cause({ history, anon }: { history: DockerDisk['history']; anon: DockerDisk['anonUnused'] }) {
  const toast = useToast()
  const weeks = history.weeks ?? []
  const max = Math.max(1, ...weeks.map((w) => w.count))
  const total = weeks.reduce((n, w) => n + w.count, 0)
  const top = history.sources?.[0]
  return (
    <div className="border-t border-line bg-soft px-[18px] py-3.5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-faint">De onde vem o acúmulo</h3>
      {weeks.length === 0 ? (
        <p className="mt-1.5 text-xs text-faint">
          Acompanhando os volumes anônimos criados desde {date(history.since)}. Nenhum ainda.
          {anon.count > 0 && ` Os ${anon.count} sem uso de agora são de antes disso.`}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="flex h-16 items-end gap-1" role="img" aria-label={`Volumes anônimos criados por semana: ${weeks.map((w) => `${date(w.week)} ${w.count}`).join(', ')}`}>
              {weeks.map((w) => (
                <div key={w.week} className="flex w-7 flex-col items-center gap-1" title={`Semana de ${date(w.week)}: ${w.count}`}>
                  <span className="tabular text-[10px] text-faint">{w.count}</span>
                  <span className={cx('w-full rounded-t', w.count >= 50 ? 'bg-warn' : 'bg-muted')} style={{ height: `${Math.max((w.count / max) * 40, 2)}px` }} />
                </div>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-faint">volumes anônimos criados por semana · {total} desde {date(history.since)}</p>
          </div>
          {top && (
            <div className="min-w-0 flex-[1_1_280px] text-xs">
              <p className="text-body">
                Quem mais cria: <span className="font-mono text-fg">{top.image}</span>
                {top.origin && <span className="text-muted"> · {top.origin}</span>}
                {top.dir && <span className="font-mono text-faint"> · {shortPath(top.dir)}</span>} · {top.count}{' '}
                {top.count === 1 ? 'volume' : 'volumes'}
              </p>
              <p className="mt-1 text-faint">
                Se for banco de teste, suba com <code className="font-mono">--rm</code>, use <code className="font-mono">tmpfs</code> no lugar de volume, ou apague com{' '}
                <code className="font-mono">docker rm -v</code> / <code className="font-mono">docker compose down -v</code>.
              </p>
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(fixPrompt(top))) toast(top.dir ? `Prompt copiado. Cole no Claude Code em ${shortPath(top.dir)}` : 'Prompt copiado. Cole no Claude Code do projeto de origem.')
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-fg px-2.5 py-1 text-xs font-semibold text-bg hover:opacity-90"
              >
                <Icon name="copy" className="size-3" />
                Copiar prompt para o Claude
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Confirm({ p, onClose }: { p: Pending; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const toast = useToast()

  useEffect(() => {
    cancel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const run = async () => {
    setBusy(true)
    try {
      toast(await p.run())
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="disk-confirm" className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className={cx('grid size-10 shrink-0 place-items-center rounded-full', p.danger ? 'bg-danger/10 text-danger' : 'bg-raised text-muted')}>
            <Icon name="trash" className="size-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
            <h2 id="disk-confirm" className="mb-2 text-base font-semibold tracking-tight text-fg">
              {p.title}
            </h2>
            {p.body}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-raised/40 px-5 py-3">
          <button ref={cancel} type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-fg hover:border-faint/60">
            Cancelar
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className={cx('inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium hover:opacity-90', p.danger ? 'bg-danger text-white' : 'bg-fg text-bg')}
          >
            {busy && <Spinner className="size-3.5" />}
            {busy ? 'Apagando…' : p.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
