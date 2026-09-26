type Result = { name: string; ok: boolean; error?: string }

// O backend recusa ações sem este header: outra aba do navegador não consegue enviá-lo.
const ACTION_HEADER = { 'X-Server-Manager': '1' }

export type Action = 'start' | 'stop' | 'restart'

export async function projectAction(key: string, action: Action): Promise<Result[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(key)}/${action}`, { method: 'POST', headers: ACTION_HEADER })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Falha (${res.status})`)
  return body.results ?? []
}

export async function fetchLogs(id: string, tail = 300): Promise<string> {
  const res = await fetch(`/api/containers/${encodeURIComponent(id)}/logs?tail=${tail}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Falha (${res.status})`)
  }
  return res.text()
}

export type CheckStatus = 'ok' | 'fail' | 'warn' | 'info'

export type Check = {
  group: string
  title: string
  status: CheckStatus
  detail?: string
  items?: string[]
  prompt?: string
}

export type Analysis = {
  dir: string
  displayDir: string
  key: string
  name: string
  registered?: string
  checks: Check[]
  summary: Record<CheckStatus, number>
  ready: boolean
  proposal: string
  allPrompts?: string
}

// Só lê arquivos do projeto: nada é criado nem alterado.
export async function analyzeProject(path: string): Promise<Analysis> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { ...ACTION_HEADER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Falha (${res.status})`)
  return body
}

export type Folder = {
  name: string
  path: string
  registered?: string
  compose: boolean
  node: boolean
  git: boolean
}

export type FolderList = { root: string; exists: boolean; folders: Folder[] }

export async function fetchFolders(): Promise<FolderList> {
  const res = await fetch('/api/folders')
  if (!res.ok) throw new Error(`Falha (${res.status})`)
  return res.json()
}
