@echo off
REM Neon setup for Rajdanga Fabric. Run from the inventory folder:  neon-setup.cmd
cd /d "%~dp0"
echo [1/7] Installing the Neon CLI and signing in (a browser window opens)...
call npm i -g neon@latest || goto :fail
call neon login || goto :fail
echo [2/7] Neon skills...
if exist ".claude\skills\neon\SKILL.md" (
  echo     Neon skills already in .claude\skills - updating them
  call neon skills update -y
) else (
  call neon skills -s neon --agent claude-code -y || goto :fail
)
echo [3/7] Neon MCP...
if exist ".mcp.json" (
  echo     .mcp.json already has the Neon MCP server - left as it is
) else (
  call neon mcp --oauth --project --project-id hidden-meadow-96830760 --agent claude-code -y || goto :fail
)
echo [4/7] Linking project hidden-meadow-96830760 (production branch)...
call neon link --project-id hidden-meadow-96830760 --branch production -y || goto :fail
echo [5/7] neon config init...
call neon config init || goto :fail
echo [6/7] Writing neon.ts and hello.ts...
copy /Y neon-setup\neon.ts neon.ts >nul
copy /Y neon-setup\hello.ts hello.ts >nul
echo [7/7] Deploying...
call neon deploy || goto :fail
echo.
echo Done. Neon is set up and deployed.
goto :eof
:fail
echo.
echo A step failed. Scroll up for the message, fix it, then run neon-setup.cmd again.
exit /b 1
