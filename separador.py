"""Separa uma música em stems (voz, bateria, baixo, outros) usando o Demucs.

Este módulo não sabe nada sobre a interface web. Ele só recebe um arquivo de
áudio e produz uma pasta com os stems. Assim dá para testá-lo sozinho:

    .venv/bin/python separador.py "musics/05 - My Way.mp3"
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

# Pastas do projeto, sempre relativas a este arquivo (funciona em Mac e Windows).
RAIZ = Path(__file__).resolve().parent
PASTA_UPLOADS = RAIZ / "uploads"
PASTA_SAIDAS = RAIZ / "outputs"

MODELO = "htdemucs"  # 4 stems. Para 6 stems (guitarra/piano) seria "htdemucs_6s".
STEMS = ["vocals", "drums", "bass", "other"]
FORMATOS_ACEITOS = {".mp3", ".wma", ".wav", ".flac", ".m4a", ".aac", ".ogg"}

# O Demucs imprime uma barra de progresso como "  42%|████..." no stderr.
_REGEX_PERCENTUAL = re.compile(r"(\d{1,3})%\|")


def separar(arquivo, id_musica, ao_progredir=None):
    """Separa `arquivo` em stems e salva em outputs/<id_musica>/.

    ao_progredir: função opcional chamada com um número de 0 a 100.
    Devolve a pasta com os stems. Levanta RuntimeError se o Demucs falhar.
    """
    arquivo = Path(arquivo)
    if arquivo.suffix.lower() not in FORMATOS_ACEITOS:
        raise ValueError(f"Formato não suportado: {arquivo.suffix}")

    destino = PASTA_SAIDAS / id_musica
    # O Demucs escreve numa pasta temporária; só movemos para o destino final
    # se terminar bem. Assim nunca sobra uma música "meio processada".
    temporaria = PASTA_SAIDAS / f".tmp_{id_musica}"
    shutil.rmtree(temporaria, ignore_errors=True)

    comando = [
        sys.executable, "-m", "demucs",  # usa o mesmo Python (e o mesmo venv) que nos chamou
        "-n", MODELO,
        "-d", "cpu",
        "--flac",                        # FLAC: sem perda de qualidade, metade do tamanho do WAV
        "--filename", "{stem}.{ext}",    # arquivos saem como vocals.flac, drums.flac...
        "-o", str(temporaria),
        str(arquivo),
    ]

    processo = subprocess.Popen(
        comando,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
    )

    # A barra de progresso se redesenha com "\r" (sem pular linha), então
    # lemos o stderr caractere a caractere e tratamos "\r" e "\n" como fim de trecho.
    trecho = ""
    ultimas_linhas = []  # guardadas só para mostrar se der erro
    ultimo_percentual = -1
    while True:
        c = processo.stderr.read(1)
        if c == "":
            break
        if c not in "\r\n":
            trecho += c
            continue
        achou = _REGEX_PERCENTUAL.search(trecho)
        if achou:
            pct = min(int(achou.group(1)), 100)
            if pct != ultimo_percentual and ao_progredir:
                ao_progredir(pct)
            ultimo_percentual = pct
        elif trecho.strip():
            ultimas_linhas.append(trecho.strip())
        trecho = ""

    if processo.wait() != 0:
        shutil.rmtree(temporaria, ignore_errors=True)
        detalhe = "\n".join(ultimas_linhas[-5:])
        raise RuntimeError(f"O Demucs falhou:\n{detalhe}")

    # Estrutura criada pelo Demucs: <temporaria>/<modelo>/<stems>
    pasta_stems = temporaria / MODELO
    faltando = [s for s in STEMS if not (pasta_stems / f"{s}.flac").exists()]
    if faltando:
        shutil.rmtree(temporaria, ignore_errors=True)
        raise RuntimeError(f"Stems não gerados: {faltando}")

    shutil.rmtree(destino, ignore_errors=True)
    shutil.move(str(pasta_stems), str(destino))
    shutil.rmtree(temporaria, ignore_errors=True)

    if ao_progredir:
        ao_progredir(100)
    return destino


def listar_processadas():
    """Ids das músicas que já têm todos os stems prontos."""
    if not PASTA_SAIDAS.exists():
        return []
    return sorted(
        p.name for p in PASTA_SAIDAS.iterdir()
        if p.is_dir() and not p.name.startswith(".")
        and all((p / f"{s}.flac").exists() for s in STEMS)
    )


if __name__ == "__main__":
    # Modo de teste pela linha de comando.
    if len(sys.argv) != 2:
        sys.exit('Uso: python separador.py "caminho/da/musica.mp3"')
    entrada = Path(sys.argv[1])
    resultado = separar(
        entrada, entrada.stem,
        ao_progredir=lambda p: print(f"\rProgresso: {p}%", end="", flush=True),
    )
    print(f"\nPronto! Stems em: {resultado}")
