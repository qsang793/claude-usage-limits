import type { Limit } from '../types'

// Same font and palette as ponytail's metricsSvg, so the two rows read as one band.
// shortcut: copied from ponytail/hooks/band/metrics.ts, not imported; resync if ponytail changes its palette.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const STYLE = `.l,.s{fill:#87867f;font:12px ${FONT}}.p{fill:#1f1e1d;font:600 12px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.t{fill:#87867f;fill-opacity:.3}.b{fill:#87867f}.warning{fill:#a86400}.error{fill:#c62828}@media (prefers-color-scheme:dark){.p{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.warning{fill:#e3a03d}.error{fill:#ef6a5a}}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

export const tone = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : undefined)

// ponytail's buttons inset their text by about this much: the "● full" dot starts here, not at 0.
const INSET = 6

// One row, width 720 like metricsSvg, a column per window: label, 48px track, percent, reset date.
// Two columns, not ponytail's three: the full reset date needs about 200px.
export function usageSvg(ls: Limit[], names: Record<string, string>, reset: (iso: string) => string, width = 720): string {
  const height = 20
  const colW = width / 2
  let body = ''
  ls.forEach((l, i) => {
    const x = i * colW + (i === 0 ? INSET : 12)
    const pct = Math.min(Math.max(l.percentUsed, 0), 100)
    const bar = x + 44
    if (i > 0) body += `<line class="d" x1="${i * colW}" y1="2" x2="${i * colW}" y2="${height - 2}"/>`
    body += `<text class="l" x="${x}" y="14">${esc(names[l.kind] ?? l.kind)}</text>`
    body += `<rect class="t" x="${bar}" y="8" width="48" height="4" rx="2"/>`
    if (pct > 0) body += `<rect class="${tone(pct) ?? 'b'}" x="${bar}" y="8" width="${Math.max(2, (pct / 100) * 48)}" height="4" rx="2"/>`
    // Right-aligned so "100%" never runs into the reset time.
    body += `<text class="p" x="${bar + 86}" y="14" text-anchor="end">${l.percentUsed}%</text>`
    if (l.resetsAt) body += `<text class="s" x="${bar + 92}" y="14">${esc(fit(reset(l.resetsAt), Math.floor((colW - 148) / 6.2)))}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}</style>${body}</svg>`
}
