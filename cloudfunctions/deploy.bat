@echo off
REM cloudfunctions\deploy.bat - deploy all cloud functions (Windows cmd version)
REM
REM Usage (run from territory-king\ root):
REM   cloudfunctions\deploy.bat
REM     no args: deploy all 6 functions
REM   cloudfunctions\deploy.bat settle
REM     with arg: deploy only the named function (e.g. settle)
REM
REM Key: copy shared\ into each function dir first (TCB packages only the
REM function's own dir), then tcb fn deploy. Requires @cloudbase/cli logged in.
REM
REM IMPORTANT: tcb fn deploy MUST run from territory-king\ root (where
REM cloudbaserc.json lives). Do NOT cd into cloudfunctions\ before tcb.
setlocal enabledelayedexpansion

REM Resolve to territory-king\ root (this file lives in cloudfunctions\)
set "ROOT=%~dp0.."
for %%i in ("%ROOT%") do set "ROOT=%%~fi"
cd /d "%ROOT%"

set "CF=%ROOT%cloudfunctions"

echo [1/2] sync shared\ into each function dir...

REM game-side functions (openid auth, no password/token needed)
for %%f in (login getProfile putProfile settle) do (
  if not exist "%CF%\%%f\shared" mkdir "%CF%\%%f\shared"
  copy /y "%CF%\shared\LadderSystem.js" "%CF%\%%f\shared\" >nul
  copy /y "%CF%\shared\db.js" "%CF%\%%f\shared\" >nul
  copy /y "%CF%\shared\settle-core.js" "%CF%\%%f\shared\" >nul
)

REM admin-side functions (scrypt + JWT auth, need password/token)
for %%f in (adminLogin adminRouter) do (
  if not exist "%CF%\%%f\shared" mkdir "%CF%\%%f\shared"
  copy /y "%CF%\shared\LadderSystem.js" "%CF%\%%f\shared\" >nul
  copy /y "%CF%\shared\db.js" "%CF%\%%f\shared\" >nul
  copy /y "%CF%\shared\settle-core.js" "%CF%\%%f\shared\" >nul
  copy /y "%CF%\shared\password.js" "%CF%\%%f\shared\" >nul
  copy /y "%CF%\shared\token.js" "%CF%\%%f\shared\" >nul
)
echo     shared sync done

echo [2/2] deploy cloud functions (from %ROOT%)...

if not "%~1"=="" (
  echo     deploy function: %~1
  call tcb fn deploy "%~1" --force
) else (
  for %%f in (login getProfile putProfile settle adminLogin adminRouter initCollections) do (
    echo     deploy function: %%f
    call tcb fn deploy "%%f" --force
  )
)

echo.
echo all done
endlocal
