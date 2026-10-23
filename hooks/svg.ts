import type { Limit } from '../types'

// Same font and palette as ponytail's metricsSvg, so the two rows read as one band.
// shortcut: copied from ponytail/hooks/band/metrics.ts, not imported; resync if ponytail changes its palette.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const STYLE = `.l,.s{fill:#87867f;font:12px ${FONT}}.p{fill:#1f1e1d;font:600 12px ${FONT}}.d{stroke:#1f1e1d;stroke-opacity:.12}.t{fill:#87867f;fill-opacity:.3}.b{fill:#87867f}.k{fill:#1f1e1d;fill-opacity:.55}.warning{fill:#a86400}.error{fill:#c62828}@media (prefers-color-scheme:dark){.p{fill:#ecebe6}.k{fill:#ecebe6}.d{stroke:#fff;stroke-opacity:.14}.warning{fill:#e3a03d}.error{fill:#ef6a5a}}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

export const tone = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : undefined)

// ponytail's buttons inset their text by about this much: the "● full" dot starts here, not at 0.
const INSET = 6
// Rough width of a 12px system-font character; SVG text cannot be measured when the string is built.
const CHAR = 6.2
const TRACK = 48

// How long each window lasts, to place the pace tick: how much of the window has gone by.
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
export const elapsed = (l: Limit, now: number) => {
  const len = WINDOW_MS[l.kind]
  if (!len || !l.resetsAt) return undefined
  const f = 1 - (Date.parse(l.resetsAt) - now) / len
  return f > 0 && f < 1 ? f : undefined
}

// One row, width 720 like metricsSvg, a column per window: label, 48px track, percent, reset date.
// Two columns, not ponytail's three: the full reset date needs about 200px.
export function usageSvg(
  ls: Limit[],
  names: Record<string, string>,
  reset: (iso: string) => string,
  now?: number,
  width = 720,
): string {
  const height = 20
  const colW = width / 2
  let body = ''
  ls.forEach((l, i) => {
    const x = i * colW + (i === 0 ? INSET : 12)
    const pct = Math.min(Math.max(l.percentUsed, 0), 100)
    const name = names[l.kind] ?? l.kind
    // The same 8px after every label, so "5h" and "weekly" sit as close to their bars.
    const bar = x + Math.ceil(name.length * CHAR) + 8
    if (i > 0) body += `<line class="d" x1="${i * colW}" y1="2" x2="${i * colW}" y2="${height - 2}"/>`
    body += `<text class="l" x="${x}" y="14">${esc(name)}</text>`
    body += `<rect class="t" x="${bar}" y="8" width="${TRACK}" height="4" rx="2"/>`
    if (pct > 0) body += `<rect class="${tone(pct) ?? 'b'}" x="${bar}" y="8" width="${Math.max(2, (pct / 100) * TRACK)}" height="4" rx="2"/>`
    // Where usage would be at an even pace: fill past the tick means faster than the window allows.
    const f = now === undefined ? undefined : elapsed(l, now)
    if (f !== undefined) body += `<rect class="k" x="${(bar + f * TRACK - 0.5).toFixed(1)}" y="5" width="1" height="10"/>`
    // Percent and reset in one text run, so the reset follows the percent whatever its width.
    const pctText = `${l.percentUsed}%`
    const after = bar + TRACK + 6
    const room = Math.floor((i * colW + colW - 8 - after) / CHAR) - pctText.length - 1
    const rest = l.resetsAt ? `<tspan class="s" dx="6">${esc(fit(reset(l.resetsAt), room))}</tspan>` : ''
    body += `<text x="${after}" y="14"><tspan class="p">${pctText}</tspan>${rest}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}</style>${body}</svg>`
}
