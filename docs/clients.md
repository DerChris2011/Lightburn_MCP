# Client configuration

`lightburn-mcp setup` or `lightburn-mcp config <client> --write` writes these
files for you. This page shows what gets written, for manual setups.

Replace `<node>` with the path of your Node binary and `<pkg>` with the folder
where the package lives. `lightburn-mcp config cursor` prints both for your
machine. Typical values:

| | `<node>` | `<pkg>` |
|---|---|---|
| Windows | `C:\Program Files\nodejs\node.exe` | `%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\lightburn-mcp` |
| macOS | `/usr/local/bin/node` or `/opt/homebrew/bin/node` | `~/.npm/_npx/<hash>/node_modules/lightburn-mcp` |

If you prefer not to depend on the npx cache, install globally once
(`npm install -g github:DerChris2011/Lightburn_MCP`) and use `lightburn-mcp`
as the command with no args.

## Claude Desktop

Windows: `%APPDATA%\Claude\claude_desktop_config.json`
macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "lightburn": {
      "command": "<node>",
      "args": ["<pkg>/dist/index.js"]
    }
  }
}
```

## Claude Code

```bash
claude mcp add --scope user lightburn -- "<node>" "<pkg>/dist/index.js"
```

## Cursor

`~/.cursor/mcp.json` (same format as Claude Desktop).

## Windsurf

`~/.codeium/windsurf/mcp_config.json` (same format as Claude Desktop).

## VS Code (GitHub Copilot)

Windows: `%APPDATA%\Code\User\mcp.json`
macOS: `~/Library/Application Support/Code/User/mcp.json`

```json
{
  "servers": {
    "lightburn": {
      "type": "stdio",
      "command": "<node>",
      "args": ["<pkg>/dist/index.js"]
    }
  }
}
```

## Gemini CLI

`~/.gemini/settings.json`, key `mcpServers` (same entry as Claude Desktop).

## URL-based clients (ChatGPT, others)

Start `lightburn-mcp --http` and use `http://127.0.0.1:3917/mcp` with header
`Authorization: Bearer <token>`, or `http://127.0.0.1:3917/mcp/<token>` when
the client cannot send headers. For ChatGPT put a tunnel in front, see the
README.

Claude Code example for the HTTP mode:

```bash
claude mcp add --transport http lightburn http://127.0.0.1:3917/mcp --header "Authorization: Bearer <token>"
```
