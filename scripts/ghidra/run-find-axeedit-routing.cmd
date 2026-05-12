@echo off
REM Headless run of FindAxeEditRouting.java against a Ghidra project
REM containing Axe-Edit.exe.
REM
REM PREREQ — one-time setup (Ghidra GUI, ~5 min):
REM   1. Open Ghidra GUI.
REM   2. File -> New Project -> Non-Shared Project.
REM      Project Directory: C:\Users\Steph
REM      Project Name:      ghidra-axe-edit
REM   3. File -> Import File. Pick:
REM        C:\Program Files (x86)\Fractal Audio\Axe-Edit\Axe-Edit.exe
REM      Accept all defaults; Ghidra detects PE32 + COFF.
REM   4. Double-click the imported Axe-Edit.exe in the project tree.
REM   5. When prompted "Auto-analyze?" -> YES. Accept default analyzers.
REM      Wait ~3-5 minutes for analysis to complete on the 12MB binary.
REM   6. Save (File -> Save) and close the CodeBrowser tool.
REM      Close Ghidra GUI.
REM
REM Then run this script from a normal terminal.
REM
REM Output:
REM   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit-routing.txt
REM
REM Usage:
REM   scripts\ghidra\run-find-axeedit-routing.cmd
REM
REM Override Ghidra install location if needed:
REM   set GHIDRA_INSTALL_DIR=C:\path\to\ghidra_X.Y.Z_PUBLIC
REM   scripts\ghidra\run-find-axeedit-routing.cmd

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat
if not exist "%HEADLESS%" (
    echo ERROR: analyzeHeadless.bat not found at "%HEADLESS%".
    echo Set GHIDRA_INSTALL_DIR to your Ghidra install root and re-run.
    echo Default expected: C:\tools\ghidra_12.0.4_PUBLIC
    exit /b 1
)

set PROJECT_DIR=C:\Users\Steph
set PROJECT_NAME=ghidra-axe-edit
set SCRIPT_DIR=C:\dev\mcp-midi-tools\scripts\ghidra
set OUT_DIR=C:\dev\mcp-midi-tools\samples\captured\decoded

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

REM Verify the project exists before running headless — much friendlier
REM error than Ghidra's "project not found" stack trace.
if not exist "%PROJECT_DIR%\%PROJECT_NAME%.gpr" (
    echo ERROR: Ghidra project not found at:
    echo   %PROJECT_DIR%\%PROJECT_NAME%.gpr
    echo.
    echo Open Ghidra GUI and follow the PREREQ steps in this file's header
    echo to import Axe-Edit.exe into a new project. ~5 minutes one-time setup.
    exit /b 1
)

"%HEADLESS%" "%PROJECT_DIR%" "%PROJECT_NAME%" ^
    -process "Axe-Edit.exe" ^
    -noanalysis ^
    -readOnly ^
    -scriptPath "%SCRIPT_DIR%" ^
    -postScript FindAxeEditRouting.java

if errorlevel 1 (
    echo.
    echo Ghidra headless exited with errors. See output above.
    exit /b 1
)

echo.
echo Done. Output:
echo   %OUT_DIR%\ghidra-axeedit-routing.txt
echo.
echo Look for:
echo   1. "## Byte-pattern search: F0 00 01 74 07 06" hits — these are the
echo      routing-write builder functions. Decompiled at the bottom.
echo   2. Functions emitting BOTH 0x06 AND 0x07 immediates — strong candidates.
echo   3. Symbol-table matches for routing/cable/connect — class-method hints.
echo.
echo Read the decompiled C of any "routing-builder" function. The payload
echo positions for cell-index / mask / reserved-bytes are visible in the
echo memory-write sequence (typically a series of store-byte instructions
echo into a SysEx buffer).
endlocal
