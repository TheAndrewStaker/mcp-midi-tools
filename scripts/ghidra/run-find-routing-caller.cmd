@echo off
REM Find AxeEdit's routing-write builder by walking back from envelope-builder
REM call sites and matching ones where immediate 0x06 (the routing function
REM byte) was loaded in the preceding ~20 instructions.
REM
REM Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-routing-caller.txt

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
    -postScript FindRoutingCaller.java

if errorlevel 1 (
    echo Ghidra headless exited with errors. See output above.
    exit /b 1
)

echo.
echo Done. Output:
echo   %OUT_DIR%\ghidra-routing-caller.txt
echo.
echo Look for "MATCH:" lines listing functions that load 0x06 then call
echo an envelope-builder. Functions marked "*** ALSO has 0x07 in window ***"
echo are highest-confidence routing builders (Axe-Fx II model byte present).
endlocal
