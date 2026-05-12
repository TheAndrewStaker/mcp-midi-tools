; ==============================================================
; MCP MIDI Tools — Inno Setup installer script (DEFERRED to v0.2)
; ==============================================================
;
; STATUS: Not used by v0.1.0. The v0.1.0 release ships as a ZIP
; (built by `npm run build:installer`, packaged at
; build/dist/mcp-midi-tools-v0.1.0.zip). Decided 2026-05-03; see
; docs/DECISIONS.md "v0.1.0 distribution shape" row.
;
; This file stays in-tree because it works against the same
; `build/staging/` output as the ZIP path. When v0.2 revisits the
; .exe distribution shape, it should be a config flip + signing
; decision, not a rewrite.
;
; To build the .exe (when v0.2 is active):
;   1. Run `npm run build:installer` to populate build/staging/.
;   2. Install Inno Setup 6.x from https://jrsoftware.org/isinfo.php
;   3. Compile this .iss file:
;        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\installer.iss
;
; Output: build/dist/mcp-midi-tools-setup-v<version>.exe
;
; Distribution model: per-user install, no admin/UAC, signing TBD
; (v0.1.0 was unsigned; v0.2 may revisit per DECISIONS.md cert row).

#define MyAppName "MCP MIDI Tools"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Stephen Staker"
#define MyAppURL "https://github.com/TheAndrewStaker/mcp-midi-tools"

[Setup]
; AppId uniquely identifies this application for upgrades and uninstalls.
; DO NOT change after first ship — changing it makes new versions install
; side-by-side instead of replacing.
AppId={{B43E1F6A-9C72-4C5A-BB80-2E1F4A5D8C03}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
VersionInfoVersion=0.1.0.0

; Per-user install — no admin, no UAC, installs into LOCALAPPDATA.
DefaultDirName={localappdata}\MCP-MIDI-Tools
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; License page shows Apache-2.0.
LicenseFile=..\LICENSE

; Output configuration.
OutputDir=..\build\dist
OutputBaseFilename=mcp-midi-tools-setup-v{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; The bundle prepared by `npm run build:installer`. This includes
; node.exe, dist/, node_modules/ (production-only), and metadata.
Source: "..\build\staging\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

; PowerShell helpers used at install/uninstall time. Live alongside
; the rest of the install for clean removal.
Source: "merge-mcp-config.ps1"; DestDir: "{app}\install"; Flags: ignoreversion
Source: "unmerge-mcp-config.ps1"; DestDir: "{app}\install"; Flags: ignoreversion

[Run]
; Register MCP MIDI Tools with Claude Desktop. Idempotent merge that
; preserves any other MCP servers the user has configured.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install\merge-mcp-config.ps1"" -InstallDir ""{app}"""; \
  Flags: runhidden waituntilterminated; \
  StatusMsg: "Registering MCP MIDI Tools with Claude Desktop..."

[UninstallRun]
; Remove the mcp-midi-tools entry from Claude Desktop's config so
; uninstall leaves a clean state.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install\unmerge-mcp-config.ps1"""; \
  Flags: runhidden; \
  RunOnceId: "RemoveMCPConfig"

[UninstallDelete]
; Helper directory removed cleanly on uninstall.
Type: filesandordirs; Name: "{app}\install"

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%n[name] is a local server that lets Claude talk to your Fractal AM4 over USB/MIDI. The installer registers the server with Claude Desktop automatically; you do not need to edit any config files.%n%nBefore connecting your AM4, make sure the Fractal AM4 USB driver is installed: https://www.fractalaudio.com/am4-downloads/%n%nClose Claude Desktop before continuing if it is currently running.

FinishedHeadingLabel=MCP MIDI Tools is ready to use
FinishedLabelNoIcons=Setup has registered MCP MIDI Tools with Claude Desktop. Open Claude Desktop and start a new chat — the AM4 tools will appear in the connector panel.%n%nIf Claude Desktop was running during install, fully quit it (system tray right-click then Quit) and reopen it to pick up the new server.

[Code]
function InitializeSetup(): Boolean;
begin
  // v0.1.0: minimal pre-install checks. Future: detect running Claude
  // Desktop and prompt to close it; detect prior installs and offer a
  // clean reinstall.
  Result := True;
end;
