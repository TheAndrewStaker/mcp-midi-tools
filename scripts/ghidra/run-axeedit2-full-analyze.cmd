@echo off
REM Run a full Ghidra Auto-Analyze pass on the II-generation Axe-Edit.exe
REM with all data-reference analyzers enabled. The default project import
REM omits some data-ref analyzers on 32-bit binaries, leaving the param
REM resolver's xrefs empty — Session 83's first MineAxeEditIIParamResolver
REM run found only 3 callers as a result. Run THIS once, then re-run
REM `run-axeedit2-paramresolver.cmd` to mine the dispatcher.
REM
REM Wall time: ~20-40 min on a typical laptop. Safe to run in background.
REM Re-running is idempotent — Ghidra detects already-analyzed bytes and
REM only re-runs analyzers that weren't applied first time around.

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat
if not exist "%HEADLESS%" (
    echo ERROR: analyzeHeadless.bat not found at "%HEADLESS%".
    exit /b 1
)

set PROJECT_DIR=C:\Users\Steph
set PROJECT_NAME=ghidra-axe-edit

REM No -analysisTimeoutPerFile flag: 0 is interpreted as "timeout immediately"
REM by Ghidra (counterintuitive). Omitting the flag gives unlimited time.

"%HEADLESS%" "%PROJECT_DIR%" "%PROJECT_NAME%" ^
    -process "Axe-Edit.exe"

if errorlevel 1 (
    echo Ghidra headless exited with errors.
    exit /b 1
)

echo Full analyze done. Now re-run scripts\ghidra\run-axeedit2-paramresolver.cmd.
endlocal
