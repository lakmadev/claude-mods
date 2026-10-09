import type { Register } from 'claude-code'

export type Verdict = { level: 'deny' | 'ask'; why: string }

type Rule = [level: Verdict['level'], pattern: RegExp, why: string]

// ponytail: regex screening, not a shell parser; obfuscated commands (eval, base64, aliases) get through. It's a net, not a sandbox.
const BASH_RULES: Rule[] = [
  ['deny', /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'],
  ['deny', /\bmkfs(\.\w+)?\s/, 'formats a filesystem'],
  ['deny', /\bdd\b[^;&|]*\bof=\/dev\/(r?disk|sd|nvme|hd|mmcblk)/, 'writes raw bytes over a disk'],
  ['deny', />\s*\/dev\/(r?disk|sd|nvme|hd)\w*/, 'overwrites a disk device'],
  ['deny', /\bchmod\s+(-\S+\s+)*-\w*R\w*\s+(0?777|a\+rwx)\s+\/(\s|$)/, 'makes the whole filesystem world-writable'],
  ['ask', /\bgit\s+push\b[^;&|]*\s(--force(?!-with-lease)|-f)\b/, 'force-push rewrites remote history'],
  ['ask', /\bgit\s+reset\s+[^;&|]*--hard\b/, 'git reset --hard discards uncommitted work'],
  ['ask', /\bgit\s+clean\s+[^;&|]*-\w*f/, 'git clean deletes untracked files'],
  ['ask', /\bgit\s+(checkout\s+--\s+\.|restore\s+(-\S+\s+)*\.)(\s|$)/, 'discards all uncommitted changes'],
  ['ask', /\bgit\s+(branch\s+[^;&|]*-D\b|stash\s+(drop|clear)\b)/, 'deletes branches or stashes for good'],
  ['ask', /\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/, 'pipes a downloaded script straight into a shell'],
  ['ask', /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, 'drops or truncates database objects'],
  ['ask', /\bdelete\s+from\s+[\w."`]+\s*(;|"|'|$)/i, 'DELETE without a WHERE clause'],
  ['ask', /\bterraform\s+(destroy\b|apply\b[^;&|]*-auto-approve)/, 'changes infrastructure without a plan review'],
  ['ask', /\b(kubectl\s+delete|helm\s+uninstall|docker\s+(system|volume)\s+prune|gh\s+repo\s+delete)\b/, 'deletes cluster, container or repository resources'],
  ['ask', /\baws\s+s3\s+(rm|rb)\b[^;&|]*--(recursive|force)/, 'bulk-deletes S3 data'],
  ['ask', /\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b/, 'publishes a package publicly'],
  ['ask', /(^|[;&|(]\s*)sudo\s/, 'runs as root'],
]

const ROOTISH = /^["']?(\/|\/\*|~|~\/|~\/\*|\$\{?HOME\}?\/?\*?|\*|\.|\.\/|\.\/\*|\.\.|\.\.\/|\/(usr|etc|bin|sbin|var|opt|home|Users|System|Library|Applications)\/?)["']?$/

// rm needs real argument handling: `rm -rf node_modules` is routine, `rm -rf ~` is not.
function judgeRm(command: string): Verdict | undefined {
  for (const segment of command.split(/[;&|\n]+/)) {
    const words = segment.trim().split(/\s+/)
    if (words[0] === 'sudo') words.shift()
    if (words[0] !== 'rm') continue
    const flags = words.filter(w => w.startsWith('-'))
    const targets = words.slice(1).filter(w => !w.startsWith('-'))
    const isRecursive = flags.some(f => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f))
    if (!isRecursive) continue
    if (targets.some(t => ROOTISH.test(t))) return { level: 'deny', why: 'recursive delete of a root, home or whole-project directory' }
    if (targets.some(t => /^["']?\$/.test(t))) return { level: 'ask', why: 'recursive delete of a path built from a variable (empty variable = wrong directory)' }
  }
  return undefined
}

export function judgeBash(command: string): Verdict | undefined {
  const rm = judgeRm(command)
  if (rm) return rm
  const hit = BASH_RULES.find(([, pattern]) => pattern.test(command))
  return hit && { level: hit[0], why: hit[2] }
}

const PATH_RULES: [RegExp, string][] = [
  [/(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?$/, 'an environment/secrets file'],
  [/\.(pem|key|p12|pfx|keystore|jks)$/, 'a key or certificate file'],
  [/(^|\/)(id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|\.ssh\/|\.gnupg\/|\.aws\/credentials|\.netrc|\.npmrc|\.pypirc)/, 'a credentials file'],
  [/(^|\/)\.git\//, "git's internal database"],
  [/(^|\/)\.(zshrc|bashrc|bash_profile|profile|zprofile)$/, 'your shell startup file'],
]

export function judgePath(path: string): Verdict | undefined {
  const hit = PATH_RULES.find(([pattern]) => pattern.test(path))
  return hit && { level: 'ask', why: `edits ${hit[1]} (${path})` }
}

export function judge(tool: string, input: unknown): Verdict | undefined {
  const args = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash') return judgeBash(String(args.command ?? ''))
  const path = args.file_path ?? args.notebook_path
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool) && typeof path === 'string') return judgePath(path)
  return undefined
}

export const register: Register = (on, options) => {
  on('tool.check', async ($, e, next) => {
    const verdict = judge(String(e.tool), e.input)
    if (!verdict) return next(e)
    const reason = `safety-net: ${verdict.why}.`
    if (verdict.level === 'deny' || options.strict === true) {
      return { decision: 'deny', reason: `${reason} Blocked; if this is really intended, ask the user to run it themselves.` }
    }
    const below = await next(e)
    return below.decision === 'deny' ? below : { decision: 'ask', reason }
  }).catch(() => ({ decision: 'ask', reason: 'safety-net could not check this call; please review it.' }))
}
