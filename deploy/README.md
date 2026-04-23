# Deploy

Systemd units for orgsConsole daemons. User-level (no root needed), installed per-user on the VPS.

## Install on VPS

```bash
cp deploy/orgs-bot-ltbb.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now orgs-bot-ltbb
journalctl --user -u orgs-bot-ltbb -f
```

## Env vars required in `.env`

- `TELEGRAM_BOT_TOKEN` — shared across all orgsConsole daemons
- `TELEGRAM_LTBB_CHAT_ID` — the dedicated LTBB group (use `/chatid` in the group to discover)
- `PUBLIC_HOST` — e.g. `http://localhost:8000`, used to construct the OAuth redirect URI

`TELEGRAM_LTBB_CHAT_ID` can be left unset initially — the daemon still responds to `/chatid` in any chat so you can grab the id after creating the group.

## SAFE_MODE

Set `SAFE_MODE=1` in `.env` to make the Approve button mark actions as `sent_simulated` instead of actually calling `gmail.drafts.send`. Use this while iterating on Writer logic so accidental clicks don't mail real partners.

```bash
# Flip SAFE_MODE
sed -i 's/^SAFE_MODE=.*/SAFE_MODE=0/' .env      # disable (real sends)
sed -i 's/^SAFE_MODE=.*/SAFE_MODE=1/' .env      # enable (simulated sends)
systemctl --user restart orgs-bot-ltbb
```

## Scripts

- `deploy/smoke-test.ts` — creates a self-addressed test draft + action
- `deploy/writer.ts` — Writer v1 (first-touch outreach from CSV)
  - `--dry-run` print candidates, no drafts created
  - `--limit=N` max partners to process (default 3)
  - `--mode=first-touch` the only mode in v1

Run with: `/home/auri/.bun/bin/bun run deploy/writer.ts --dry-run --limit=5`
