# usage-limits

A Claude Code mod that shows your 5-hour and weekly usage limits in a row above the prompt: how much of each window you have used, and the exact date and time it resets.

```
5h  ━━──────  9%  resets Oct 22, 15:40 · 1h11m left  │  weekly  ─────────  1%  resets Oct 22, 21:00 · 6h31m left
```

- The figures are account-wide and stay fresh while you are idle: every 2 minutes the mod asks Anthropic's usage endpoint (the one the app's own "Plan usage limits" panel reflects), once for all your open sessions, and after each reply it also takes the engine's own reading.
- The session's own login is used through the engine (`$.session.authorize`): the token never reaches the mod, and nothing is read from the Keychain. If the endpoint is unreachable or changes (it is undocumented), the row falls back to the engine's readings.
- The bar turns yellow at 70% and red at 90%.
- In the Claude desktop app it is drawn as a crisp SVG row; in a terminal, as a text bar.
- A new session shows the last known reading right away (the engine only learns the limits after the first reply); a window whose reset time has passed is hidden until the next reading.
- On macOS the dates follow the Claude desktop app's language (Settings → Language); elsewhere they are in English.
- It sits above other bands in the same slot (for example the ponytail band) instead of replacing them.

The limits exist only on a Claude subscription (Pro, Max, Team, Enterprise). With an API key there is nothing to show and the row stays hidden.

## Requirements

Claude Code 2.1.304 or newer.

## Install

At the prompt of a terminal session:

```
/plugin install usage-limits --marketplace qsang793/claude-usage-limits
```

From a shell:

```bash
claude plugin install usage-limits --marketplace qsang793/claude-usage-limits
```

Answer `y` to add the marketplace, then pick the user scope. The row appears in every session started afterwards, including the desktop app's Code tab.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `qsang793/claude-usage-limits`, then Add plugin.

## Uninstall

```bash
claude plugin uninstall usage-limits
```

## Develop

`claude plugin validate .` checks the mod, `claude plugin test .` runs `usage.test.tsx`.
