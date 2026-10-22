import { expect, test } from 'claude-code/testing'

import { bar, resetText } from './hooks/register'
import { usageSvg } from './hooks/svg'

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
