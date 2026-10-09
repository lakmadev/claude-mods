import type { Register } from 'claude-code'

const MARK = '[REDACTED:'

const PATTERNS: [kind: string, pattern: RegExp][] = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----/g],
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe-key', /\b[sr]k_live_[A-Za-z0-9]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', /\bsk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g],
]

// user:password@ in connection strings; only the password goes.
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi
const AWS_SECRET = /(aws_secret_access_key\s*[=:]\s*["']?)([A-Za-z0-9/+=]{40})/gi
const ASSIGNMENT = /((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(["'])([^"'\s]{8,})\2/gi

export function redact(text: string, aggressive = false): { text: string; count: number } {
  let count = 0
  let out = text
  for (const [kind, pattern] of PATTERNS) {
    out = out.replace(pattern, () => (count++, `${MARK}${kind}]`))
  }
  out = out.replace(URL_PASSWORD, (_, head, __, at) => (count++, `${head}${MARK}password]${at}`))
  out = out.replace(AWS_SECRET, (_, head) => (count++, `${head}${MARK}aws-secret]`))
  if (aggressive) out = out.replace(ASSIGNMENT, (_, head, quote) => (count++, `${head}${quote}${MARK}secret]${quote}`))
  return { text: out, count }
}

type Block = { type: string; [field: string]: unknown }

// Rewrites text blocks and tool_result contents (string or nested text blocks); everything else passes as is.
export function redactBlocks(blocks: readonly Block[], aggressive: boolean): { blocks: Block[]; count: number } {
  let count = 0
  const text = (value: string) => {
    const result = redact(value, aggressive)
    count += result.count
    return result.text
  }
  const walk = (block: Block): Block => {
    if (block.type === 'text' && typeof block.text === 'string') return { ...block, text: text(block.text) }
    if (block.type !== 'tool_result') return block
    if (typeof block.content === 'string') return { ...block, content: text(block.content) }
    if (Array.isArray(block.content)) return { ...block, content: (block.content as Block[]).map(walk) }
    return block
  }
  const out = blocks.map(walk)
  return { blocks: out, count }
}

export const register: Register = (on, options) => {
  const aggressive = options.aggressive === true

  on('prompt.submit', async ($, e, next) => {
    const { text, count } = redact(e.text, aggressive)
    if (count === 0) return next(e)
    $.ui.toast(`secrets-redactor: removed ${count} secret(s) from your prompt before sending.`)
    return next({ ...e, text })
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'secrets-redactor could not scan this prompt, so it was not sent.' }))

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const { blocks, count } = redactBlocks(e.message.content, aggressive)
    if (count === 0) return next(e)
    $.ui.status(`secrets-redactor: ${count} secret(s) hidden from Claude`)
    return next({ ...e, message: { ...e.message, content: blocks } })
  }).catch(($, e, next) =>
    // Could not scan it: withhold the output rather than risk leaking it.
    next({
      ...e,
      message: {
        ...e.message,
        content: e.message.content.map(block =>
          block.type === 'tool_result' ? { ...block, content: 'Output withheld: secrets-redactor could not scan it.', is_error: true } : block,
        ),
      },
    }),
  )

  // A redacted value written back to disk would destroy the real secret.
  on('tool.check', async ($, e, next) => {
    const args = (e.input ?? {}) as Record<string, unknown>
    const written = [args.content, args.new_string, args.new_source, args.command].filter(v => typeof v === 'string') as string[]
    if (written.some(v => v.includes(MARK))) {
      return { decision: 'deny', reason: `secrets-redactor: this would write a ${MARK}…] placeholder over a real secret. Ask the user to make this change themselves.` }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'ask', reason: 'secrets-redactor could not check this call.' }))
}
