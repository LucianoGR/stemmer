# Stemmer

Separa uma música em **voz, bateria, baixo e outros instrumentos** (stems), direto no seu computador,
e permite ouvir e misturar cada parte num player no navegador (mudo, solo e volume por stem).

Projeto pessoal e recreativo. Usa o [Demucs](https://github.com/facebookresearch/demucs) (Meta) para a separação,
rodando na CPU. Em um MacBook M1, uma música de 3 a 4 minutos leva cerca de 1 a 2 minutos.

Aceita mp3, wma, wav, flac, m4a, aac e ogg.

## Instalação

Você precisa de **Python 3.10 ou superior** e do **ffmpeg** (programa que lê os formatos de áudio).

**1. Instale o ffmpeg**
- Mac: `brew install ffmpeg`
- Windows: `winget install ffmpeg` (ou baixe em https://ffmpeg.org)

**2. Baixe o projeto e crie o ambiente isolado**

Mac:
```
git clone <endereço-do-repositório> stemmer
cd stemmer
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Windows:
```
git clone <endereço-do-repositório> stemmer
cd stemmer
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

A instalação baixa o PyTorch e leva alguns minutos. Na primeira separação, o Demucs baixa o modelo de IA
(algumas centenas de MB) e por isso precisa de internet. Depois funciona offline.

## Como usar

Inicie o programa:
- Mac: duplo clique em `iniciar.command` (na primeira vez: botão direito > Abrir), ou `.venv/bin/python app.py`
- Windows: duplo clique em `iniciar.bat`, ou `.venv\Scripts\python app.py`

> Use sempre o Python do `.venv`. O Python do sistema não tem as bibliotecas e dá o erro `No module named 'flask'`.

O navegador abre em http://127.0.0.1:5055. Então:

1. **Arraste uma música** para a área pontilhada (ou clique nela para escolher).
2. Em *Músicas enviadas*, clique em **Separar**. Uma música é processada por vez; as outras esperam na fila.
3. Ao terminar, ela passa para *Músicas processadas*. Clique em **Abrir** para ouvir.
4. No player: **Tocar/Pausar** controla todos os stems juntos e sincronizados;
   **Mudo** silencia um stem; **Solo** toca só aquele stem (um por vez); o controle deslizante ajusta o volume.

Para encerrar, volte ao terminal e pressione `Ctrl+C`.

## Onde ficam os arquivos

| Pasta | Conteúdo |
|---|---|
| `uploads/` | músicas enviadas pela página |
| `outputs/<música>/` | stems gerados em FLAC (`vocals`, `drums`, `bass`, `other`) |

Essas pastas (e `musics/`) não vão para o git. Para usar a separação sem a interface:
`.venv/bin/python separador.py "caminho/da/musica.mp3"`

## Estrutura do código

- `separador.py`: chama o Demucs e acompanha o progresso (não depende da interface)
- `app.py`: servidor web local (Flask), fila de processamento e rotas
- `templates/index.html`, `static/app.js`, `static/style.css`: a página e o player

## Observações

- O servidor só aceita conexões do próprio computador (`127.0.0.1`).
- Ao abrir uma música no player, os stems são carregados na memória do navegador (cerca de 300 MB).
- A separação é feita por IA e não é perfeita: é normal ouvir um pouco de "vazamento" entre os stems.
- Use apenas músicas que você tem direito de usar; o programa é para uso pessoal.
