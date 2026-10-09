import { expect, test } from 'claude-code/testing'

import { redact, redactBlocks } from '../hooks/register'

// Fake values in the shape of real ones (AWS's own documented example key, repeated letters).
const GH = `ghp_${'a'.repeat(36)}`

test('redacts known token shapes and leaves prose alone', () => {
  const { text, count } = redact(`key AKIAIOSFODNN7EXAMPLE and ${GH} and sk-ant-${'b'.repeat(30)}`)
  expect(count).toBe(3)
  expect(text).toBe('key [REDACTED:aws-access-key] and [REDACTED:github-token] and [REDACTED:anthropic-key]')
  expect(redact('the token expired; ask for a new key').count).toBe(0)
})

test('redacts private keys and connection-string passwords only', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----'
  expect(redact(pem).text).toBe('[REDACTED:private-key]')
  expect(redact('postgres://app:hunter2secret@db:5432/x').text).toBe('postgres://app:[REDACTED:password]@db:5432/x')
})

test('assignment redaction only in aggressive mode', () => {
  const line = 'password = "correct-horse-battery"'
  expect(redact(line).count).toBe(0)
  expect(redact(line, true).text).toBe('password = "[REDACTED:secret]"')
})

test('walks tool_result content, string or blocks', () => {
  const { blocks, count } = redactBlocks(
    [
      { type: 'tool_result', tool_use_id: 't1', content: `TOKEN=${GH}` },
      { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: GH }] },
      { type: 'image', source: {} },
    ],
    false,
  )
  expect(count).toBe(2)
  expect(blocks[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: 'TOKEN=[REDACTED:github-token]' })
})

test('refuses to write a placeholder back to disk', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  const check = await $.tool.check({ tool: 'Write', input: { file_path: '.env', content: 'KEY=[REDACTED:github-token]' } })
  expect(check.decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Write', input: { file_path: 'a', content: 'ok' } })).decision).toBe('allow')
})
