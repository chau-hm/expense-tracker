# OpenClaw Telegram Rollout

## Current State

- Local CLI binary: `/opt/homebrew/bin/expense-tracker`
- OpenClaw wrapper binary: `/opt/homebrew/bin/expense-openclaw`
- Workspace skill: `/Users/openclaw/.openclaw/workspace/skills/expense/SKILL.md`
- Default production database path for chat use: `/Users/openclaw/.expense-tracker/expense-tracker.sqlite`
- Gateway config already has native Telegram skill commands enabled:
  - `commands.nativeSkills: "auto"`
  - `channels.telegram.commands.nativeSkills: true`

## Preflight

Run this before restarting the gateway:

```bash
./scripts/openclaw-expense-preflight.sh
```

The preflight does not write to the production database and does not restart the gateway. It checks:

- linked CLI binaries are present
- the `expense` workspace skill is model-visible and available as a command
- Telegram native skill-command config is enabled
- `/expense` wrapper arguments work against a temporary SQLite database

## Gateway Restart Window

Telegram command menu registration is handled by OpenClaw during gateway startup via Telegram `setMyCommands`. After confirming the preflight passes and the operator is physically available:

```bash
openclaw gateway restart
```

Then verify:

```bash
openclaw gateway status
HOME=/Users/openclaw openclaw skills info expense
```

From Telegram, test the command menu or send:

```text
/expense event create "Smoke Test" --format json
/expense event summary "Smoke Test"
```

If the direct `/expense` command is not visible in Telegram's native menu immediately, typed `/expense ...` may still work because plugin/skill commands can work even when not shown in the menu. Telegram clients can also cache command menus briefly.

## Troubleshooting

- If `/expense` is not listed by Telegram after restart, check gateway logs for `setMyCommands failed`.
- If Telegram reports too many commands, reduce enabled native skill/plugin commands or use `/skill expense ...` as the generic entrypoint.
- If direct chat replies do not appear, keep using explicit OpenClaw message delivery until the Telegram delivery issue is retested on a newer OpenClaw version.
- If the wrapper writes somewhere unexpected, pass `--db /Users/openclaw/.expense-tracker/expense-tracker.sqlite` explicitly.
