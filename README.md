# LightBurn MCP

An [MCP](https://modelcontextprotocol.io) server for the
[LightBurn REST API](https://github.com/LightBurnSoftware/LightBurn-REST).
It lets Claude, Cursor, ChatGPT and other AI assistants talk to the LightBurn
(or MillMage) that is running on your computer: read the open project, explain
and check cut settings, change them by sentence, apply materials from your
library, and drop generated SVGs straight into the workspace.

It runs locally, needs no account, and installs with one command on Windows
and macOS.

## What you can do

- **Understand a project** – "What's in my project and which layers are used?"
- **Check settings** – "Do any of my layers look wrong for 3 mm plywood?"
- **Change settings by sentence** – "Set the red layer to 300 mm/s and 20 % power."
- **Apply library materials** – "Use my 3 mm acrylic cut setting on layer blue."
- **Import generated artwork** – "Make an 80x50 mm name tag with rounded corners and put it at 100,100."
- **Read machine state** – position, job state/progress, overrides, jog settings, units.
- **Look at the camera overlay** – the assistant can view the camera image LightBurn has loaded.

## What it cannot do

The LightBurn API deliberately has **no machine control**: no start, stop,
pause, frame, jog or home. There is also no shape editing, layer assignment,
save or export. Changing cut settings edits the project only; the operator
reviews and runs the job in LightBurn. Read [SAFETY.md](SAFETY.md).

## Requirements

- LightBurn **2.2.00 or newer** (or MillMage with the REST API), running on the
  same computer during setup.
- [Node.js 20 or newer](https://nodejs.org/) (LTS is fine).

## Install

Start LightBurn, then run in a terminal (PowerShell on Windows, Terminal on
macOS):

```bash
npx github:DerChris2011/Lightburn_MCP setup
```

The setup walks through four steps:

1. **Application**: `lightburn` (default) or `millmage`.
2. **Capabilities** to request. Default is all four:
   `state` (machine/job state), `project` (read project data, including the
   camera overlay image), `upload` (import files), `project_write` (change cut
   settings). Request only what you want the assistant to have.
3. Then LightBurn shows a **consent dialog** naming "LightBurn MCP" and the
   requested capabilities. Approve it within 30 seconds.
4. Finally it asks which **MCP clients** to configure and writes their config
   (a backup of any existing file is kept next to it).

The first `npx` run clones and builds the package, which takes a minute. After
that the configured clients start the server directly.

You can repeat any step on its own:

```bash
npx github:DerChris2011/Lightburn_MCP pair --capabilities state,project
npx github:DerChris2011/Lightburn_MCP status
npx github:DerChris2011/Lightburn_MCP config claude-desktop --write
```

## Clients

`setup` (or `config <client> --write`) handles these; full JSON for each is in
[docs/clients.md](docs/clients.md).

| Client | How |
|---|---|
| Claude Desktop | `config claude-desktop --write`, then restart Claude Desktop |
| Claude Code | `config claude-code` prints the `claude mcp add …` command (setup runs it when the CLI is installed) |
| Cursor | `config cursor --write` |
| Windsurf | `config windsurf --write` |
| VS Code (Copilot) | `config vscode --write` |
| Gemini CLI | `config gemini-cli --write` |
| Anything else that starts a stdio server | command `node`, args `<path>/dist/index.js` (see `config cursor` for the exact paths) |

The written entry runs the server with the Node binary and package path that
`setup` found, so it starts instantly and does not depend on `npx` being on
the client's PATH.

## ChatGPT and other URL-based clients

ChatGPT adds MCP servers as *connectors* and only accepts a public HTTPS URL;
it cannot start a local process and rejects `localhost`. The server therefore
has an HTTP mode that always requires an access token:

```bash
npx github:DerChris2011/Lightburn_MCP --http
# LightBurn MCP listening on http://127.0.0.1:3917/mcp
# Token required: header "Authorization: Bearer <token>" or URL http://127.0.0.1:3917/mcp/<token>
```

Clients that can send headers use the bearer header. ChatGPT cannot, so use the
URL form and a tunnel:

```bash
ngrok http 3917          # or: cloudflared tunnel --url http://127.0.0.1:3917
```

Then add `https://<your-tunnel-host>/mcp/<token>` as a custom connector in
ChatGPT (Settings → Connectors; requires Developer Mode on an eligible plan).
Show the token with `lightburn-mcp token`, rotate it with
`lightburn-mcp token --rotate`.

**The tunnel URL is a secret.** Anyone who has it can read your project and
change cut settings. Stop the tunnel when you are done. LightBurn Software does
not endorse remote machine operation; see [SAFETY.md](SAFETY.md).

## Example prompts

- "Summarise my current LightBurn project: layers in use and their settings."
- "Layer C02 is 10 mm/s at 80 %. Is that plausible for 3 mm poplar plywood on a 40 W CO2?"
- "Set every layer that is in use to 2 passes."
- "Apply the 'Plywood 3' material from my library to layer 2."
- "Create a 60 mm circle with the text 'Workshop' inside as SVG and import it at 50,50, top-left origin."
- "Is the machine connected and what are the current speed/power overrides?"

## Tools

| Tool | Capability | What it does |
|---|---|---|
| `pair` | – | Pairs with LightBurn (consent dialog); stores the secret |
| `connection_info` | – | Product, host, port, paired?, capabilities, reachable? |
| `get_status` | state | Device name, connected flag, supports_z/overrides |
| `get_position` | state | Machine and workpiece coordinates (mm) |
| `get_units` | state | Display units for speed and distance |
| `get_jog_settings` | state | Jog distance/speed settings |
| `get_saved_positions` | state | Saved positions from the device profile |
| `get_state_snapshot` | state | Position, job, overrides, aux, connection in one call |
| `get_project` | project | Filename, shape count, workspace, device/laser capabilities |
| `get_layers` | project | Layer definitions (in-use only by default) |
| `get_cuts` | project | Cut settings (compact, in-use only by default) |
| `get_cut` | project | One cut entry with every field |
| `get_material_library` | project | The loaded material library |
| `get_camera_overlay_metadata` | project | Overlay size, placement, revision |
| `get_camera_overlay` | project | The camera overlay as a PNG image |
| `update_cut` | project_write | Partial update of one cut entry |
| `apply_material_to_cut` | project + project_write | Copy a library entry onto a cut |
| `upload_file` | upload (+ state) | Import a file or generated content into the project, with placement |
| `open_file` | upload (+ state) | Replace the project with a file |

Values follow LightBurn's display units (`get_units`). Every write tool ends
with a reminder to review the settings in LightBurn.

## Troubleshooting

- **"LightBurn does not appear to be running"** – LightBurn must be open; it
  serves the API on port 19520 (MillMage: 19521). Ports cannot be changed.
- **401 / "LightBurn rejected the token"** – the pairing was revoked, lacks the
  capability, or belongs to another LightBurn window. Run `pair` again. With
  several LightBurn windows open, the most recently focused one serves the API.
- **Pairing times out** – the consent dialog is in LightBurn's main window and
  closes after 30 seconds. Bring LightBurn to the front and run `pair` again.
- **"The cut settings editor is open"** – close the Cut Settings Editor in
  LightBurn and retry.
- **Server on another machine** – pair on the LightBurn machine, enable
  *Settings → Extensions → Allow API Access From Network*, copy the secret via
  *Manage API Security → Show Secret…*, and start the server with
  `LIGHTBURN_SECRET=<secret> LIGHTBURN_HOST=<ip>`. Windows may ask once for a
  firewall rule.
- **Server stops starting after a Node upgrade or `npm cache clean`** – the
  client configs point at the Node binary and package folder found during
  setup (GUI apps such as Claude Desktop have no PATH, so the full path is
  needed). Re-run `npx github:DerChris2011/Lightburn_MCP config <client> --write`
  to refresh them, or install globally with
  `npm install -g github:DerChris2011/Lightburn_MCP` and use `lightburn-mcp`
  as the command.
- **Config/secret location** – Windows `%APPDATA%\lightburn-mcp\config.json`,
  macOS `~/Library/Application Support/lightburn-mcp/config.json`.

## Development

```bash
git clone https://github.com/DerChris2011/Lightburn_MCP.git
cd Lightburn_MCP
npm install
npm test          # runs against an in-process mock of the LightBurn API
npm run build
node dist/index.js --help
```

The design and implementation plan live in `docs/superpowers/`.

## License

MIT. The LightBurn / MillMage API is governed by LightBurn Software's
[API EULA](https://github.com/LightBurnSoftware/LightBurn-REST/blob/main/API-EULA.md).
This project is not affiliated with LightBurn Software.
