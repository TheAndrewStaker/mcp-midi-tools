@echo off
REM Focused follow-up to run-find-axeedit-routing.cmd. Decompiles ONLY the
REM two functions that contain literal `F0 00 01 74` Fractal SysEx bytes,
REM plus their direct callers — bypassing the previous run's 250-function
REM cap that filled with JUCE class methods.
REM
REM Output:
REM   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-axeedit-headers.txt

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat
if not exist "%HEADLESS%" (
    echo ERROR: analyzeHeadless.bat not found at "%HEADLESS%".
    echo Set GHIDRA_INSTALL_DIR to your Ghidra install root and re-run.
    exit /b 1
)

set PROJECT_DIR=C:\Users\Steph
set PROJECT_NAME=ghidra-axe-edit
set SCRIPT_DIR=C:\dev\mcp-midi-tools\scripts\ghidra
set OUT_DIR=C:\dev\mcp-midi-tools\samples\captured\decoded

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

if not exist "%PROJECT_DIR%\%PROJECT_NAME%.gpr" (
    echo ERROR: Ghidra project not found at:
    echo   %PROJECT_DIR%\%PROJECT_NAME%.gpr
    exit /b 1
)

"%HEADLESS%" "%PROJECT_DIR%" "%PROJECT_NAME%" ^
    -process "Axe-Edit.exe" ^
    -noanalysis ^
    -readOnly ^
    -scriptPath "%SCRIPT_DIR%" ^
    -postScript FindAxeEditHeaderEmitters.java

if errorlevel 1 (
    echo.
    echo Ghidra headless exited with errors. See output above.
    exit /b 1
)

echo.
echo Done. Output:
echo   %OUT_DIR%\ghidra-axeedit-headers.txt
echo.
echo What to look for:
echo   - The two [TARGET] functions emit the F0 00 01 74 envelope. Read
echo     their bodies to see how the function byte (0x06 for routing,
echo     0x02 for SET_PARAM, etc.) is selected and how payload bytes
echo     are appended.
echo   - The [CALLER] functions are per-message-type wrappers. The one
echo     that passes 0x06 as the function byte IS the routing-write
echo     builder. Its body shows the exact payload layout.
endlocal
