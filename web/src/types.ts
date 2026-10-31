export type Port = {
  hostIp: string
  hostPort: number
  containerPort: number
  proto: string
  url: string
}

export type Container = {
  id: string
  name: string
  label: string
  role: 'infra' | 'app'
  image: string
  state: string
  status: string
  health?: string
  running: boolean
  exists: boolean
  listening: boolean
  external: boolean
  projectKey: string
  projectName: string
  composeProject?: string
  composeService?: string
  workingDir?: string
  configFiles?: string
  command?: string
  appDir?: string
  ports: Port[]
  memUsed: number
  memLimit: number
  swapUsed?: number
}

export type Link = { label: string; url: string }

export type Worktree = { mainDir: string; mainName: string; mainKey?: string; branch?: string; missing?: boolean }

export type Project = {
  key: string
  name: string
  kind: 'configured' | 'compose' | 'standalone'
  alias?: string
  state: 'on' | 'off' | 'partial' | 'starting'
  dir?: string
  links: Link[]
  apps: Container[]
  infra: Container[]
  running: number
  total: number
  memUsed: number
  swapUsed?: number
  warnings: string[]
  worktree?: Worktree
}

export type HostMem = {
  total: number
  used: number
  available: number
  cached: number
  swapTotal: number
  swapUsed: number
  shmem?: number // memória compartilhada e tmpfs
}

// Pressão de memória (/proc/pressure/memory), em %: o que o systemd-oomd vigia.
export type Pressure = { available: boolean; some10: number; some60: number; some300: number; full10: number; full60: number }

export type PortEntry = {
  hostPort: number
  proto: string
  kind: 'container' | 'host'
  projectKey?: string
  projectName?: string
  containerName?: string
  label?: string
  containerPort?: number
  running: boolean
  url?: string
  conflict: boolean
}

export type ConflictParty = {
  projectKey: string
  projectName: string
  containerName: string
  label: string
  app: boolean
  command?: string
  appDir?: string
  image: string
  composeService?: string
  configFiles?: string
  workingDir?: string
  containerPort: number
  running: boolean
}

export type Conflict = {
  id: string
  kind: 'container-container' | 'container-host'
  hostPort: number
  proto: string
  keeper?: ConflictParty
  mover: ConflictParty
  proposedPort: number
  prompt: string
}

export type ClaudeChild = { name: string; memUsed: number }

export type ClaudeSession = {
  pid: number
  id?: string
  name: string
  cwd?: string
  status: 'busy' | 'waiting' | 'idle' | 'unknown' | string
  version?: string
  startedAt?: string
  updatedAt?: string
  memUsed: number
  procs: number
  children: ClaudeChild[]
  swapUsed?: number
  cwdGone?: boolean // a pasta foi apagada com a sessão aberta
}

export type ClosedSession = { id: string; name: string; cwd?: string; updatedAt: string; size: number }

export type ClaudeSummary = { available: boolean; canDelete?: boolean; sessions: ClaudeSession[]; closed?: ClosedSession[]; memUsed: number; swapUsed?: number }

export type HostApp = { name: string; memUsed: number; procs: number; inContainers?: number; swap?: number }

export type Temporary = { name: string; image: string; origin: 'testcontainers' | '--rm'; running: boolean }

export type Orphan = { id: string; name: string; project: string; app: string; running: boolean; status: string }

// Servidor de desenvolvimento rodando direto no computador, fora do Docker (npm run dev esquecido).
export type DevRun = {
  pid: number
  start: string
  command: string
  dir: string
  projectKey?: string
  projectName: string
  worktree?: string
  memUsed: number
  swapUsed?: number
  procs: number
  orphan: boolean // quem iniciou já fechou: ficou pendurado no systemd
  programs: string[]
}

export type Snapshot = {
  at: string
  version: string
  docker: boolean
  error?: string
  host: HostMem
  projects: Project[]
  ports: PortEntry[]
  conflicts: Conflict[]
  claude: ClaudeSummary
  apps: HostApp[]
  orphans: Orphan[]
  temporary?: Temporary[]
  devRuns?: DevRun[]
  pressure?: Pressure
  swapApps?: HostApp[]
  disks?: DiskFS[]
}

export type DiskFS = { path: string; total: number; used: number; free: number }

export type DiskCategory = { count: number; active: number; total: number; reclaimable: number }

export type DiskImage = { id: string; tags: string[]; size: number; created: string; local: boolean }

export type DiskVolume = { name: string; project?: string; size: number; createdAt: string }

export type VolumeSource = { image: string; origin?: string; dir?: string; count: number; last: string }

export type VolumeHistory = { since: string; weeks: { week: string; count: number }[]; sources: VolumeSource[] }

// O que o Docker ocupa no disco (docker system df), calculado sob demanda.
export type DockerDisk = {
  at: string
  error?: string
  build: DiskCategory
  images: DiskCategory
  containers: DiskCategory
  volumes: DiskCategory
  anonUnused: DiskCategory
  anonSample: DiskVolume[]
  namedUnused: DiskVolume[]
  unusedImages: DiskImage[]
  history: VolumeHistory
}
