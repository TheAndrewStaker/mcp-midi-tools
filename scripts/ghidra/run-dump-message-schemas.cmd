@echo off
REM Dump AxeEdit's message-schema tables + function-byte globals.
REM Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-message-schemas.txt

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat
if not exist "%HEADLESS%" (
    echo ERROR: analyzeHeadless.bat not found at "%HEADLESS%".
    exit /b 1
)

set PROJECT_DIR=C:\Users\Steph
set PROJECT_NAME=ghidra-axe-edit
set SCRIPT_DIR=C:\dev\mcp-midi-tools\scripts\ghidra
set OUT_DIR=C:\dev\mcp-midi-tools\samples\captured\decoded

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

"%HEADLESS%" "%PROJECT_DIR%" "%PROJECT_NAME%" ^
    -process "Axe-Edit.exe" ^
    -noanalysis ^
    -readOnly ^
    -scriptPath "%SCRIPT_DIR%" ^
    -postScript DumpMessageSchemas.java

if errorlevel 1 (
    echo Ghidra headless exited with errors. See output above.
    exit /b 1
)

echo.
echo Done. Output:
echo   %OUT_DIR%\ghidra-message-schemas.txt
echo.
echo The output shows:
echo   - DAT_00f05094 byte value (should be 0x06 if FUN_005503a0 is the routing builder)
echo   - The schema table entries (field index -^> byte count) for both candidate builders
echo   - Nearby memory for sibling function-byte globals (helps map out the full
echo     set of message types AxeEdit can build).
endlocal
