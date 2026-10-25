// Lógica da página: envia músicas, pede a separação, mostra o andamento e toca os stems.
// A página "pergunta" ao servidor o estado das músicas a cada segundo (polling).

const NOMES = { vocals: "Voz", drums: "Bateria", bass: "Baixo", other: "Outros" };

const zona = document.getElementById("zona");
const entrada = document.getElementById("entrada");
const aviso = document.getElementById("aviso");
const listaEnviadas = document.getElementById("enviadas");
const listaProcessadas = document.getElementById("processadas");

let aberta = null; // id da música processada com o mixer visível (só uma por vez, para poupar memória)
let mixerAtual = null; // o mixer em uso, para podermos desligá-lo ao fechar

// ---------- envio de arquivos ----------

async function enviar(arquivos) {
  if (!arquivos.length) return;
  const dados = new FormData();
  for (const f of arquivos) dados.append("arquivos", f);
  aviso.textContent = `Enviando ${arquivos.length} arquivo(s)...`;
  try {
    const r = await fetch("/api/upload", { method: "POST", body: dados });
    if (!r.ok) throw new Error(r.status === 413 ? "arquivo grande demais (máx. 300 MB)" : "erro " + r.status);
    const res = await r.json();
    aviso.textContent = res.recusadas.length ? `Formato não aceito: ${res.recusadas.join(", ")}` : "";
  } catch (e) {
    aviso.textContent = "Falha no envio: " + e.message;
  }
  atualizar();
}

entrada.addEventListener("change", () => { enviar([...entrada.files]); entrada.value = ""; });
for (const ev of ["dragenter", "dragover"])
  zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add("sobre"); });
for (const ev of ["dragleave", "drop"])
  zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove("sobre"); });
zona.addEventListener("drop", (e) => enviar([...e.dataTransfer.files]));
// Se o usuário soltar o arquivo fora da zona, o navegador abriria o áudio; evitamos isso.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// ---------- ações ----------

async function chamar(url, metodo) {
  const r = await fetch(url, { method: metodo });
  if (!r.ok) { const j = await r.json().catch(() => ({})); aviso.textContent = j.erro || "Erro " + r.status; }
  atualizar();
}
const separar = (id) => chamar("/api/separar/" + encodeURIComponent(id), "POST");
const excluir = (id) => {
  if (!confirm(`Excluir "${id}" e seus stems?`)) return;
  if (aberta === id) aberta = null;
  chamar("/api/musicas/" + encodeURIComponent(id), "DELETE");
};

// ---------- utilidades de desenho ----------

function el(tag, props = {}, ...filhos) {
  const e = Object.assign(document.createElement(tag), props); // textContent evita injeção de HTML
  e.append(...filhos);
  return e;
}
const botao = (texto, aoClicar, classe = "") => el("button", { textContent: texto, className: classe, onclick: aoClicar });
const tempo = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- o mixer ----------
// Por que Web Audio e não vários <audio>? Cada <audio> começa no seu próprio ritmo e,
// com o tempo, os stems se desalinham. Aqui decodificamos os 4 arquivos para a memória
// e mandamos todos começarem no MESMO instante do relógio de áudio: sincronia exata.

