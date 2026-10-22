import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'
import { tone, usageSvg } from './svg'

const limits = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])

const NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'weekly' }
const pad = (n: number) => String(n).padStart(2, '0')

// The words around the date; the date itself comes from Intl in the app's locale.
type Words = { reset: string; left: (t: string) => string }
const EN: Words = { reset: 'resets', left: t => `${t} left` }
const WORDS: Record<string, Words> = { en: EN, vi: { reset: 'reset', left: t => `còn ${t}` } }

// The Claude app's language (Settings → Language), which the engine does not pass to mods.
// shortcut: read once per load from the macOS app's config.json; a language switch shows after the next session, other OSes get en-US.
let locale: Promise<string> | undefined
const appLocale = ($: EngineInterface) =>
  (locale ??= (async () => {
    try {
      const config = JSON.parse(await $.fs.read(`${await $.env.get('HOME')}/Library/Application Support/Claude/config.json`))
      return typeof config.locale === 'string' ? config.locale : 'en-US'
    } catch {
      return 'en-US'
    }
  })())

export const bar = (pct: number, width = 10) => {
  const full = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

// The reset's local date and time, then what is left: "resets Oct 22, 21:00 · 6h31m left" in en-US.
export const resetText = (iso: string, now: number, lang = 'en-US') => {
  const at = new Date(iso)
  const mins = Math.max(0, Math.round((at.getTime() - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const left = d > 0 ? `${d}d${h}h` : `${h}h${pad(mins % 60)}m`
  const words = WORDS[lang.slice(0, 2)] ?? EN
  // Date and time apart: how Intl joins them ("Oct 22 at 12:13" vs "Oct 22, 12:13") changes between ICU versions.
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(at)
  return `${words.reset} ${date}, ${pad(at.getHours())}:${pad(at.getMinutes())} · ${words.left(left)}`
}

// Also kept across sessions: the engine has no reading until the first response, so a new session starts from the last one.
const save = async ($: EngineInterface, next: Limit[]) => {
  const ls = next.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
  await update($, limits, () => ls)
  if (ls.length > 0) await $.store.set('limits', ls)
}

// The engine's figures only move when this session calls the API; this endpoint is account-wide, like the app's own panel.
// shortcut: undocumented endpoint (CCometixLine and others poll it); if it changes, the engine's rateLimits remain.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 120_000

// `utilization` is already 0-100; `resets_at` is null while a window is unused.
export const fromOauth = (body: unknown): Limit[] =>
  ['five_hour', 'seven_day'].flatMap(kind => {
    const w = (body as Record<string, { utilization?: unknown; resets_at?: unknown } | null> | null)?.[kind]
    if (!w || typeof w.utilization !== 'number') return []
    const resetsAt = typeof w.resets_at === 'string' ? w.resets_at : undefined
    return [{ kind, percentUsed: Math.round(w.utilization * 10) / 10, resetsAt }]
  })

let polling = false
const poll = async ($: EngineInterface) => {
  const now = await $.clock.now()
  // One fetch per period across all sessions; the others take what it stored.
  if (polling || now - (((await $.store.get('fetchedAt')) as number | undefined) ?? 0) < POLL_MS) {
    const shared = (await $.store.get('limits')) as Limit[] | undefined
    if (shared?.length) await update($, limits, () => shared)
    return
  }
  polling = true
  try {
    await $.store.set('fetchedAt', now)
    // The engine sets the session's own credential header; the token never reaches this module.
    const auth = await $.session.authorize()
    if (auth?.kind !== 'bearer') return
    const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    const ls = r.ok ? fromOauth(JSON.parse(r.text)) : []
    if (ls.length > 0) await save($, ls)
  } catch {
    // Offline or the endpoint changed: the engine's figures stay.
  } finally {
    polling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const fresh = await $.session.usage().then(u => u.rateLimits, () => [])
    if (fresh.length > 0) await save($, fresh)
    $.clock.after(0, () => void poll($))
    $.clock.every(POLL_MS, () => void poll($))
    return r
  }).catch(($, e, next) => next(e))

  // Pushed after each turn and whenever a window moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await save($, e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const now = await $.clock.now()
    // A remembered window whose reset has passed no longer says anything true: hide it until the next reading.
    // Before this session's first reading, the last one kept across sessions: drawn from the first frame, whatever session.start did.
    const current = await read($, limits)
    const known = current.length > 0 ? current : (((await $.store.get('limits')) as Limit[] | undefined) ?? [])
    const ls = known.filter(l => NAMES[l.kind] && !(l.resetsAt && Date.parse(l.resetsAt) <= now))
    if (e.props.hasSurvey || ls.length === 0) return below
    const lang = await appLocale($)

    const { Box, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    // Text glyphs break in the desktop's proportional font: draw the row as an SVG there, like ponytail's metrics.
    const mine =
      Svg ? (
        <Svg
          source={usageSvg(ls, NAMES, iso => resetText(iso, now, lang))}
          alt={ls.map(l => `${NAMES[l.kind]} ${l.percentUsed}%`).join(', ')}
        />
      ) : (
        <Box flexDirection="row" gap={3} width={e.props.bodyColumns}>
          {ls.map(l => (
            <Text key={l.kind}>
              <Text dimColor>{NAMES[l.kind]} </Text>
              <Text color={tone(l.percentUsed)} dimColor={tone(l.percentUsed) === undefined}>
                {bar(l.percentUsed)}
              </Text>{' '}
              {l.percentUsed}%{l.resetsAt ? <Text dimColor> · {resetText(l.resetsAt, now, lang)}</Text> : null}
            </Text>
          ))}
        </Box>
      )
    return below ? (
      <Box flexDirection="column" gap={1}>
        {mine}
        {below}
      </Box>
    ) : (
      mine
    )
  }).catch(($, e, next) => next(e))
}
