import { expect, test } from 'claude-code/testing'

import { TEMPLATES, isVague } from '../hooks/register'

test('only short free-text prompts count as vague', () => {
  expect(isVague('fix it', 15)).toBe(true)
  expect(isVague('/compact', 15)).toBe(false)
  expect(isVague('   ', 15)).toBe(false)
  expect(isVague('please refactor the payment module so the retry logic lives in one place and add tests for it', 15)).toBe(false)
})

test('templates fill in the argument or a sensible default', () => {
  expect(TEMPLATES['explain-code']!.prompt('src/auth.ts')).toContain('src/auth.ts')
  expect(TEMPLATES['explain-code']!.prompt('')).toContain('the code I changed most recently')
})
