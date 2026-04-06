# ShadowShell

Multi-terminal plugin for [Caido](https://caido.io) with AI preset support. Press `Cmd+J` to summon a terminal from the shadow — anywhere in Caido, instantly. Manage multiple shell tabs and launch Claude, Gemini, Codex and more with one click.

![ShadowShell](./resources/1.webp)

## Important Note

This plugin is a **temporary solution** created to provide terminal functionality within Caido until native terminal support is officially implemented (see [caido/caido#1381](https://github.com/caido/caido/issues/1381)). Once Caido adds a built-in terminal, this plugin will likely become redundant. In the meantime, feel free to use ShadowShell to enhance your workflow!

## Features

- **Multi-tab terminal** - Open multiple terminal sessions side by side within Caido
- **Split panes** - Vertical and horizontal splits for parallel workflows
- **AI presets** - Built-in presets for Claude, Gemini, Codex, and plain shell
- **Custom presets** - Create your own presets with custom commands and colors
- **Caido theme sync** - Terminal colors automatically match your Caido theme (dark/light)
- **Search** - Built-in terminal search via xterm.js SearchAddon
- **Resize** - Terminals auto-fit to pane size with proper PTY resize signals
- **Quick access** - Press `Cmd+J` to instantly open the terminal from anywhere in Caido

![Quick access](./resources/3.webp)

## Built-in Presets

| Preset | Command | Description |
|--------|---------|-------------|
| Claude | `claude` | Anthropic Claude Code CLI |
| Gemini | `gemini` | Google Gemini CLI |
| Codex | `codex` | OpenAI Codex CLI |
| Shell | *(default)* | Default system shell |

All built-in presets can be customized (command, name, description), and you can add your own.

![Add new preset](./resources/2.webp)

## Requirements

- **Python 3** — The backend uses a Python PTY relay to manage terminal sessions. Python 3 must be available at `/usr/bin/python3`.

## Installation

Install from the Caido plugin store, or build from source:

```bash
pnpm install
pnpm build
```

## Architecture

```
packages/
  backend/   # PTY relay (Python) + TCP bridge (Node.js)
  frontend/  # xterm.js terminals, tab/pane management, preset UI
```

The backend spawns a Python PTY relay per terminal session, communicating over a local TCP socket with length-prefixed JSON messages. The frontend renders terminals using xterm.js and manages tabs, splits, and preset configuration via localStorage.

## License

MIT
