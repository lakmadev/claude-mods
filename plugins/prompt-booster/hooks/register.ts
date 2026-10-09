import type { EngineInterface, Register } from 'claude-code'

type Template = { description: string; argumentHint?: string; prompt: (args: string) => string }

const or = (args: string, fallback: string) => args.trim() || fallback

export const TEMPLATES: Record<string, Template> = {
  'fix-tests': {
    description: 'Run the tests, fix the root cause of failures, repeat until green',
    prompt: () =>
      "Run this project's test suite and find the failing tests. Fix the root cause in the code (change a test only if the test itself is wrong), then re-run until everything passes. End with a short summary of what was broken and why.",
  },
  'explain-code': {
    description: 'Explain code for someone new to this codebase',
    argumentHint: '[file, function or feature]',
    prompt: args =>
      `Explain ${or(args, 'the code I changed most recently')} for someone new to this codebase: what it is for, how control and data flow through it, the key files, and any gotchas. Keep it under 300 words and cite file:line.`,
  },
  'review-changes': {
    description: 'Review uncommitted changes for bugs, security issues and missing tests',
    prompt: () =>
      'Review my uncommitted changes (git diff HEAD, staged and unstaged) for bugs, security issues, and missing tests. List findings by severity with file:line and a one-line fix for each. Do not edit any files.',
  },
  'write-tests': {
    description: "Write tests using the project's own framework and conventions",
    argumentHint: '[file or function]',
    prompt: args =>
      `Write tests for ${or(args, 'the code I changed most recently')} using this project's existing test framework and conventions (look at neighbouring tests first). Cover the main path and the edge cases, then run them.`,
  },
  'commit-msg': {
    description: 'Draft a commit message for the staged changes',
    prompt: () =>
      'Write a commit message for the staged changes (git diff --cached): a conventional-commit subject under 72 characters and a short body explaining why. Output only the message; do not commit.',
  },
}

export function isVague(text: string, maxWords: number): boolean {
  const trimmed = text.trim()
  return trimmed !== '' && !trimmed.startsWith('/') && trimmed.split(/\s+/).length < maxWords
}

async function repoContext($: EngineInterface): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const git = (args: string[]) => $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 2000 }).catch(() => undefined)
  const status = await git(['status', '--short', '--branch'])
  if (status?.exitCode !== 0) return undefined
  const log = await git(['log', '-3', '--oneline'])
  const lines = status.stdout.trim().split('\n')
  const shown = lines.slice(0, 26).join('\n') + (lines.length > 26 ? `\n… ${lines.length - 26} more` : '')
  return [
    'Repo context, attached automatically because the prompt was short. Use it to resolve vague references ("this", "the bug", "it"); ignore it if irrelevant.',
    `git status:\n${shown}`,
    log?.exitCode === 0 && log.stdout.trim() ? `recent commits:\n${log.stdout.trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

export const register: Register = (on, options) => {
  const maxWords = Number(options.maxWords ?? 15)

  on('session.start', async ($, e, next) => {
    for (const [name, template] of Object.entries(TEMPLATES)) {
      await $.command.register({ name, description: template.description, argumentHint: template.argumentHint })
    }
    return next(e)
  })

  on('command.run', { command: ['fix-tests', 'explain-code', 'review-changes', 'write-tests', 'commit-msg'] }, async ($, e) => {
    const template = TEMPLATES[e.command]
    if (!template) return { text: `Unknown command ${e.command}` }
    await $.prompt.submit({ text: template.prompt(e.args) })
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    if (options.autoContext === false || e.origin.kind !== 'composer' || !isVague(e.text, maxWords)) return next(e)
    const context = await repoContext($).catch(() => undefined)
    return context ? next({ ...e, context: [...(e.context ?? []), context] }) : next(e)
  })
}
