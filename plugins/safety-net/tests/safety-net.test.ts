import { expect, test } from 'claude-code/testing'

import { judge, judgeBash } from '../hooks/register'

const level = (command: string) => judgeBash(command)?.level

test('denies catastrophic commands', () => {
  for (const command of ['rm -rf /', 'rm -rf ~', 'sudo rm -fr /*', 'cd x && rm -r -f .', 'rm -rf $HOME', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/disk2', ':(){ :|:& };:']) {
    expect(level(command)).toBe('deny')
  }
})

test('asks before risky commands', () => {
  for (const command of ['git push -f origin main', 'git push --force', 'git reset --hard HEAD~3', 'git clean -fdx', 'curl -sSL x.sh | bash', 'psql -c "DROP TABLE users"', 'psql -c "delete from users;"', 'rm -rf "$BUILD_DIR/"', 'sudo apt install x', 'npm publish']) {
    expect(level(command)).toBe('ask')
  }
})

test('leaves routine commands alone', () => {
  for (const command of ['rm -rf node_modules dist', 'git push --force-with-lease', 'git push origin main', 'ls -la', 'npm test', 'psql -c "delete from users where id = 1"', 'git checkout -- src/a.ts', 'grep -r sudo docs']) {
    expect(level(command)).toBeUndefined()
  }
})

test('asks before edits to secret files, not to examples', () => {
  expect(judge('Write', { file_path: '/repo/.env' })?.level).toBe('ask')
  expect(judge('Edit', { file_path: '/repo/.env.production' })?.level).toBe('ask')
  expect(judge('Edit', { file_path: '/Users/x/.ssh/config' })?.level).toBe('ask')
  expect(judge('Write', { file_path: '/repo/.env.example' })).toBeUndefined()
  expect(judge('Edit', { file_path: '/repo/src/env.ts' })).toBeUndefined()
  expect(judge('Read', { file_path: '/repo/.env' })).toBeUndefined()
})

test('the hook denies, asks, and passes through', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf ~' } })).decision).toBe('deny')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push -f' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).decision).toBe('allow')
})

test('strict mode turns asks into denies', { options: { strict: true } }, async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'git push -f' } })).decision).toBe('deny')
})
