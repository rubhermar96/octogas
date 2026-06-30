@echo off
REM Refresco diario de Octogas: descarga precios de MITECO y los ingesta en Postgres.
REM Pensado para el Programador de tareas de Windows hasta que despleguemos en el VPS.
REM Programar: Programador de tareas -> Crear tarea basica -> diaria -> Iniciar un
REM programa -> Programa: este .cmd  (deja "Iniciar en" con la carpeta del repo).

cd /d "%~dp0\.."
call npm run refresh >> "%~dp0\refresh.log" 2>&1