function criarMixer(id) {
  const ctx = new AudioContext(); // criado dentro do clique do usuário (exigência dos navegadores)
  const buffers = {};
  const ganhos = {};
  const estado = {}; // por stem: { mudo, solo, volume }
  for (const s of STEMS) estado[s] = { mudo: false, solo: false, volume: 1 };

  let duracao = 0, deslocamento = 0, inicio = 0, tocando = false;
  let fontes = [], quadro = 0, arrastando = false, morto = false;

  const posicao = () => (tocando ? Math.min(deslocamento + ctx.currentTime - inicio, duracao) : deslocamento);

  // Volume efetivo: se algum stem está em "solo", só os solos soam; senão vale o "mudo".
  function aplicarGanhos() {
    const haSolo = STEMS.some((s) => estado[s].solo);
    for (const s of STEMS) {
      const e = estado[s];
      const audivel = haSolo ? e.solo : !e.mudo;
      ganhos[s].gain.setTargetAtTime(audivel ? e.volume : 0, ctx.currentTime, 0.01); // 0.01 s evita estalos
    }
  }

  function tocar() {
    if (tocando || !duracao) return;
    ctx.resume();
    if (deslocamento >= duracao - 0.05) deslocamento = 0;
    const t0 = ctx.currentTime + 0.05; // pequena margem para todos começarem juntos
    fontes = STEMS.map((s) => {
      const f = ctx.createBufferSource(); // cada fonte só pode ser iniciada uma vez; criamos novas a cada play
      f.buffer = buffers[s];
      f.connect(ganhos[s]);
      f.start(t0, deslocamento);
      return f;
    });
    inicio = t0;
    tocando = true;
    fontes[0].onended = () => { if (tocando && posicao() >= duracao - 0.1) { parar(0); } };
    ui.play.textContent = "⏸ Pausar";
  }

  function parar(novoDeslocamento) {
    for (const f of fontes) { f.onended = null; try { f.stop(); } catch {} }
    fontes = [];
    deslocamento = novoDeslocamento ?? posicao();
    tocando = false;
    ui.play.textContent = "▶ Tocar";
  }

  function irPara(segundos) {
    const estavaTocando = tocando;
    parar(segundos);
    if (estavaTocando) tocar();
  }

  // ----- interface do mixer -----
  const ui = {};
  ui.status = el("p", { className: "estado", textContent: "Carregando stems..." });
  ui.play = botao("▶ Tocar", () => (tocando ? parar() : tocar()), "principal");
  ui.play.disabled = true;
  ui.barra = el("input", { type: "range", min: 0, max: 1, step: 0.1, value: 0, disabled: true });
  ui.barra.setAttribute("aria-label", "Posição na música");
  ui.tempo = el("span", { className: "estado", textContent: "0:00 / 0:00" });
  ui.barra.addEventListener("input", () => { arrastando = true; ui.tempo.textContent = `${tempo(+ui.barra.value)} / ${tempo(duracao)}`; });
  ui.barra.addEventListener("change", () => { arrastando = false; irPara(+ui.barra.value); });

  const transporte = el("div", { className: "linha transporte" }, ui.play, ui.barra, ui.tempo);
  const canais = el("div", { className: "canais" });
  const botoesSolo = {}; // para o solo de um stem poder desligar o dos outros

  for (const s of STEMS) {
    const botMudo = botao("Mudo", () => {
      estado[s].mudo = !estado[s].mudo;
      botMudo.setAttribute("aria-pressed", estado[s].mudo);
      aplicarGanhos();
    });
    const botSolo = botao("Solo", () => {
      const ligar = !estado[s].solo;
      // Solo exclusivo: ao ligar um, desligamos o dos outros stems.
      for (const outro of STEMS) {
        estado[outro].solo = ligar && outro === s;
        botoesSolo[outro].setAttribute("aria-pressed", estado[outro].solo);
      }
      aplicarGanhos();
    });
    botoesSolo[s] = botSolo;
    botMudo.setAttribute("aria-pressed", "false");
    botSolo.setAttribute("aria-pressed", "false");
    const vol = el("input", { type: "range", min: 0, max: 1, step: 0.01, value: 1 });
    vol.setAttribute("aria-label", "Volume de " + (NOMES[s] || s));
    vol.addEventListener("input", () => { estado[s].volume = +vol.value; aplicarGanhos(); });
    canais.append(el("div", { className: "canal" }, el("span", { className: "rotulo", textContent: NOMES[s] || s }), botMudo, botSolo, vol));
  }

  const elemento = el("div", { className: "mixer" }, ui.status, transporte, canais);

  // ----- carregamento dos arquivos -----
  (async () => {
    try {
      await Promise.all(STEMS.map(async (s) => {
        const r = await fetch(`/stems/${encodeURIComponent(id)}/${s}.flac`);
        if (!r.ok) throw new Error(`${s}: erro ${r.status}`);
        buffers[s] = await ctx.decodeAudioData(await r.arrayBuffer());
        ganhos[s] = ctx.createGain();
        ganhos[s].connect(ctx.destination);
      }));
      if (morto) return;
      duracao = Math.min(...STEMS.map((s) => buffers[s].duration));
      ui.barra.max = duracao;
      ui.barra.disabled = false;
      ui.play.disabled = false;
      ui.status.remove();
      atualizarTempo();
    } catch (e) {
      ui.status.className = "estado erro";
      ui.status.textContent = "Não foi possível carregar os stems: " + e.message;
    }
  })();

  function atualizarTempo() {
    if (morto) return;
    if (!arrastando) {
      ui.barra.value = posicao();
      ui.tempo.textContent = `${tempo(posicao())} / ${tempo(duracao)}`;
    }
    quadro = requestAnimationFrame(atualizarTempo);
  }

  // Libera a memória (os buffers decodificados ocupam centenas de MB).
  function destruir() {
    morto = true;
    cancelAnimationFrame(quadro);
    parar(0);
    ctx.close();
  }

  return { elemento, destruir };
}

