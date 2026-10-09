import { expect, test } from 'claude-code/testing'

import { formatMeter, warnings } from '../hooks/register'

const reading = (percent: number, used = 10) => ({
  context: { tokens: 160_000, window: 200_000, percent },
  rateLimits: [{ kind: 'five_hour', percentUsed: used }],
  cost: { usd: 1.234 },
})

test('formats context, cost and limits on one line', () => {
  expect(formatMeter(reading(80))).toBe('ctx 80% (160k/200k) · $1.23 · 5h 10%')
})

test('warns once per crossing and re-arms below the threshold', () => {
  const warned = new Set<string>()
  const limits = { context: 80, rateLimit: 90 }
  expect(warnings(reading(81), limits, warned)).toHaveLength(1)
  expect(warnings(reading(85), limits, warned)).toHaveLength(0)
  expect(warnings(reading(20), limits, warned)).toHaveLength(0)
  expect(warnings(reading(90, 95), limits, warned)).toHaveLength(2)
})
