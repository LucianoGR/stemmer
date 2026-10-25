# Stemmer

Programa pessoal e recreativo para separar músicas em stems (voz, bateria, baixo, outros).

## Sobre o usuário
Programador hobbista, sem formação profissional. Quer entender os passos e o raciocínio.
Responder em português, linguagem simples, explicando o "porquê" das decisões e comentando o código.

## Decisões já tomadas
- Python + **Demucs** (modelo `htdemucs`, 4 stems), rodando na **CPU** (alvo: MacBook M1, 8 GB; até 5 min/música).
- Chamado como subprocesso (`python -m demucs`), progresso lido do stderr.
- Saída em **FLAC** em `outputs/<id_musica>/{vocals,drums,bass,other}.flac`.
- Interface: servidor **Flask** local, aberto numa **aba do navegador** (não pywebview).
- Mixer de vários stems feito no navegador (Web Audio API), sem reprocessar.
- Compatível com Windows: usar `pathlib` e `sys.executable`, sem caminhos ou comandos específicos de Mac.

## Estrutura
- `separador.py` — lógica de separação (independente da interface; testável pela linha de comando)
- `app.py` — servidor Flask (porta 5055), fila de 1 música por vez, rotas /api/* e /stems/*
- `templates/index.html`, `static/app.js`, `static/style.css` — interface
- `musics/` — músicas de teste do usuário (não mexer)
- `uploads/` — músicas enviadas pelo programa
- `outputs/` — stems gerados
- `.venv/` — ambiente Python (Python 3.13); `ffmpeg` instalado via Homebrew

## Comandos
- Testar separação: `.venv/bin/python separador.py "musics/05 - My Way.mp3"`
- Rodar o programa: `.venv/bin/python app.py` (ou duplo clique em `iniciar.command`). NUNCA com `python3` do sistema: não tem Flask/Demucs (erro já ocorrido).

## Medições
- ~75 s para 3 min de música (Royals); ~110 s para My Way. Primeira execução baixa o modelo.

## Progresso
- [x] Etapa 1: `separador.py`
- [x] Etapa 2: interface web (upload arrastar/soltar, fila, progresso, lista de processadas)
- [x] Etapa 3: mixer Web Audio (play/pausa sincronizado, mudo, solo, volume, barra de posição) — testado no Edge headless; falta o usuário testar no navegador dele

## Notas
- `.gitignore` ignora .venv, uploads, outputs e musics (direitos autorais). Usuário quer subir ao git depois de testar a interface.
- Rota `/stems` valida id e nome do stem (evita path traversal com id `..`).
- Etapa 2 usa `<audio>` simples por stem; a Etapa 3 trocou por mixer Web Audio (stems decodificados em memória, ~300 MB; só um mixer aberto por vez).
