import { expect, mock, test } from 'claude-code/testing'

import { bar, fromOauth, resetText } from './hooks/register'
import { elapsed, usageSvg } from './hooks/svg'

test('bar and reset text', async () => {
  expect(bar(42)).toBe('████░░░░░░')
  expect(bar(150)).toBe('██████████')
  // Local times, so the test holds in any time zone.
  const local = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString()
  const at10 = new Date(2026, 9, 22, 10, 0).getTime()
  expect(resetText(local(22, 12, 13), at10, 'en-US')).toBe('resets Oct 22, 12:13 · 2h13m left')
  expect(resetText(local(25, 14, 0), at10, 'en-US')).toBe('resets Oct 25, 14:00 · 3d4h left')
  expect(resetText(local(22, 9, 0), at10)).toBe('resets Oct 22, 09:00 · 0h00m left')
  expect(resetText(local(22, 21, 0), at10, 'vi-VN')).toMatch(/^reset 22 .*10, 21:00 · còn 11h00m$/)
})

test('svg row: neutral under 70%, warning and error above, escaped names', async () => {
  const names = { a: '5h', b: 'weekly', c: '<x>' }
  const svg = usageSvg(
    [
      { kind: 'a', percentUsed: 8, resetsAt: 'r' },
      { kind: 'b', percentUsed: 75 },
      { kind: 'c', percentUsed: 95 },
    ],
    names,
    () => '1h30m · 15:40',
  )
  expect(svg).toContain('class="b"')
  expect(svg).toContain('class="warning"')
  expect(svg).toContain('class="error"')
  expect(svg).toContain('1h30m · 15:40')
  expect(svg).toContain('&lt;x&gt;')
  expect(svg).not.toContain('<x>')
})

test('pace tick: share of the window gone by, none outside it or for unknown windows', async () => {
  const now = Date.parse('2026-10-22T10:00:00Z')
  const l = (kind: string, resetsAt?: string) => ({ kind, percentUsed: 50, resetsAt })
  expect(elapsed(l('five_hour', '2026-10-22T11:00:00Z'), now)).toBe(0.8)
  expect(Math.round(elapsed(l('seven_day', '2026-10-25T10:00:00Z'), now)! * 700)).toBe(400)
  expect(elapsed(l('five_hour', '2026-10-22T09:00:00Z'), now)).toBeUndefined()
  expect(elapsed(l('five_hour'), now)).toBeUndefined()
  expect(elapsed(l('other', '2026-10-22T11:00:00Z'), now)).toBeUndefined()
  const names = { five_hour: '5h' }
  expect(usageSvg([l('five_hour', '2026-10-22T11:00:00Z')], names, () => 'r', now)).toContain('class="k"')
  expect(usageSvg([l('five_hour', '2026-10-22T11:00:00Z')], names, () => 'r')).not.toContain('class="k"')
})

test('the band shows both windows under the bands beneath', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2026-10-22T10:00:00Z') }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ponytail</Text>
  })

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-22T12:13:00Z' },
      { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-10-25T14:00:00Z' },
    ],
    changed: ['rateLimits'],
  } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'usage-limits',
      component: 'AbovePrompt',
      surface,
      props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } as any,
    })
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg?.props.alt).toBe('5h 42%, weekly 91%')
      expect(String(svg?.props.source)).toContain('class="error"')
    } else {
      expect((await ui.find({ type: 'Text', text: /^5h/ }))?.text).toMatch(/42%/)
      expect((await ui.find({ type: 'Text', text: /^weekly/ }))?.text).toMatch(/91%/)
    }
    expect(await ui.find({ type: 'Text', text: /ponytail/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('a new session shows the last reading until its reset passes', async ($, on) => {
  let rateLimits: unknown[] = [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-22T12:13:00Z' },
    { kind: 'seven_day', percentUsed: 9, resetsAt: '2026-10-25T14:00:00Z' },
  ]
  on('clock.now', () => ({ value: Date.parse('2026-10-22T13:00:00Z') }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits } }) as any)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>below</Text>
  })

  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await start() // the previous session reads its windows
  rateLimits = [] // a new one has no reading before its first response
  await start()

  const ui = await $.ui.mount({
    plugin: 'usage-limits',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } as any,
  })
  expect((await ui.find({ type: 'Text', text: /^weekly/ }))?.text).toMatch(/9%/)
  // 5h reset at 12:13, it is 13:00 now: hidden.
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeUndefined()
  await ui.unmount()
})

test('oauth usage body: both windows, null reset dropped, junk ignored', async () => {
  expect(
    fromOauth({
      five_hour: { utilization: 0.0, resets_at: null },
      seven_day: { utilization: 3.04, resets_at: '2026-10-29T07:00:00+00:00' },
      seven_day_opus: null,
    }),
  ).toEqual([
    { kind: 'five_hour', percentUsed: 0, resetsAt: undefined },
    { kind: 'seven_day', percentUsed: 3, resetsAt: '2026-10-29T07:00:00+00:00' },
  ])
  expect(fromOauth(null)).toEqual([])
  expect(fromOauth({ five_hour: { utilization: 'x' } })).toEqual([])
})

test('a new session polls the account endpoint with its own credential', async ($, on) => {
  const asked: { url: string; auth?: string; beta?: string }[] = []
  const clock = mock.clock(on, { now: Date.parse('2026-10-22T10:00:00Z') })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }) as any)
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }) as any)
  on('http.fetch', (_, e: any) => {
    asked.push({ url: e.url, auth: e.init?.auth, beta: e.init?.headers?.['anthropic-beta'] })
    const body = { five_hour: { utilization: 12, resets_at: '2026-10-22T12:00:00Z' }, seven_day: { utilization: 3, resets_at: '2026-10-29T07:00:00Z' } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } } as any
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>below</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  await clock.advance(60_000) // inside the period: no second fetch

  expect(asked).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'h1', beta: 'oauth-2025-04-20' }])
  const ui = await $.ui.mount({
    plugin: 'usage-limits',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } as any,
  })
  expect((await ui.find({ type: 'Text', text: /^5h/ }))?.text).toMatch(/12%/)
  expect((await ui.find({ type: 'Text', text: /^weekly/ }))?.text).toMatch(/3%/)
  await ui.unmount()

  await clock.advance(60_000) // two minutes in: the next poll
  expect(asked.length).toBe(2)
})
