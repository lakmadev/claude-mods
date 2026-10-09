# claude-mods

Eleven mods for [Claude Code](https://claude.com/claude-code). Install the ones you want; each is independent.

## Repo Radar

![Repo Radar: a live map of where Claude is working](docs/repo-radar.png)

**repo-radar** draws your repo as a live map of rectangles, one per folder. Reads glow **cyan**, edits **amber**, failures **red**, and each subagent gets its own colour, so you can watch parallel agents work across your codebase. Glows fade like a radar trace; files touched this session keep a faint tint. `/radar` opens it. [More →](plugins/repo-radar)

```
/plugin install repo-radar --marketplace lakmadev/claude-mods
```

## For fun

![pixel-pet: four forms, six moods](docs/pixel-pet.png)

| Mod | What it does |
| --- | --- |
| **pixel-pet** | A tiny animated pixel critter above your prompt, four rows tall. It bobs while Claude works, bounces with sparkles when a turn finishes, sweats on errors, dozes when you're away, blushes when you press **♥ pet**, and watches you type: its eyes follow your caret, it winces at backspaces and gasps when you delete a chunk. Moods crossfade instead of popping. It levels up every turn and changes colour as it grows: teal sprout → purple spark (lv 3) → coral blaze (lv 6) → golden legend with a crown (lv 10). `/pet` for stats, `/pet rename <name>`, `/pet color pink`, `/pet hide`. |
| **code-wrapped** | `/wrapped` opens your Claude Code Wrapped: a GitHub-style activity heatmap, hours, lines, streaks, top files and tools, your coding personality (Night Owl 🦉, Refactorer 🧹, Shell Wizard 🧙…) and 14 unlockable achievements that pop as toasts. **Copy share text** puts a one-line brag on your clipboard. |
| **lofi-mode** | Soft lo-fi beats start when Claude has been working for a few seconds and stop when it finishes. The loop is original and synthesized for this mod. `/lofi` toggles it. macOS audio. |

## For work

| Mod | What it does |
| --- | --- |
| **context-meter** | Status line: `ctx 62% (124k/200k) · $1.84 · 5h 41%`. Toasts when context passes 80% or a usage window passes 90%. |
| **safety-net** | Refuses catastrophic commands (`rm -rf ~`, `mkfs`, `dd of=/dev/disk`, fork bombs). Asks before risky ones (force-push, `reset --hard`, `curl \| sh`, `DROP TABLE`, `terraform destroy`, `sudo`, …) and before edits to `.env`, keys, `~/.ssh`, `.git/` or shell rc files. |
| **changes-pane** | Side pane listing every file Claude changed this session with `+/-` line counts. `/changes` opens it. |
| **done-notifier** | Chime, toast and desktop notification when a turn longer than 30s finishes or Claude is waiting for you. |
| **prompt-booster** | Short prompts ("fix it") get your branch, changed files and recent commits as hidden context. Adds `/fix-tests`, `/explain-code`, `/review-changes`, `/write-tests`, `/commit-msg`. |
| **session-journal** | Logs each turn (project, prompt, files touched) across sessions. `/journal [days]` lists it; `/standup [days]` writes a Done / In progress / Blockers update. |
| **secrets-redactor** | Replaces API keys, tokens, private keys and connection-string passwords with `[REDACTED:kind]` in your prompts and in tool output before the model sees them, and blocks writing a placeholder back over a real secret. |

## Install

In a Claude Code terminal session:

```
/plugin install pixel-pet --marketplace lakmadev/claude-mods
```

Answer `y` to add the marketplace, then pick a scope. Repeat with any other mod name from the table.

## Settings

Each mod's options show in `/config` once it is installed:

- **context-meter**: `contextWarnPercent` (80), `rateLimitWarnPercent` (90)
- **safety-net**: `strict` (off). Turns every "ask" into a refusal. Turn it on if you run in auto or bypass-permissions mode, where an ask can be approved without you.
- **changes-pane**: `autoOpen` (on). The pane opens on its own only in terminals 144+ columns wide.
- **done-notifier**: `minSeconds` (30), `sound` (on), `desktop` (on)
- **prompt-booster**: `autoContext` (on), `maxWords` (15)
- **session-journal**: `retentionDays` (30), `model` (`haiku`)
- **secrets-redactor**: `aggressive` (off). Also redacts quoted `password = "…"`-style assignments.
- **pixel-pet**: `name` (Bit), `color` (auto), `sound` (on)
- **lofi-mode**: `volume` (0.35), `delaySeconds` (4)

## Limits

- safety-net matches patterns. It is not a sandbox: obfuscated commands (`eval`, base64, aliases) get through.
- secrets-redactor only catches known token shapes. Once a secret is redacted, Claude can't use it: put real values in files yourself.
- pixel-pet, code-wrapped and session-journal keep their data in Claude Code's plugin store on your machine. Two sessions finishing a turn at the same instant can drop one update.
- done-notifier plays its chime on macOS only. Desktop notifications use `osascript` (macOS) or `notify-send` (Linux).
- session-journal keeps your prompts locally, in Claude Code's plugin store on your machine. `/standup` sends the log to the model you configure.

## Develop

Each mod lives in `plugins/<name>/`: `hooks/register.ts(x)` is the code and `tests/` holds its tests.

```
claude plugin validate plugins/<name>
claude plugin test plugins/<name>
claude --plugin-dir plugins/<name>
```

## License

MIT, see [LICENSE](LICENSE).
