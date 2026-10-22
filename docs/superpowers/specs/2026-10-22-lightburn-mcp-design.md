# LightBurn MCP Server – Design

Datum: 2026-10-22
Status: Entwurf zur Freigabe

## 1. Absicht

Ein lokal laufender MCP-Server, der die LightBurn REST API
(https://github.com/LightBurnSoftware/LightBurn-REST) für KI-Assistenten
zugänglich macht. Ein Nutzer soll ihn von GitHub holen, in wenigen Minuten
installieren und dann mit Claude, Cursor, ChatGPT oder einem anderen
MCP-Client über sein offenes LightBurn-Projekt reden können.

Warum: Die LightBurn-API erlaubt Lesen von Projekt- und Maschinenzustand,
Ändern von Cut-Settings und Import von Dateien. In Alltagssprache ist das
für Laser-Anwender ein echter Gewinn: Einstellungen erklären lassen,
Einstellungen auf Fehler prüfen, Einstellungen per Satz ändern, und von der
KI erzeugte Geometrie ohne Umweg ins Projekt bringen.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

### Ziele

- Jeden dokumentierten Endpunkt der REST API als MCP-Tool anbieten.
- Kopplung (Pairing) mit LightBurn direkt aus dem Server heraus, ohne
  dass der Nutzer curl oder Skripte braucht.
- Läuft auf Windows 10/11 und macOS (Intel und Apple Silicon). Linux soll
  nicht kaputt sein, wird aber nicht getestet.
- Zwei Anschlussarten: `stdio` (Standard) und `http` (Streamable HTTP),
  damit sowohl prozessstartende Clients (Claude Desktop, Claude Code,
  Cursor, Windsurf, VS Code, Gemini CLI, Cline, Zed) als auch URL-basierte
  Clients (ChatGPT über Tunnel) funktionieren.
- Installation in drei Schritten, mit einem Setup-Befehl, der die
  Kopplung durchführt und die Client-Konfiguration schreibt.
- Die Sicherheits- und Haftungsvorgaben von LightBurn (SAFETY.md,
  API-EULA) sichtbar im README und in den Tool-Beschreibungen umsetzen.

### Nicht-Ziele

- Keine Maschinensteuerung. Die API bietet sie nicht an, und der Server
  simuliert sie nicht über Umwege.
- Keine eigene Geometrie-Engine. Der Server importiert Dateien, die der
  Client liefert, und erzeugt keine SVGs selbst. (Der Client kann SVG-Text
  liefern; siehe Tool `upload_file` mit `content`.)
- Kein Hosting, keine Cloud, kein Account.
- Keine Unterstützung für undokumentierte Endpunkte.

### Anti-Ziele (würde das Projekt zum Fehlschlag machen)

- Der Nutzer muss Node, Git und JSON-Dateien von Hand zusammenstecken.
- Das Secret landet in der Client-Config oder in Logs.
- Ein Tool ändert Cut-Settings, ohne dass im Ergebnis klar steht, dass der
  Nutzer in LightBurn prüfen muss.
- Der HTTP-Modus ist ohne Token von außen erreichbar.

## 3. Rahmenbedingungen

- LightBurn lauscht auf `localhost:19520`, MillMage auf `19521`. Ports sind
  fest. `POST /api/connect` geht nur von localhost.
- Auth: Bearer-Token = `hex(HMAC-SHA256(secret, floor(unix_time/60)))`.
  Server akzeptiert aktuelle und vorherige Minute. Jeder 401 ist
  ununterscheidbar; Vorgehen: Token neu rechnen, bei Wiederholung neu
  koppeln.
- Capabilities werden beim Pairing festgelegt und sind unveränderlich:
  `state`, `project`, `upload`, `project_write`.
- Uploads antworten mit 202; das Ergebnis kommt nur über den SSE-Stream
  `GET /api/events` als `file_imported`. Der Stream muss vor dem Upload
  offen sein.
- `GET /api/overlay` liefert PNG bei 200, JSON bei Fehler.
- Die API ist pre-stable (Spec 1.0.0, keine Versionsaushandlung). Der
  Server ignoriert unbekannte Felder und reicht Antworten weitgehend
  unverändert durch, statt sie streng zu typisieren.
- ChatGPT akzeptiert nur öffentliche HTTPS-URLs als Connector; localhost
  wird abgelehnt. Für ChatGPT ist ein Tunnel nötig. ChatGPT-Connectoren
  unterstützen nach aktuellem Stand nur OAuth oder keine Authentifizierung,
  keinen frei gesetzten Bearer-Header.
- **Zielversion (mein Call):** Entwickelt und getestet gegen LightBurn
  2.2.00, das auf dem Entwicklungsrechner läuft und laut Changelog
  `project_write`, Overlay-Endpunkte und die Galvo/Gantry-Struktur
  enthält. README nennt 2.2.00 als Minimum. Fehlt ein Endpunkt bei einer
  älteren Version (404 oder 400 beim Pairing), meldet das Tool das in
  Klartext und empfiehlt ein Update; es gibt keine Kompatibilitätsschicht
  für ältere Builds.

## 4. Entscheidungen

### 4.1 Technik (meine Vorschläge, vom Nutzer noch nicht bestätigt)

- **Sprache/Laufzeit:** TypeScript auf Node.js 20+. Begründung: Das
  offizielle MCP-SDK (`@modelcontextprotocol/sdk`) ist dort am reifsten,
  `npx` macht die Installation einzeilig, und Node ist auf Windows und
  macOS gleich zu bedienen.
- **Paketname:** `lightburn-mcp` (npm und GitHub-Repo). Binärname
  `lightburn-mcp`.
- **Lizenz:** MIT für den Server. Hinweis im README, dass die LightBurn
  API selbst unter der API-EULA von LightBurn Software steht.
- **Abhängigkeiten minimal:** MCP-SDK, `zod` für Tool-Schemas, sonst
  Node-Bordmittel (`fetch`, `crypto`, `fs`). Für den HTTP-Modus das vom
  SDK unterstützte Streamable-HTTP-Transport mit Node `http` oder
  `express`, je nachdem was das SDK zur Bauzeit empfiehlt.
- **Build:** `tsc` nach `dist/`. `dist/` wird nicht eingecheckt. Ein
  `prepare`-Script baut beim Install aus Git (npm installiert dafür die
  devDependencies). Damit funktioniert `npx github:<user>/lightburn-mcp`
  ohne Vorarbeit. Ob zusätzlich nach npm veröffentlicht wird, ist ein
  offener Punkt für den Nutzer; das Repo ist so angelegt, dass `npm
  publish` ohne Umbau möglich ist (`files`-Feld, `bin`, `prepublishOnly`).

### 4.2 Konfiguration und Secret

- Konfigdatei pro Nutzer, nicht pro Projekt:
  - Windows: `%APPDATA%\lightburn-mcp\config.json`
  - macOS: `~/Library/Application Support/lightburn-mcp/config.json`
  - Linux: `~/.config/lightburn-mcp/config.json`
- Inhalt: `{ "product": "lightburn" | "millmage", "host": "localhost",
  "secret": "...", "capabilities": [...], "paired_at": "ISO" }`.
  Datei wird mit Rechten 0600 angelegt (auf Windows best effort).
- Umgebungsvariablen überschreiben die Datei: `LIGHTBURN_SECRET`,
  `LIGHTBURN_HOST`, `LIGHTBURN_PRODUCT`. Damit lässt sich der Server auch
  auf einem anderen Rechner betreiben, wenn der Nutzer das Secret aus
  LightBurn (Manage API Security, Show Secret) übertragen hat.
- Das Secret erscheint nie in Tool-Antworten, Logs oder Client-Configs.

### 4.3 CLI

```
lightburn-mcp                 # startet den MCP-Server über stdio
lightburn-mcp --http [--port 3917] [--token X]   # Streamable HTTP
lightburn-mcp setup           # interaktiv: Pairing + Client-Config
lightburn-mcp pair [--capabilities state,project,upload,project_write]
lightburn-mcp status          # zeigt: gekoppelt? LightBurn erreichbar?
lightburn-mcp config <client> # druckt/schreibt Config-Snippet
```

- `setup` fragt: Produkt (LightBurn/MillMage), Capabilities (Standard:
  alle vier, mit Hinweis, dass `project` auch das Kamerabild umfasst),
  dann Pairing. Danach fragt es, welche Clients konfiguriert werden
  sollen (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, andere
  = Snippet anzeigen) und schreibt die jeweilige Config, nach Backup der
  bestehenden Datei. Pfade der Client-Configs für Windows und macOS sind
  im Code hinterlegt.
- `pair` startet den Dialog in LightBurn. Der Nutzer hat 30 Sekunden.
  Fehlerfälle (LightBurn nicht gestartet, abgelehnt, Timeout) werden in
  Klartext erklärt.
- `--http` startet auf `127.0.0.1` (Standard) und verlangt **immer** ein
  Zugriffstoken: entweder `--token X`, oder der Server erzeugt beim Start
  eines, speichert es in der Konfigdatei und druckt die fertige URL. Das
  Token wird auf zwei Wegen akzeptiert (mein Call, weil ChatGPT keinen
  eigenen Bearer-Header setzen kann): als `Authorization: Bearer <token>`
  **oder** als Pfadsegment `http://host:port/mcp/<token>`. Für Clients mit
  Header-Unterstützung wird der Header-Weg dokumentiert, für ChatGPT der
  Pfad-Weg über den Tunnel. README warnt, dass die URL damit ein Geheimnis
  ist, und zeigt, wie man das Token mit `lightburn-mcp token --rotate`
  erneuert. `--host 0.0.0.0` bleibt erlaubt, aber mit derselben
  Token-Pflicht. ChatGPT ist ein weiches Ziel: der Pfad wird gebaut und
  dokumentiert, Tests laufen gegen den Streamable-HTTP-Transport mit
  beiden Token-Wegen, nicht gegen ChatGPT selbst.

### 4.4 Tools

Namen in `snake_case`, Präfix weglassen (der Client zeigt den
Servernamen). Jede Beschreibung nennt die benötigte Capability. Jede
Antwort ist JSON-Text; das Overlay zusätzlich als Bild-Content.

Pairing und Diagnose (keine Capability nötig):

| Tool | Endpunkt | Zweck |
|---|---|---|
| `pair` | `POST /api/connect` | Löst den Zustimmungsdialog aus, speichert Secret. Parameter: `capabilities[]`, `application_name` (Standard "LightBurn MCP"). |
| `connection_info` | – | Gekoppelt? Capabilities? Erreichbar? Produkt? Ohne Secret-Ausgabe. |

Capability `state`:

| Tool | Endpunkt |
|---|---|
| `get_status` | `GET /api/status` (mit Hinweis, dass `connected=false` bei Ruida normal ist) |
| `get_position` | `GET /api/position` |
| `get_units` | `GET /api/units` |
| `get_jog_settings` | `GET /api/jog/settings` |
| `get_saved_positions` | `GET /api/goto/saved` |
| `get_state_snapshot` | `GET /api/events/poll` |

Capability `project`:

| Tool | Endpunkt |
|---|---|
| `get_project` | `GET /api/project` |
| `get_layers` | `GET /api/layers`, Parameter `in_use_only` (Standard true) |
| `get_cuts` | `GET /api/cuts`, Parameter `in_use_only` (Standard true), `compact` (Standard true: nur Kernfelder speed, power, passes, mode, enabled, profile) |
| `get_cut` | `GET /api/cuts/{index}` (vollständig) |
| `get_material_library` | `GET /api/material-library` |
| `get_camera_overlay_metadata` | `GET /api/overlay/metadata` |
| `get_camera_overlay` | `GET /api/overlay`, liefert PNG als Image-Content plus Metadaten |

Capability `project_write`:

| Tool | Endpunkt |
|---|---|
| `update_cut` | `POST /api/cuts/{index}`, Body wird durchgereicht (Partial Update). Antwort enthält den aktualisierten Eintrag und den festen Hinweis: "Prüfe die Einstellungen in LightBurn vor dem Start." 409 wird als "Cut-Editor in LightBurn ist offen, bitte schließen" übersetzt. |
| `apply_material_to_cut` | Kombiniert `GET /api/material-library` und `POST /api/cuts/{index}`: kopiert `mode` und `params` des Basis-Layers eines Bibliothekseintrags auf einen Cut, sowie Sub-Layer-Werte für Sub-Layer-Indizes, die der Ziel-Cut bereits hat. Parameter: `index`, `material`, `thickness` optional, `entry_guid` optional. Regeln (mein Call): mehrere passende Einträge ergeben keine Änderung, sondern eine Kandidatenliste mit `guid`; hat der Bibliothekseintrag mehr Sub-Layer als der Ziel-Cut, wird nichts geschrieben, sondern erklärt, dass der Nutzer die Sub-Layer in LightBurn anlegen oder mit `update_cut` nur den Basis-Layer setzen soll; `kind` von Eintrag und Cut muss übereinstimmen; der Maschinenblock (`galvo`/`gantry`) wird nur übernommen, wenn er zum `profile` des Cuts passt, sonst weggelassen und im Ergebnis genannt. |

Capability `upload` (plus `state` für Bestätigung):

| Tool | Endpunkt |
|---|---|
| `upload_file` | `POST /api/file/upload`. Parameter: `path` (lokaler Dateipfad) oder `content` (Text, z. B. SVG) plus `filename`; `x`, `y`, `origin`, `group_shapes`. Öffnet vorher den SSE-Stream, wartet bis zu 30 s auf `file_imported` und meldet Erfolg oder Fehler. Ohne `state`-Capability nur 202 zurückmelden. |
| `open_file` | `POST /api/file/open`, gleiche Bestätigungslogik; bei Nicht-Nativformaten wird `GET /api/project` als Bestätigung genutzt, wie in der Doku beschrieben. |

Bewusst weggelassen: `GET /api/events` als Dauerstream-Tool (MCP-Tools
sind Request/Response; der Stream wird intern für Uploads genutzt).

### 4.5 Fehlerbehandlung

- Connection refused: "LightBurn scheint nicht zu laufen oder lauscht
  nicht auf Port 19520. Starte LightBurn und versuche es erneut."
- 401: einmal Token neu rechnen und wiederholen; danach: "Secret
  ungültig oder Capability fehlt. Führe `pair` aus." Mit Hinweis auf
  Mehrfachinstanzen.
- 400/404/409 vom Cut-Endpunkt: Fehlertext der API durchreichen plus
  kurze Einordnung.
- Fehlende Capability wird vor dem Aufruf geprüft (aus der Konfig), mit
  dem Hinweis, dass neu gekoppelt werden muss.

### 4.6 Repo-Struktur

```
lightburn-mcp/
  src/
    index.ts          # CLI-Einstieg (Argument-Parsing, Transportwahl)
    server.ts         # MCP-Server, Tool-Registrierung
    client.ts         # REST-Client: Token, fetch, SSE, Fehlerübersetzung
    config.ts         # Konfigpfade, Lesen/Schreiben, Env-Override
    tools/*.ts        # ein Modul pro Tool-Gruppe
    setup.ts          # interaktives Setup, Client-Config-Writer
    clients.ts        # Pfade und Formate der MCP-Client-Configs
  test/               # Vitest: Token-Berechnung, Config, Client gegen Mock-Server, Tools
  docs/superpowers/specs/, docs/superpowers/plans/
  README.md           # Installation, Clients, ChatGPT/Tunnel, Safety, Troubleshooting
  SAFETY.md           # Kurzfassung der LightBurn-Vorgaben, Verweis auf Original
  LICENSE             # MIT
  package.json, tsconfig.json, .github/workflows/ci.yml (Build + Test auf windows-latest und macos-latest)
```

### 4.7 README-Inhalt

1. Was es ist, was es kann, was es nicht kann (inkl. keine Maschinensteuerung).
2. Voraussetzungen: LightBurn-Version mit REST API, Node 20+.
3. Installation: `npx lightburn-mcp setup`, Screenshots-Platzhalter für
   den Zustimmungsdialog.
4. Client-Abschnitte: Claude Desktop, Claude Code, Cursor, Windsorf,
   VS Code, Gemini CLI, ChatGPT (Tunnel), generisch.
5. Beispiel-Prompts.
6. Safety und Haftung.
7. Troubleshooting (401, Port, Mehrfachinstanzen, Firewall bei Netzwerkzugriff).
8. Entwicklung und Mitwirken.

## 5. Dem Builder überlassen

- Exakte Zod-Schemas der Tool-Parameter, orientiert an `openapi.yaml`.
- Ob `express` oder Node `http` für den HTTP-Transport.
- Mock-Server-Ansatz in den Tests.
- Wortlaut der Tool-Beschreibungen (Englisch, da Repo-Sprache Englisch).
- Repo- und README-Sprache: Englisch. Deutsch nur in diesem Design.
- Wahl des Interaktivitäts-Pakets für `setup` (z. B. `@inquirer/prompts`)
  oder Node `readline`.

## 6. Vom Nutzer entschieden

- Repo: https://github.com/DerChris2011/Lightburn_MCP (Install-Befehl:
  `npx github:DerChris2011/Lightburn_MCP setup`).
- Verteilung zunächst nur über GitHub; npm-Veröffentlichung bleibt
  vorbereitet, aber nicht Teil dieses Vorhabens.
- MillMage nur als ungetestete Option.
- TypeScript/Node, Paketname `lightburn-mcp`, MIT: freigegeben.

## 7. Vom Autor getroffene Calls nach dem Builder-Check

- Zielversion LightBurn 2.2.00, keine Kompatibilitätsschicht (4.1/3).
- `--http` verlangt immer ein Token; Token per Header oder Pfadsegment,
  letzteres für ChatGPT (4.3).
- `apply_material_to_cut` verweigert bei Mehrdeutigkeit und bei
  Sub-Layer-Überschuss, statt halb anzuwenden (4.4).
- `dist/` nicht eingecheckt, Build per `prepare` bei Git-Install (4.1).
