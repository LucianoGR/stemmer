"""Servidor web local do Stemmer.

Rode com:  .venv/bin/python app.py
Ele abre a interface no navegador em http://127.0.0.1:5055
"""

import queue
import re
import shutil
import threading
import webbrowser

from flask import Flask, abort, jsonify, render_template, request, send_from_directory

import separador

PORTA = 5055  # evitamos a 5000: no Mac ela costuma estar ocupada pelo AirPlay

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024  # recusa uploads acima de 300 MB

separador.PASTA_UPLOADS.mkdir(exist_ok=True)
separador.PASTA_SAIDAS.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Fila de processamento
# ---------------------------------------------------------------------------
# O Demucs usa muita memória e todos os núcleos do processador. Por isso
# processamos UMA música por vez: os pedidos entram numa fila e um único
# "trabalhador" (thread) em segundo plano vai atendendo um a um.

fila = queue.Queue()
trabalhos = {}  # id_musica -> {"estado": "na_fila"|"processando"|"erro", "progresso": 0-100, "erro": str}
trava = threading.Lock()  # protege o dicionário, já que o trabalhador e o Flask o usam ao mesmo tempo


def trabalhador():
    while True:
        id_musica = fila.get()  # espera aqui até chegar algo
        arquivo = encontrar_upload(id_musica)
        if arquivo is None:  # a música foi excluída enquanto esperava na fila
            with trava:
                trabalhos.pop(id_musica, None)
            continue

        def atualizar(pct):
            with trava:
                trabalhos[id_musica]["progresso"] = pct

        with trava:
            trabalhos[id_musica].update(estado="processando", progresso=0)
        try:
            separador.separar(arquivo, id_musica, ao_progredir=atualizar)
            with trava:
                trabalhos.pop(id_musica, None)  # pronto: o estado passa a ser deduzido dos arquivos
        except Exception as e:
            with trava:
                trabalhos[id_musica] = {"estado": "erro", "progresso": 0, "erro": str(e)}


threading.Thread(target=trabalhador, daemon=True).start()

# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------


def encontrar_upload(id_musica):
    """Acha o arquivo original em uploads/ (a extensão pode variar)."""
    for p in separador.PASTA_UPLOADS.iterdir():
        if p.stem == id_musica and p.suffix.lower() in separador.FORMATOS_ACEITOS:
            return p
    return None


def limpar_nome(nome):
    """Troca caracteres perigosos por '_' (evita nomes que escapem da pasta)."""
    nome = re.sub(r"[^\w\-. ()]", "_", nome, flags=re.UNICODE).strip(" .")
    return nome or "musica"


def id_livre(base):
    """Se já existe uma música com esse nome, acrescenta ' (2)', ' (3)'..."""
    candidato, n = base, 2
    while encontrar_upload(candidato) is not None:
        candidato = f"{base} ({n})"
        n += 1
    return candidato


def descrever(arquivo, prontas):
    id_musica = arquivo.stem
    with trava:
        trabalho = dict(trabalhos.get(id_musica, {}))
    if trabalho:
        estado = trabalho["estado"]
    elif id_musica in prontas:
        estado = "pronta"
    else:
        estado = "enviada"
    return {
        "id": id_musica,
        "arquivo": arquivo.name,
        "estado": estado,
        "progresso": trabalho.get("progresso", 0),
        "erro": trabalho.get("erro"),
    }


# ---------------------------------------------------------------------------
# Rotas (os "endereços" que a página consulta)
# ---------------------------------------------------------------------------


@app.get("/")
def pagina_inicial():
    return render_template("index.html", stems=separador.STEMS)


@app.get("/api/musicas")
def listar():
    prontas = set(separador.listar_processadas())
    arquivos = [
        p for p in separador.PASTA_UPLOADS.iterdir()
        if p.suffix.lower() in separador.FORMATOS_ACEITOS
    ]
    arquivos.sort(key=lambda p: p.stat().st_mtime, reverse=True)  # mais recentes primeiro
    return jsonify([descrever(p, prontas) for p in arquivos])


@app.post("/api/upload")
def enviar():
    salvas, recusadas = [], []
    for f in request.files.getlist("arquivos"):
        nome = limpar_nome(f.filename or "")
        base, ponto, extensao = nome.rpartition(".")
        extensao = ("." + extensao.lower()) if ponto else ""
        if extensao not in separador.FORMATOS_ACEITOS:
            recusadas.append(f.filename)
            continue
        id_musica = id_livre(limpar_nome(base))
        f.save(separador.PASTA_UPLOADS / (id_musica + extensao))
        salvas.append(id_musica)
    return jsonify({"salvas": salvas, "recusadas": recusadas})


@app.post("/api/separar/<id_musica>")
def separar(id_musica):
    if encontrar_upload(id_musica) is None:
        abort(404)
    with trava:
        if trabalhos.get(id_musica, {}).get("estado") in ("na_fila", "processando"):
            return jsonify({"ok": True})  # já está a caminho; ignora clique duplo
        trabalhos[id_musica] = {"estado": "na_fila", "progresso": 0}
    fila.put(id_musica)
    return jsonify({"ok": True})


@app.delete("/api/musicas/<id_musica>")
def excluir(id_musica):
    with trava:
        if trabalhos.get(id_musica, {}).get("estado") == "processando":
            return jsonify({"erro": "Aguarde o fim do processamento."}), 409
        trabalhos.pop(id_musica, None)
    arquivo = encontrar_upload(id_musica)
    if arquivo:
        arquivo.unlink()
    shutil.rmtree(separador.PASTA_SAIDAS / id_musica, ignore_errors=True)
    return jsonify({"ok": True})


@app.get("/stems/<id_musica>/<stem>")
def baixar_stem(id_musica, stem):
    # Só servimos os 4 arquivos de stem de uma música que realmente exista.
    # (Sem essa checagem, id_musica=".." deixaria baixar arquivos do projeto.)
    if stem not in {f"{s}.flac" for s in separador.STEMS} or id_musica not in separador.listar_processadas():
        abort(404)
    # mimetype explícito: o Python declara FLAC como "audio/x-flac", nome que o Safari estranha.
    return send_from_directory(separador.PASTA_SAIDAS / id_musica, stem, mimetype="audio/flac")


if __name__ == "__main__":
    threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORTA}")).start()
    # 127.0.0.1 = só este computador acessa. Não use 0.0.0.0, senão a rede toda veria.
    app.run(host="127.0.0.1", port=PORTA, threaded=True)
