@echo off
REM Walk AxeEdit's message-type directory at DAT_00f05080+ and dump every
REM (index, ptr) entry, dereferencing each pointer to find the routing
REM message struct (functionByte = 0x06).
REM
REM Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-message-directory.txt

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
    -postScript DumpMessageDirectory.java

if errorlevel 1 (
    echo Ghidra headless exited with errors. See output above.
    exit /b 1
)

echo.
echo Done. Output:
echo   %OUT_DIR%\ghidra-message-directory.txt
echo.
echo Look for lines marked "*** firstByte = 0x06 = ROUTING-WRITE function byte! ***"
echo The schema table dump that follows = the routing payload byte layout.
endlocal
