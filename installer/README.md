# Installer build

This directory contains the install/uninstall wrappers used in the
v0.1.0 ZIP release, plus the Inno Setup script that produces the
`.exe` installer planned for v0.2.

## v0.1.0 ships as a ZIP (not the .exe)

Decided 2026-05-03: the v0.1.0 release is a ZIP that users download,
extract, and run `setup.cmd` from. The `.exe` installer (Inno Setup
path) is deferred until v0.2 once we have install-friction data from
forum users. See `docs/DECISIONS.md` 2026-05-03 v0.1.0 distribution
shape row.

## Files

**Used by v0.1.0 (ZIP release):**

- `setup.cmd` — bundled at the ZIP root. User double-clicks after
  extracting. Calls `merge-mcp-config.ps1` with the extract path so
  Claude Desktop's config points at the right `node.exe` and
  `dist\src\server\index.js`.
- `uninstall.cmd` — bundled at the ZIP root. Calls
  `unmerge-mcp-config.ps1` to remove the entry, then tells the user
  to delete the folder.
- `instructions.txt` — bundled at the ZIP root. Plain-text
  walkthrough for users browsing the extracted folder.
- `merge-mcp-config.ps1` — bundled at `install/` inside the ZIP.
  Idempotently adds the `mcp-midi-tools` entry to Claude Desktop's
  `claude_desktop_config.json`, preserving any other MCP servers the
  user has configured. Handles both the direct-download and Microsoft
  Store variants of Claude Desktop.
- `unmerge-mcp-config.ps1` — bundled at `install/` inside the ZIP.
  Removes our entry (leaves other MCP servers alone).

**Deferred to v0.2 (Inno Setup `.exe` installer):**

- `installer.iss` — Inno Setup script. Compiled by `ISCC.exe` to
  produce the `.exe` once v0.2 is ready. Source files come from
  `..\build\staging\` so the v0.1.0 build script's output is ready
  for it without changes.

## How to build the v0.1.0 ZIP release

```
npm run build:installer
```

This compiles TypeScript, downloads + caches the pinned Node version,
populates `build/staging/` with `node.exe` + `dist/` + production-only
`node_modules/` + the wrappers above, then packages it into
`build/dist/mcp-midi-tools-v0.1.0.zip` (~25–40 MB compressed). See
`docs/RELEASE-RUNBOOK.md` for the full release flow including smoke
testing.

## How to build the v0.2 `.exe` installer (when its time comes)

1. Run `npm run build:installer` to populate `build/staging/`.
2. Install Inno Setup 6.x (free) from <https://jrsoftware.org/isinfo.php>.
3. Compile:
   ```
   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\installer.iss
   ```
   Or open `installer.iss` in the Inno Setup IDE and press F9 (Build
   then Run) or Ctrl+F9 (Build only).
4. The installer lands at `build/dist/mcp-midi-tools-setup-v<version>.exe`.

## Troubleshooting

- **"node-midi failed to load"** at runtime — almost always means the
  bundled native binary's V8 ABI does not match the bundled `node.exe`.
  Make sure the `node --version` on PATH at build time matches
  `NODE_VERSION` in `scripts/build-installer.ts` (currently v24.13.1),
  and re-run `npm run build:installer -- --clean` to start fresh.
- **PowerShell ExecutionPolicy errors** during the post-install merge
  — the install script uses `-ExecutionPolicy Bypass` which works
  regardless of system policy. If you see policy errors anyway, the
  user's environment may have AppLocker or similar blocking
  PowerShell entirely.
- **Claude Desktop does not see the tool** after install — quit
  Claude Desktop fully (system tray right-click → Quit, not just close
  the window) and relaunch. Claude Desktop only reads the config file
  at startup.
