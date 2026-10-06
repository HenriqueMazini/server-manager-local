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
}

export type Link = { label: string; url: string }

export type Project = {
  key: string
  name: string
  kind: 'configured' | 'compose' | 'standalone'
  state: 'on' | 'off' | 'partial' | 'starting'
  dir?: string
  links: Link[]
  apps: Container[]
  infra: Container[]
  running: number
  total: number
  memUsed: number
  warnings: string[]
}

export type HostMem = {
  total: number
  used: number
  available: number
  cached: number
  swapTotal: number
  swapUsed: number
}

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
  name: string
  cwd?: string
  status: 'busy' | 'waiting' | 'idle' | 'unknown' | string
  version?: string
  startedAt?: string
  updatedAt?: string
  memUsed: number
  procs: number
  children: ClaudeChild[]
}

export type ClaudeSummary = { available: boolean; sessions: ClaudeSession[]; memUsed: number }

export type HostApp = { name: string; memUsed: number; procs: number }

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
}
