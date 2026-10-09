import { expect, test } from 'claude-code/testing'

import { finishedMessage } from '../hooks/register'

test('summarizes the turn in one line', () => {
  expect(finishedMessage(42_000, 'Fixed the login bug.\nDetails…')).toBe('Done in 42s: Fixed the login bug.')
  expect(finishedMessage(300_000, '')).toBe('Done in 5m')
  expect(finishedMessage(31_000, 'x'.repeat(200))).toHaveLength('Done in 31s: '.length + 80)
})
