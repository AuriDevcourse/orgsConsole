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
