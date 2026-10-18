@echo off
rem Abre o protótipo Conexidade com mapa real (precisa de Python e internet).
cd /d "%~dp0"
python build.py
start "" http://127.0.0.1:5173/index.html
python -m http.server 5173 --bind 127.0.0.1
