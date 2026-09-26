const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

const MB = 1024 ** 2
const GB = 1024 ** 3

export function bytes(n: number): string {
  if (n >= GB) return `${nf1.format(n / GB)} GB`
  if (n >= MB) return `${nf0.format(n / MB)} MB`
  if (n > 0) return `${nf0.format(n / 1024)} KB`
  return '0 MB'
}

export function bytesParts(n: number): [string, string] {
  const [v, u] = bytes(n).split(' ')
  return [v, u]
}

export function percent(part: number, total: number): string {
  if (!total) return '0%'
  const v = (part / total) * 100
  return `${v > 0 && v < 1 ? nf1.format(v) : nf0.format(v)}%`
}

export function shortPath(p?: string): string {
  if (!p) return ''
  return p.replace(/^\/home\/[^/]+/, '~')
}

export function isWeb(url?: string): boolean {
  return !!url && /^https?:\/\//.test(url)
}

export function displayURL(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}
