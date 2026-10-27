@echo off
rem Lance le Senra Launcher en essai, avec la liste de mods locale (dossier distribution).
cd /d "%~dp0"
start "distribution locale" /min python -m http.server 8793 --directory distribution
set SENRA_DISTRO_URL=http://localhost:8793/distribution_dev.json
npx electron .
