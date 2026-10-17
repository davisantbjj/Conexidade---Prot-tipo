"""Empacota as telas .dc.html em screens.js (permite abrir index.html direto do arquivo, sem servidor).
Uso: python build.py   (rode de novo sempre que editar algo em screens/)"""
import io, json, os

AQUI = os.path.dirname(os.path.abspath(__file__))
telas = {}
for f in sorted(os.listdir(os.path.join(AQUI, 'screens'))):
    if f.endswith('.dc.html'):
        telas[f] = io.open(os.path.join(AQUI, 'screens', f), encoding='utf-8').read()
assets = {os.path.splitext(f)[0]: f for f in os.listdir(os.path.join(AQUI, 'assets'))}

with io.open(os.path.join(AQUI, 'screens.js'), 'w', encoding='utf-8', newline='\n') as out:
    out.write('/* Gerado por build.py — não edite à mão. */\n')
    out.write('window.VB_ASSETS = %s;\n' % json.dumps(assets, ensure_ascii=False))
    out.write('window.VB_SCREENS = %s;\n' % json.dumps(telas, ensure_ascii=False).replace('</script', '<\\/script'))
print('screens.js: %d telas, %d imagens' % (len(telas), len(assets)))
