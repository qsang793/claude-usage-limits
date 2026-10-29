import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cache, Limit } from '../types'
import { type CacheCell, ringSvg, tone, trackSvg } from './svg'

const limits = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])
// When the main conversation last called the API, and how much context it sent: per session, like the cache itself.
const cache = atom({ plugin: 'usage-limits', key: 'cache' } as const, null as Cache | null)

const NAMES: Record<string, string> = { five_hour: '5h', seven_day: 'weekly' }
const pad = (n: number) => String(n).padStart(2, '0')

// The cache column's words; dates come from Intl in the app's locale.
type Words = { cache: string; expired: string }
const EN: Words = { cache: 'cache', expired: 'expired' }
const WORDS: Record<string, Words> = { en: EN, vi: { cache: 'bộ đệm', expired: 'hết hạn' } }

const MIN = 60_000
const HOUR = 60 * MIN

// The main conversation's cache TTL, in the order Claude Code applies its controls; a subscription within plan usage gets 1h.
// shortcut: user settings only (not project or managed ones), and a subscription's drop to 5m on usage credits is missed; read it from the engine if it ever exposes one.
let ttl: Promise<number> | undefined
const cacheTtl = ($: EngineInterface) =>
  (ttl ??= (async () => {
    const pick = (v: unknown) => (v === '5m' ? 5 * MIN : v === '1h' ? HOUR : undefined)
    if ((await $.env.get('FORCE_PROMPT_CACHING_5M')) === '1') return 5 * MIN
    const fromEnv = pick(await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'))
    if (fromEnv) return fromEnv
    try {
      const settings = JSON.parse(await $.fs.read(`${await $.env.get('HOME')}/.claude/settings.json`))
      return pick(settings.promptCacheTtl) ?? HOUR
    } catch {
      return HOUR
    }
  })())

// The terminal's ring: a circle filled by the share of the TTL left.
export const ring = (remaining: number) => '○◔◑◕●'[Math.ceil(remaining * 4)]

export const kTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

// "42m · 148k" while warm; yellow in the last 10 minutes of a 1h TTL (the last minute of 5m), red once expired.
export const cacheCell = (c: Cache, ttlMs: number, now: number, lang = 'en-US'): CacheCell => {
  const left = c.at + ttlMs - now
  const warn = ttlMs > 5 * MIN ? 10 * MIN : MIN
  const words = WORDS[lang.slice(0, 2)] ?? EN
  return {
    label: words.cache,
    remaining: Math.min(Math.max(left / ttlMs, 0), 1),
    value: left > 0 ? `${Math.ceil(left / MIN)}m` : words.expired,
    detail: c.tokens ? kTokens(c.tokens) : undefined,
    tone: left <= 0 ? 'error' : left <= warn ? 'warning' : undefined,
  }
}

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

// The reset's local time, its date only when not today, then what is left: "21:00 · 6h31m", "Oct 28, 21:00 · 5d6h" in en-US.
export const resetText = (iso: string, now: number, lang = 'en-US') => {
  const at = new Date(iso)
  const mins = Math.max(0, Math.round((at.getTime() - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const left = d > 0 ? `${d}d${h}h` : `${h}h${pad(mins % 60)}m`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (at.toDateString() === new Date(now).toDateString()) return `${time} · ${left}`
  // Date and time apart: how Intl joins them ("Oct 22 at 12:13" vs "Oct 22, 12:13") changes between ICU versions.
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(at)
  return `${date}, ${time} · ${left}`
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
    // Redraw so the cache countdown moves while nothing else happens.
    $.clock.every(30_000, () => $.ui.invalidate('ui.render'))
    return r
  }).catch(($, e, next) => next(e))

  // Pushed after each turn and whenever a window moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await save($, e.rateLimits)
    return next(e)
  })

  // The main conversation's cache only: subagents keep caches of their own, which a question here never reads.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.usage) {
      const at = await $.clock.now()
      const tokens = await $.session.usage().then(u => u.context.tokens, () => undefined)
      await update($, cache, () => ({ at, tokens }))
    }
    return r
  }).catch(($, e, next) => next(e))

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
    const c = await read($, cache)
    const cc = c ? cacheCell(c, await cacheTtl($), now, lang) : undefined

    const { Box, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    // Block glyphs break in the desktop's proportional font: there only the track and ring are drawings, the words stay Text
    // so the app sizes them and wraps whole columns onto a second line in a narrow window, as it does its own rows.
    const mine =
      Svg ? (
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={3}>
          {ls.map(l => (
            <Box key={l.kind} flexDirection="row" alignItems="center" gap={1}>
              <Text size="footnote" dimColor>{NAMES[l.kind]}</Text>
              <Svg source={trackSvg(l, now)} alt={`${l.percentUsed}%`} />
              <Text size="footnote" weight="semibold" color={tone(l.percentUsed)}>
                {l.percentUsed}%
              </Text>
              {l.resetsAt ? <Text size="footnote" dimColor>{resetText(l.resetsAt, now, lang)}</Text> : null}
            </Box>
          ))}
          {cc ? (
            <Box key="cache" flexDirection="row" alignItems="center" gap={1}>
              <Svg source={ringSvg(cc)} alt={`${cc.label} ${cc.value}`} />
              <Text size="footnote" dimColor>{cc.label}</Text>
              <Text size="footnote" weight="semibold" color={cc.tone}>
                {cc.value}
              </Text>
              {cc.detail ? <Text size="footnote" dimColor>· {cc.detail}</Text> : null}
            </Box>
          ) : null}
        </Box>
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
          {cc ? (
            <Text key="cache">
              <Text color={cc.tone} dimColor={cc.tone === undefined}>
                {ring(cc.remaining)}{' '}
              </Text>
              <Text dimColor>{cc.label} </Text>
              <Text color={cc.tone}>{cc.value}</Text>
              {cc.detail ? <Text dimColor> · {cc.detail}</Text> : null}
            </Text>
          ) : null}
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
