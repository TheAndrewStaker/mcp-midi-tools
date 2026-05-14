@echo off
setlocal

rem MCP MIDI Control v0.1.0 — post-install MIDI device check.
rem
rem Asks the OS what MIDI devices it can see and reports whether the
rem AM4, Axe-Fx II, or Hydrasynth is visible. Bypasses Claude Desktop
rem entirely, so if the tools "don't appear" in Claude you can use
rem this to confirm whether the device is reachable at all.
rem
rem Run after setup.cmd, before opening Claude Desktop.

set "INSTALL_DIR=%~dp0"
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"

set "ENTRY=%INSTALL_DIR%\dist\cli\verify-midi.js"

if not exist "%ENTRY%" (
    echo.
    echo verify-midi.js not found at:
    echo   %ENTRY%
    echo.
    echo The install bundle looks incomplete. Re-extract the ZIP and
    echo try again.
    echo.
    pause
    exit /b 1
)

rem Prefer the bundled node.exe (v0.1.0 ZIP layout); fall back to the
rem system `node` on PATH if the bundle isn't present (e.g. a developer
rem source-install).
set "NODE_EXE=%INSTALL_DIR%\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" "%ENTRY%"
set "RC=%ERRORLEVEL%"

echo.
pause
exit /b %RC%