// ---------- desenho das listas ----------

function itemEnviada(m) {
  const linha = el("div", { className: "linha" }, el("span", { className: "nome", textContent: m.id }));
  const li = el("li", { className: "item" }, linha);

  if (m.estado === "enviada" || m.estado === "erro") {
    if (m.estado === "erro") linha.append(el("span", { className: "estado erro", textContent: "Falhou", title: m.erro }));
    linha.append(botao(m.estado === "erro" ? "Tentar de novo" : "Separar", () => separar(m.id), "principal"));
  } else if (m.estado === "na_fila") {
    linha.append(el("span", { className: "estado", textContent: "Na fila..." }));
  } else if (m.estado === "processando") {
    linha.append(el("span", { className: "estado", textContent: `Separando... ${m.progresso}%` }));
    li.append(el("progress", { max: 100, value: m.progresso }));
  }
  if (m.estado !== "processando") linha.append(botao("Excluir", () => excluir(m.id), "perigo"));
  if (m.estado === "erro" && m.erro) li.append(el("pre", { className: "estado erro", textContent: m.erro }));
  return li;
}

function itemProcessada(m) {
  const estaAberta = aberta === m.id;
  const linha = el("div", { className: "linha" },
    el("span", { className: "nome", textContent: m.id }),
    botao(estaAberta ? "Fechar" : "Abrir", () => { aberta = estaAberta ? null : m.id; atualizar(true); }, "principal"),
    botao("Excluir", () => excluir(m.id), "perigo"));
  const li = el("li", { className: "item" }, linha);
  if (estaAberta) {
    mixerAtual = criarMixer(m.id);
    li.append(mixerAtual.elemento);
  }
  return li;
}

// Cada lista só é redesenhada quando o SEU conteúdo muda. Assim, o progresso de uma música
// em processamento não derruba o mixer que está tocando na lista de baixo.
const assinaturas = { enviadas: "", processadas: "" };

function redesenhar(lista, chave, assinatura, itens, forcar) {
  if (!forcar && assinaturas[chave] === assinatura) return;
  assinaturas[chave] = assinatura;
  lista.replaceChildren(...itens());
}

function desenhar(musicas, forcar) {
  const enviadas = musicas.filter((m) => m.estado !== "pronta");
  const prontas = musicas.filter((m) => m.estado === "pronta");
  redesenhar(listaEnviadas, "enviadas", JSON.stringify(enviadas), () => enviadas.map(itemEnviada), forcar);

  const sigProntas = JSON.stringify(prontas) + aberta;
  if (forcar || assinaturas.processadas !== sigProntas) {
    if (mixerAtual) { mixerAtual.destruir(); mixerAtual = null; } // desliga o mixer antigo antes de refazer
    redesenhar(listaProcessadas, "processadas", sigProntas, () => prontas.map(itemProcessada), true);
  }
}

async function atualizar(forcar = false) {
  try {
    desenhar(await (await fetch("/api/musicas")).json(), forcar);
  } catch { /* servidor fora do ar: tenta de novo no próximo ciclo */ }
}

atualizar();
setInterval(atualizar, 1000);
