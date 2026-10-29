import type { Limit } from '../types'

// Same palette as ponytail's metricsSvg, so the two rows read as one band; the ring's arc takes the text color like the pace tick.
// shortcut: copied from ponytail/hooks/band/metrics.ts, not imported; resync if ponytail changes its palette.
const STYLE = `.t{fill:#87867f;fill-opacity:.3}.b{fill:#87867f}.k{fill:#1f1e1d;fill-opacity:.55}.r{fill:none;stroke:#1f1e1d;stroke-width:2}.rt{fill:none;stroke:#87867f;stroke-opacity:.3;stroke-width:2}.r-warning{stroke:#a86400}.r-error{stroke:#c62828}.warning{fill:#a86400}.error{fill:#c62828}@media (prefers-color-scheme:dark){.k{fill:#ecebe6}.r{stroke:#ecebe6}.warning{fill:#e3a03d}.error{fill:#ef6a5a}.r-warning{stroke:#e3a03d}.r-error{stroke:#ef6a5a}}`

export const tone = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : undefined)

// The cache column, worded and toned by the caller: "◔ cache 42m · 148k", the ring the share of the TTL left (0-1).
export type CacheCell = { label: string; remaining: number; value: string; detail?: string; tone?: 'warning' | 'error' }

// How long each window lasts, to place the pace tick: how much of the window has gone by.
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
export const elapsed = (l: Limit, now: number) => {
  const len = WINDOW_MS[l.kind]
  if (!len || !l.resetsAt) return undefined
  const f = 1 - (Date.parse(l.resetsAt) - now) / len
  return f > 0 && f < 1 ? f : undefined
}

// Only the graphics are drawings: the words beside them are Text, so the app sizes and wraps them like its own.
const svg = (width: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16"><style>${STYLE}</style>${body}</svg>`

const TRACK = 48
const RING_R = 5
const RING_C = 2 * Math.PI * RING_R

// A window's 48px track, filled by its use, with a tick where an even pace would be.
export function trackSvg(l: Limit, now?: number): string {
  const pct = Math.min(Math.max(l.percentUsed, 0), 100)
  let body = `<rect class="t" x="0" y="6" width="${TRACK}" height="4" rx="2"/>`
  if (pct > 0) body += `<rect class="${tone(pct) ?? 'b'}" x="0" y="6" width="${Math.max(2, (pct / 100) * TRACK)}" height="4" rx="2"/>`
  // Fill past the tick means faster than the window allows.
  const f = now === undefined ? undefined : elapsed(l, now)
  if (f !== undefined) body += `<rect class="k" x="${Math.min(f * TRACK, TRACK - 1).toFixed(1)}" y="3" width="1" height="10"/>`
  return svg(TRACK, body)
}

// The cache ring, emptying clockwise from the top as the TTL runs out.
export function ringSvg(c: CacheCell): string {
  const at = RING_R + 1
  let body = `<circle class="rt" cx="${at}" cy="8" r="${RING_R}"/>`
  if (c.remaining > 0) {
    const arc = (c.remaining * RING_C).toFixed(2)
    body += `<circle class="r${c.tone ? ` r-${c.tone}` : ''}" cx="${at}" cy="8" r="${RING_R}" stroke-dasharray="${arc} ${RING_C.toFixed(2)}" transform="rotate(-90 ${at} 8)"/>`
  }
  return svg(2 * at, body)
}
