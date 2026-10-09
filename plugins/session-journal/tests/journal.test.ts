import { expect, mock, test } from 'claude-code/testing'

import { dayKey, formatEntries, standupDays } from '../hooks/register'

test('keys days by local date and covers the weekend on Mondays', () => {
  expect(dayKey(new Date(2026, 9, 9, 23, 59).getTime())).toBe('day:2026-10-09')
  expect(standupDays(new Date(2026, 9, 12, 9).getTime())).toBe(3)
  expect(standupDays(new Date(2026, 9, 13, 9).getTime())).toBe(1)
})

test('formats entries grouped by day', () => {
  const at = new Date(2026, 9, 9, 9, 5).getTime()
  const text = formatEntries([{ at, project: 'api', prompt: 'fix login\nmore', files: ['a.ts'], seconds: 40 }])
  expect(text).toContain('09:05  api  fix login (1 file)')
})

test('a finished turn lands in /journal', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('session.cwd', () => ({ value: '/work/api' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.run', () => ({}))
  await $.turn.start({ text: 'add rate limiting', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
  const shown = await $.command.run({ command: 'journal', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(shown.text).toContain('api  add rate limiting')
})
