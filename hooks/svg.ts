import type { Limit } from '../types'

// Same font and palette as ponytail's metricsSvg, so the two rows read as one band.
// shortcut: copied from ponytail/hooks/band/metrics.ts, not imported; resync if ponytail changes its palette.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const STYLE = `.l,.s{fill:#87867f;font:12px ${FONT}}.p{fill:#1f1e1d;font:600 12px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.t{fill:#87867f;fill-opacity:.3}.b{fill:#87867f}.k{fill:#1f1e1d;fill-opacity:.55}.r{fill:none;stroke:#87867f;stroke-width:2}.rt{fill:none;stroke:#87867f;stroke-opacity:.3;stroke-width:2}.r-warning{stroke:#a86400}.r-error{stroke:#c62828}.warning{fill:#a86400}.error{fill:#c62828}@media (prefers-color-scheme:dark){.p{fill:#ecebe6}.k{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.warning{fill:#e3a03d}.error{fill:#ef6a5a}.r-warning{stroke:#e3a03d}.r-error{stroke:#ef6a5a}}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

export const tone = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : undefined)

// The cache column, worded and toned by the caller: "◔ cache 42m · 148k", the ring the share of the TTL left (0-1).
export type CacheCell = { label: string; remaining: number; value: string; detail?: string; tone?: 'warning' | 'error' }

// ponytail's buttons inset their text by about this much: the "● full" dot starts here, not at 0.
const INSET = 6
// A 12px system-font letter's width on average; SVG text cannot be measured when the string is built.
const CHAR = 5.7
const TRACK = 48

// How long each window lasts, to place the pace tick: how much of the window has gone by.
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
export const elapsed = (l: Limit, now: number) => {
  const len = WINDOW_MS[l.kind]
  if (!len || !l.resetsAt) return undefined
  const f = 1 - (Date.parse(l.resetsAt) - now) / len
  return f > 0 && f < 1 ? f : undefined
}

// What a text run takes at 12px, as measured: digits are 6.9 wide in either weight, spaces and stops about 2.6, "%" 10.
const NARROW = ' .,:·'
const textW = (s: string) =>
  [...s].reduce((w, ch) => w + (ch >= '0' && ch <= '9' ? 6.9 : NARROW.includes(ch) ? 2.6 : ch === '%' ? 10 : CHAR), 0)

// Either side of a divider: every column ends the same distance before it and starts the same distance after.
const GAP = 14
const RING_R = 5
const RING_C = 2 * Math.PI * RING_R

// One row, at most 720 wide like metricsSvg: per window a label, 48px track, percent and reset; then the cache, when known.
// Columns take their own width rather than equal shares, so the gaps between them are even; too long a row cuts the last reset.
export function usageSvg(
  ls: Limit[],
  names: Record<string, string>,
  reset: (iso: string) => string,
  now?: number,
  cache?: CacheCell,
  width = 720,
): string {
  const height = 20
  const cols = ls.map(l => ({ l, name: names[l.kind] ?? l.kind, pct: `${l.percentUsed}%`, reset: l.resetsAt ? reset(l.resetsAt) : '' }))
  const colW = (c: (typeof cols)[number]) =>
    Math.ceil(textW(c.name)) + 8 + TRACK + 6 + textW(c.pct) + (c.reset ? 6 + textW(c.reset) : 0)
  const cacheW = cache
    ? 2 * RING_R + 6 + textW(cache.label) + 6 + textW(cache.value) + (cache.detail ? 6 + textW(`· ${cache.detail}`) : 0)
    : 0
  const dividers = cols.length - 1 + (cache && cols.length > 0 ? 1 : 0)
  const over = INSET + cols.reduce((w, c) => w + colW(c), 0) + dividers * 2 * GAP + cacheW - width
  const last = cols.findLast(c => c.reset)
  if (over > 0 && last) last.reset = fit(last.reset, last.reset.length - Math.ceil(over / CHAR))

  let body = ''
  let x = INSET
  const divide = () => {
    body += `<line class="d" x1="${x + GAP}" y1="2" x2="${x + GAP}" y2="${height - 2}"/>`
    x += 2 * GAP
  }
  cols.forEach((c, i) => {
    if (i > 0) divide()
    const pct = Math.min(Math.max(c.l.percentUsed, 0), 100)
    // The same 8px after every label, so "5h" and "weekly" sit as close to their bars.
    const bar = x + Math.ceil(textW(c.name)) + 8
    body += `<text class="l" x="${x}" y="14">${esc(c.name)}</text>`
    body += `<rect class="t" x="${bar}" y="8" width="${TRACK}" height="4" rx="2"/>`
    if (pct > 0) body += `<rect class="${tone(pct) ?? 'b'}" x="${bar}" y="8" width="${Math.max(2, (pct / 100) * TRACK)}" height="4" rx="2"/>`
    // Where usage would be at an even pace: fill past the tick means faster than the window allows.
    const f = now === undefined ? undefined : elapsed(c.l, now)
    if (f !== undefined) body += `<rect class="k" x="${(bar + f * TRACK - 0.5).toFixed(1)}" y="5" width="1" height="10"/>`
    // Percent and reset in one text run, so the reset follows the percent whatever its width.
    const rest = c.reset ? `<tspan class="s" dx="6">${esc(c.reset)}</tspan>` : ''
    body += `<text x="${bar + TRACK + 6}" y="14"><tspan class="p">${c.pct}</tspan>${rest}</text>`
    x += colW(c)
  })
  if (cache) {
    if (cols.length > 0) divide()
    // The ring leads, so the words after it flow in one text run whatever their width; it empties clockwise from the top.
    const rx = x + RING_R
    body += `<circle class="rt" cx="${rx}" cy="10" r="${RING_R}"/>`
    if (cache.remaining > 0) {
      const arc = (cache.remaining * RING_C).toFixed(2)
      body += `<circle class="r${cache.tone ? ` r-${cache.tone}` : ''}" cx="${rx}" cy="10" r="${RING_R}" stroke-dasharray="${arc} ${RING_C.toFixed(2)}" transform="rotate(-90 ${rx} 10)"/>`
    }
    const detail = cache.detail ? `<tspan class="s" dx="6">· ${esc(cache.detail)}</tspan>` : ''
    body += `<text x="${rx + RING_R + 6}" y="14"><tspan class="l">${esc(cache.label)}</tspan><tspan class="p${cache.tone ? ` ${cache.tone}` : ''}" dx="6">${esc(cache.value)}</tspan>${detail}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}</style>${body}</svg>`
}
