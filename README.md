<div align="center">

<img src="assets/logo.svg" width="112" alt="">

# usage-limits

### Your Claude limits, right above the prompt.

5-hour and weekly usage, exact reset times and a prompt cache countdown, in the terminal and the desktop app.

[![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.304%2B-1f1e1d)](https://github.com/anthropics/claude-code) [![License: MIT](https://img.shields.io/badge/license-MIT-1f1e1d)](LICENSE)

<img src="assets/row.png" width="790" alt="The usage row in a real terminal session: 5h 9%, weekly 12%, cache 60m">

</div>

## Install

At the prompt of a terminal session:

```
/plugin install usage-limits --marketplace qsang793/claude-usage-limits
```

From a shell:

```bash
claude plugin install usage-limits --marketplace qsang793/claude-usage-limits
```

Answer `y` to add the marketplace, then pick the user scope. The row appears in every session started afterwards, including the desktop app's Code tab. A session already open keeps the version it loaded until you run `/reload-plugins` in it (the desktop app too); the numbers still refresh there meanwhile.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `qsang793/claude-usage-limits`, then Add plugin.

Requires Claude Code 2.1.304 or newer.

> [!NOTE]
> The limits exist only on a Claude subscription (Pro, Max, Team, Enterprise). With an API key there is nothing to show and the row stays hidden.

## Reading the row

In a terminal:

```
5h █░░░░░░░░░ 9% · Nov 1, 01:00 · 2h26m   weekly █░░░░░░░░░ 12% · Nov 5, 21:00 · 4d22h   ● cache 60m · 44k
```

| Part | Meaning |
| --- | --- |
| `█░░░` bar | How much of the window you have used. Yellow at 70%, red at 90%. |
| `Nov 1, 01:00 · 2h26m` | When it resets, with the date when that is not today, then how long until then. |
| `●` ring | The share of this conversation's prompt cache lifetime that is left. It empties as the cache runs out. |
| `60m` | Minutes until the cache expires, counted from its last reply. Yellow in the last 10 minutes (the last minute of a 5-minute cache), then `expired` in red. |
| `44k` | The context the next message would have to process again once the cache has expired. |

In the desktop app the row is drawn as SVG and each track also has a tick marking how much of the window has gone by. A bar past its tick is using the window faster than an even pace. This illustration uses sample values, on pace and then near the limit:

<p align="center"><img src="assets/demo.svg" width="360" alt="Illustration of the desktop row with sample values, on pace and then near the limit with the cache expired"></p>

Asking after the cache expires costs that whole context again, so it is the moment to `/compact` or start a new session before stepping away.

### The cache countdown

- The TTL is the one Claude Code picks: 1 hour on a subscription, unless `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL` or `promptCacheTtl` in `~/.claude/settings.json` say otherwise.
- Subagents' own caches are not counted, and the column appears after the conversation's first reply.

### How it behaves

- **Account-wide, refreshed while idle.** Every 2 minutes the mod asks Anthropic's usage endpoint (the one the app's own "Plan usage limits" panel reflects), once for all your open sessions, and after each reply it also takes the engine's own reading.
- **Instant in a new session.** A new session shows the last known reading right away (the engine only learns the limits after the first reply); a window whose reset time has passed is hidden until the next reading.
- **Desktop and terminal.** A crisp SVG row in the Claude desktop app, a text bar in a terminal.
- **Localized.** On macOS the dates and the cache column's words follow the Claude desktop app's language (Settings → Language), for example `bộ đệm` and `hết hạn` in Vietnamese; elsewhere they are in English.
- **Keeps other bands.** It sits above other bands in the same slot (for example the ponytail band) instead of replacing them.

## Privacy

The session's own login is used through the engine (`$.session.authorize`): the token never reaches the mod, and nothing is read from the Keychain.

The usage endpoint is undocumented. If it is unreachable or changes, the row falls back to the engine's readings.

## Uninstall

```bash
claude plugin uninstall usage-limits
```

## Develop

`claude plugin validate .` checks the mod, `claude plugin test .` runs `usage.test.tsx`.

To run a checkout as your mod, so a `git pull` is the whole update on every machine:

```bash
git clone https://github.com/qsang793/claude-usage-limits.git ~/claude-usage-limits
```

```bash
ln -s ~/claude-usage-limits ~/.claude/mods/usage-limits
```

Sessions started afterwards load the new code; one already open picks it up with `/reload-plugins`.

## License

[MIT](LICENSE)
