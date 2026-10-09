import { expect, mock, test } from 'claude-code/testing'

import { gainFor } from '../hooks/register'

test('maps volume onto a safe gain', () => {
  expect(gainFor(0)).toBe(0)
  expect(gainFor(0.5)).toBe(0.75)
  expect(gainFor(99)).toBe(1.5)
})

test('starts after the delay on a long turn and stops when it ends', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const played: unknown[] = []
  on('audio.play', ($, e) => {
    played.push(e)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.run', () => ({}))
  await $.turn.start({ text: 'refactor everything', turnId: 't1' })
  await clock.advance(1000)
  expect(played).toHaveLength(0)
  await clock.advance(4000)
  expect(played).toHaveLength(1)
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
  // Stopped: the next long turn starts a fresh loop rather than thinking one still plays.
  await $.turn.start({ text: 'again', turnId: 't2' })
  await clock.advance(5000)
  expect(played).toHaveLength(2)
  await $.command.run({ command: 'lofi', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await $.turn.start({ text: 'quiet please', turnId: 't3' })
  await clock.advance(5000)
  expect(played).toHaveLength(2)
})
