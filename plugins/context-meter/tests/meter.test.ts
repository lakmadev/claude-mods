import { expect, test } from 'claude-code/testing'

import { formatMeter, resetIn, sourceOf, warnings } from '../hooks/register'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const reading = (percent: number, used = 10, limits = true) => ({
  context: { tokens: 160_000, window: 200_000, percent },
  rateLimits: limits ? [{ kind: 'five_hour', percentUsed: used, resetsAt: '2026-10-09T13:52:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-12T16:00:00Z' }] : [],
  cost: { usd: 1.234 },
})

test('on a Claude plan: plain numbers, a reset once a window is tight, no $ estimate', () => {
  const r = reading(80, 85)
  expect(formatMeter(r, sourceOf(r, 'api'), NOW)).toBe('ctx 80% · 5h 85% resets 1h52m · week 40%')
})

test('on the API or a cloud provider: no windows, and the $ is the bill', () => {
  const r = reading(30, 0, false)
  expect(formatMeter(r, sourceOf(r, 'api'), NOW)).toBe('ctx 30% · $1.23 billed (API)')
  expect(formatMeter(r, sourceOf(r, 'bedrock'), NOW)).toBe('ctx 30% · $1.23 billed (Bedrock)')
  expect(resetIn('2026-10-09T12:38:00Z', NOW)).toBe('38m')
})

test('warns once per crossing and re-arms below the threshold', () => {
  const warned = new Set<string>()
  const limits = { context: 80, rateLimit: 90 }
  expect(warnings(reading(81), limits, warned, NOW)).toHaveLength(1)
  expect(warnings(reading(85), limits, warned, NOW)).toHaveLength(0)
  expect(warnings(reading(20), limits, warned, NOW)).toHaveLength(0)
  const both = warnings(reading(90, 95), limits, warned, NOW)
  expect(both).toHaveLength(2)
  expect(both[1]).toBe("Your Claude plan's 5h limit is at 95%; it resets in 1h52m.")
})
