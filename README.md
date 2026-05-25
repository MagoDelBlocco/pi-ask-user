# ask-user

Interactive question tool for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent).

Registers the `ask_user` tool, enabling the agent to ask you clarifying questions with a rich terminal UI — searchable option lists, multi-select, freeform text input, and optional comments.

## Features

- **Searchable single-select** with fuzzy filtering and a split-pane markdown preview
- **Multi-select** with checkboxes
- **Freeform text** fallback when no options fit
- **Optional comment** after selection for extra context
- **Desktop notifications** via `notify-send` (Linux)
- **Overlay mode** (centered modal) with hide/show toggle
- **Inline mode** (non-modal, in-place rendering)
- **Timeout** with auto-dismiss countdown
- **RPC/headless fallback** — degrades gracefully to `select()`/`input()` dialogs
- **Custom TUI rendering** — compact call/result display with expandable detail view

## Installation

Drop this directory into `~/.pi/agent/extensions/ask-user/` (or `.pi/extensions/ask-user/` for project-local). Pi auto-discovers it.

Reload with `/reload` or restart pi.

## Usage

The agent calls `ask_user` automatically when it encounters ambiguity. You can also invoke it manually:

```
/tool ask_user {"question": "What should we do?", "options": ["A", "B"]}
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `question` | `string` | *(required)* | The question to ask |
| `context` | `string` | — | Context shown before the question |
| `options` | `string[]` or `{ title, description? }[]` | `[]` | Choices for the user |
| `allowMultiple` | `boolean` | `false` | Allow selecting multiple options |
| `allowFreeform` | `boolean` | `true` | Add a "type custom response" option |
| `allowComment` | `boolean` | `false` | Prompt for an optional comment after selection |
| `displayMode` | `"overlay"` \| `"inline"` | `"overlay"` | Rendering mode |
| `overlayToggleKey` | `string` | `"alt+o"` | Shortcut to hide/show overlay (pass `"off"` to disable) |
| `commentToggleKey` | `string` | `"ctrl+g"` | Shortcut to toggle comment (pass `"off"` to disable) |
| `timeout` | `number` | — | Auto-dismiss after N milliseconds |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PI_ASK_USER_DISPLAY_MODE` | Default display mode (`overlay` or `inline`) |
| `PI_ASK_USER_OVERLAY_TOGGLE_KEY` | Default overlay toggle shortcut |
| `PI_ASK_USER_COMMENT_TOGGLE_KEY` | Default comment toggle shortcut |

### Keyboard Shortcuts

**Single-select:**
- `type` — fuzzy filter options
- `↑` / `↓` / `Tab` / `Shift+Tab` / `Ctrl+J` / `Ctrl+K` — navigate
- `Enter` — select
- `Esc` — clear filter / cancel
- `Backspace` — erase filter character

**Multi-select:**
- `↑` / `↓` — navigate
- `Space` — toggle checkbox
- `1`–`9` — toggle by number
- `Enter` — submit

**Freeform / Comment editor:**
- `Ctrl+Enter` — submit
- `Ctrl+J` — newline
- `Esc` — go back to selection

## Architecture

```
ask-user/
├── index.ts              # Entry point — registers the ask_user tool
├── package.json          # Extension config (pi.extensions)
├── src/
│   ├── types.ts          # Shared type definitions
│   ├── utils.ts          # Normalization, formatting, shortcuts, theme factories
│   ├── layout.ts         # Single-select split-pane row rendering
│   ├── borders.ts        # BoxBorderTop / BoxBorderBottom components
│   ├── select.ts         # WrappedSingleSelectList + MultiSelectList
│   └── ask-component.ts  # Main AskComponent (Container-based layout)
└── README.md
```

## License

MIT
