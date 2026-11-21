/* Esta pagina nao roda dentro da pagina de ninguem. Emoldurada, um site de
   fora poria um botao falso por cima e faria o dono clicar no de baixo sem
   ver. O GitHub Pages nao deixa mandar o cabecalho que proibe isso, entao a
   recusa e' aqui. */
if (window.top !== window.self) {
  document.documentElement.innerHTML = "";
  throw new Error("o Painel CYRON nao abre dentro de outra pagina");
}

const BOT = "https://top-best-discord-bot.fly.dev";
const FUNCAO = "https://mslzcjqkfeivuavfxwli.supabase.co/functions/v1/cyron-entrar";
const CLIENT_ID = "1498142929041096856";
/* O Discord devolve o login para esta própria página (sem a query). É este
   endereço que precisa estar cadastrado em OAuth2 -> Redirects do app. */
const VOLTA = (location.origin + location.pathname).replace(/index\.html$/, "");
/* Sem o ao vivo (conexão caiu, rede bloqueia WebSocket), a página volta a
   perguntar de tempos em tempos -- devagar, porque é só a rede de segurança. */
const POLL_MS = 4000;
const AO_VIVO = BOT.replace(/^http/, "ws") + "/visao/ao-vivo";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* localStorage, e NAO sessionStorage. No celular o login vai para o discord.com
   e volta num contexto novo (aba/Custom Tab reaberta, ou o PWA reabrindo): o
   sessionStorage daquela ida nao sobrevive, entao o estado do OAuth sumia e a
   pagina mandava entrar de novo em loop. localStorage sobrevive ao pulo e ainda
   mantem o dono logado quando reabre o app. O token aqui so' le o perfil (quem
   e' voce); o token do bot nunca passa por aqui. */
const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* modo privado */ } };
const ler = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };

let token = ler("cyron-visao-token");
const E = { servidores: [], g: "", canais: [], c: "", canal: null, msgs: [], timer: null, carregando: false, modo: "servidor", leituras: {} };
const V = { ws: null, pronto: false, espera: 2000, desistiu: false };

/* ---------------- entrar e sair ---------------- */

function sortear() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
}
function entrar() {
  const estado = sortear();
  guardar("cyron-estado", estado);
  if (ler("cyron-estado") !== estado) return alert("Seu navegador está bloqueando o armazenamento da aba. Saia do modo privado.");
  location.href = "https://discord.com/oauth2/authorize?client_id=" + CLIENT_ID +
    "&response_type=code&scope=identify&state=" + estado + "&redirect_uri=" + encodeURIComponent(VOLTA);
}
function telaEntrar(texto) {
  $("entrar").hidden = false;
  if (texto) $("entrar-txt").textContent = texto;
}
async function sair() {
  const t = token;
  token = ""; guardar("cyron-visao-token", null);
  pararPoll();
  /* Dois avisos, e os dois valem sozinhos: o bot esquece o login na hora (ele
     lembra por alguns minutos para nao perguntar ao Discord a cada pedido), e
     o Discord cancela o login de vez. */
  if (t) await fetch(BOT + "/visao/sair", { method: "POST", headers: { Authorization: "Bearer " + t } }).catch(() => {});
  if (t) await fetch(FUNCAO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revogar: t }) }).catch(() => {});
  location.replace(location.pathname);
}

/* ---------------- o bot ---------------- */

async function api(caminho, opc = {}) {
  const r = await fetch(BOT + caminho, Object.assign({}, opc, {
    headers: Object.assign({ Authorization: "Bearer " + token }, opc.body ? { "Content-Type": "application/json" } : {}),
  }));
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { token = ""; guardar("cyron-visao-token", null); telaEntrar("Seu login expirou. Entre de novo."); throw new Error("login"); }
  if (r.status === 403 && caminho === "/visao/eu") { telaEntrar("Esta conta do Discord não é dona da CYRON. Entre com a conta que opera o bot."); throw new Error("dono"); }
  if (!r.ok) throw new Error(j.erro || ("erro " + r.status));
  return j;
}

/* ---------------- texto do Discord ---------------- */

/* Tudo o que esta tela desenha de uma mensagem foi escrito por um estranho:
   qualquer um instala a CYRON no proprio servidor, ou manda DM pra ela, e o
   texto dele aparece aqui -- na pagina que guarda o SEU login. Tres regras:

   1. Endereco de fora so' entra em href/src se for http(s) (urlSegura).
   2. Pedaco de HTML ja' montado vai para o cofre e deixa so' uma marca no
      texto. As regras seguintes nao enxergam o que esta no cofre, entao
      nenhuma consegue mexer DENTRO de uma tag pronta.
   3. O que vai dentro de um atributo nunca contem marca do cofre.

   A regra 2 nasceu de um furo de verdade: o texto
       [x](https://a/(https://b/onmouseover=...//)
   virava um link, e a regra seguinte ("endereco solto vira link") achava o
   segundo endereco DENTRO do href do primeiro e punha outra tag ali. A aspa
   dela fechava o href, e o resto do endereco virava atributo: onmouseover,
   com codigo de quem escreveu a mensagem. */

const urlSegura = (u) => (/^https?:\/\/\S+$/i.test(String(u == null ? "" : u)) ? esc(u) : "");
const corSegura = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c == null ? "" : c)) ? String(c) : "");

/* As marcas do cofre: dois caracteres de uso privado, que eu tiro do texto
   antes de comecar. Depois disso, toda marca que existe fui eu que pus. */
const MARCA_DO_COFRE = /[]/g;

function fmt(texto, nomes) {
  nomes = nomes || {};
  const nu = nomes.u || {}, nc = nomes.c || {}, nr = nomes.r || {};
  const cofre = [];
  const guardarHtml = (html) => "" + (cofre.push(html) - 1) + "";
  const men = (dentro) => guardarHtml('<span class="men">' + dentro + "</span>");
  const link = (url, dentro) => guardarHtml('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + dentro + "</a>");
  /* So' tags sem atributo: nao ha' o que quebrar nelas. */
  const marcas = (t) => t
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<u>$1</u>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");

  let s = esc(String(texto == null ? "" : texto).replace(MARCA_DO_COFRE, ""));
  s = s.replace(/```(?:[a-z]+\n)?([\s\S]*?)```/g, (m, c) => guardarHtml("<pre>" + c + "</pre>"));
  s = s.replace(/`([^`\n]+)`/g, (m, c) => guardarHtml("<code>" + c + "</code>"));
  s = s.replace(/&lt;@!?(\d+)&gt;/g, (m, id) => men("@" + esc(nu[id] || "usuário")));
  s = s.replace(/&lt;@&amp;(\d+)&gt;/g, (m, id) => men("@" + esc(nr[id] || "cargo")));
  s = s.replace(/&lt;#(\d+)&gt;/g, (m, id) => men("#" + esc(nc[id] || canalPeloId(id) || "canal")));
  s = s.replace(/&lt;(a?):(\w{2,32}):(\d{15,25})&gt;/g, (m, a, n, id) => guardarHtml(
    '<img class="emo" alt=":' + n + ':" title=":' + n + ':" src="https://cdn.discordapp.com/emojis/' + id + "." + (a ? "gif" : "png") + '?size=48">'));
  /* Os enderecos param em espaco, em "<" e em marca do cofre (regra 3). */
  s = s.replace(/\[([^\]\n]+)\]\(&lt;(https?:\/\/[^\s)]+?)&gt;\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (m, t1, u1, t2, u2) => link(u1 || u2, marcas(t1 || t2)));
  s = s.replace(/&lt;(https?:\/\/[^\s<]+?)&gt;/g, (m, url) => link(url, url));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, antes, url) => antes + link(url, url));
  s = s.replace(/@everyone|@here/g, (m) => men(m));
  s = marcas(s);
  s = s.replace(/^-# (.*)$/gm, "<small>$1</small>");
  s = s.replace(/^&gt; (.*)$/gm, "<q>$1</q>");
  /* Cofre dentro de cofre (um codigo dentro do texto de um link): abre ate'
     nao sobrar marca. O que sobrar depois disso some. */
  for (let i = 0; i < 4 && s.indexOf("") >= 0; i++) s = s.replace(/(\d+)/g, (m, k) => cofre[+k] || "");
  return s.replace(MARCA_DO_COFRE, "");
}
const soEmoji = (t) => !!t && /^(\s|<a?:\w{2,32}:\d{15,25}>|\p{Extended_Pictographic}|‍|️)+$/u.test(t);
const canalPeloId = (id) => (E.canais.find((c) => c.id === id) || {}).nome || "";

function hora(ms) {
  const d = new Date(ms), hoje = new Date();
  const hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return "Hoje às " + hh;
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "Ontem às " + hh;
  return d.toLocaleDateString("pt-BR") + " " + hh;
}

function htmlCartao(c) {
  const corOk = corSegura(c.cor), url = urlSegura(c.url), imagem = urlSegura(c.imagem), miniatura = urlSegura(c.miniatura);
  const cor = corOk ? ' style="border-left-color:' + corOk + '"' : "";
  const titulo = c.titulo ? (url ? '<a class="ct" href="' + url + '" target="_blank" rel="noopener noreferrer">' + fmt(c.titulo) + "</a>" : '<div class="ct">' + fmt(c.titulo) + "</div>") : "";
  return '<div class="card"' + cor + '><div class="e">' +
    (c.autor ? '<div class="ca">' + esc(c.autor) + "</div>" : "") + titulo +
    (c.texto ? '<div class="txt">' + fmt(c.texto) + "</div>" : "") +
    (c.campos || []).map((f) => '<div class="cf"><b>' + fmt(f.nome) + '</b><div class="txt">' + fmt(f.valor) + "</div></div>").join("") +
    (imagem ? '<a href="' + imagem + '" target="_blank" rel="noopener noreferrer"><img class="img" loading="lazy" src="' + imagem + '" alt=""></a>' : "") +
    (c.rodape ? '<div class="cr">' + esc(c.rodape) + "</div>" : "") +
    "</div>" + (miniatura ? '<img class="mini" loading="lazy" src="' + miniatura + '" alt="">' : "") + "</div>";
}

function htmlAnexo(a) {
  const u = urlSegura(a.url);
  if (!u) return "";
  if (/^image\//.test(a.tipo)) return '<a href="' + u + '" target="_blank" rel="noopener noreferrer"><img class="anexo" loading="lazy" src="' + u + '" alt="' + esc(a.nome) + '"></a>';
  if (/^video\//.test(a.tipo)) return '<video class="anexo" controls preload="metadata" src="' + u + '"></video>';
  if (/^audio\//.test(a.tipo)) return '<audio controls preload="none" src="' + u + '"></audio>';
  return '<a class="arq" href="' + u + '" target="_blank" rel="noopener noreferrer">📎 ' + esc(a.nome) + "</a>";
}

/* A linha curta de "respondendo a": sem marcação crua. A cópia do espelho não
   tem texto -- a frase dela mora no cartão. */
function previa(m) {
  const base = m.texto || (m.cartoes[0] ? m.cartoes[0].texto.split("\n")[0] : "") || (m.anexos.length || m.figurinhas.length ? "[anexo]" : "");
  return base.replace(/<@!?(\d+)>/g, (x, id) => "@" + ((m.nomes.u || {})[id] || "usuário"))
    .replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_~`]/g, "").slice(0, 80);
}

function htmlMensagem(m, anterior) {
  const cabeca = !anterior || anterior.autor.id !== m.autor.id || anterior.autor.nome !== m.autor.nome ||
    m.quando - anterior.quando > 5 * 60 * 1000 || m.responde;
  const resp = m.responde ? E.msgs.find((x) => x.id === m.responde) : null;
  const avatar = urlSegura(m.autor.avatar);
  return '<div class="msg' + (cabeca ? " cabeca" : "") + '" data-id="' + esc(m.id) + '">' +
    '<div class="av">' + (avatar ? '<img loading="lazy" src="' + avatar + '" alt="">' : "") + "</div>" +
    '<div class="corpo">' +
    (m.responde ? '<div class="resp">↪ ' + (resp ? esc(resp.autor.nome) + ": " + esc(previa(resp)) : "respondendo a uma mensagem") + "</div>" : "") +
    (cabeca ? '<div class="lin1"><b>' + esc(m.autor.nome) + "</b>" + (m.autor.bot || m.autor.webhook ? '<span class="selo">' + (m.autor.webhook ? "APP" : "BOT") + "</span>" : "") +
      '<span class="hora">' + hora(m.quando) + "</span></div>" : "") +
    (m.texto ? '<div class="txt' + (soEmoji(m.texto) ? " so-emoji" : "") + '">' + fmt(m.texto, m.nomes) + (m.editada ? ' <small class="hora">(editada)</small>' : "") + "</div>" : "") +
    (m.anexos || []).map(htmlAnexo).join("") +
    htmlLerCalendario(m) +
    (m.figurinhas || []).filter((f) => urlSegura(f.url) && !/\.json(\?|$)/.test(f.url)).map((f) => '<img class="fig" loading="lazy" src="' + urlSegura(f.url) + '" alt="' + esc(f.nome) + '" title="' + esc(f.nome) + '">').join("") +
    (m.cartoes || []).map(htmlCartao).join("") +
    "</div></div>";
}

/* "Ler calendário": a mensagem com print do calendário do jogo ganha o botão;
   a CYRON lê os prints (o motor no bot) e a leitura aparece embaixo, como um
   cartão. Fica guardada em E.leituras: o canal é redesenhado a cada poucos
   segundos, e a leitura não pode sumir no meio. O dono não é ADM no TOP, e o
   comando de Apps do Discord só aparece para ADM -- por isso o app. */
function htmlLerCalendario(m) {
  /* Só com id de verdade do Discord (só números): o id vai para um atributo,
     e o botão é a única tag de botão que esta tela desenha numa mensagem. */
  if (!/^\d{15,25}$/.test(String(m.id || "")) || !(m.anexos || []).some((a) => /^image\//.test(a.tipo))) return "";
  const leitura = (E.leituras || {})[m.id];
  const rotulo = leitura === "lendo" ? "📅 Lendo os prints…" : leitura ? "📅 Ler de novo" : "📅 Ler calendário";
  return '<button class="ler-cal" data-ler="' + esc(m.id) + '"' + (leitura === "lendo" ? " disabled" : "") + ">" + rotulo + "</button>" +
    (leitura && leitura !== "lendo" ? (leitura.erro ? '<div class="erro">' + esc(leitura.erro) + "</div>"
      : htmlCartao({ titulo: leitura.titulo, texto: leitura.corpo, rodape: leitura.rodape, cor: "#c8962e" })) : "");
}

async function lerCalendario(id) {
  if (E.leituras[id] === "lendo") return;
  E.leituras[id] = "lendo";
  desenharMensagens("parado");
  try {
    E.leituras[id] = await api("/visao/calendario", { method: "POST", body: JSON.stringify({ c: E.c, m: id }) });
  } catch (e) {
    E.leituras[id] = { erro: e.message === "login" || e.message === "dono" ? "Entre de novo para ler." : e.message };
  }
  desenharMensagens("parado");
}

/* ---------------- telas ---------------- */

function mostrarColuna(qual) {
  for (const [id, k] of [["col-s", "s"], ["col-c", "c"], ["col-m", "m"]]) $(id).classList.toggle("ativa", k === qual);
}

/* O "voltar" do celular (gesto ou tecla) NÃO pode sair para a página de login
   do Discord, que fica no histórico do navegador atrás do app depois do login.
   Aqui ele vira o mesmo "←" de cima: mensagens → canais → servidores. Na lista
   de servidores, fica (não sai). Repomos uma "trava" no histórico a cada volta,
   então o voltar nunca alcança a página do Discord. */
let travaArmada = false;
function armarVoltar() {
  if (travaArmada) return;
  travaArmada = true;
  try { history.pushState({ cyron: "app" }, ""); } catch (e) { /* sem History API */ }
  window.addEventListener("popstate", aoVoltar);
}
function aoVoltar() {
  /* Repõe a trava: o próximo voltar também é tratado aqui, nunca no Discord. */
  try { history.pushState({ cyron: "app" }, ""); } catch (e) {}
  if (!matchMedia("(max-width: 820px)").matches) return; // no PC as colunas ficam juntas
  if ($("col-m").classList.contains("ativa") && E.modo === "painel") {
    mostrarColuna("s"); // o painel abre direto na coluna larga; volta para a lista
  } else if ($("col-m").classList.contains("ativa") && (E.c || E.canal)) {
    pararPoll(); E.c = ""; avisarCanalAoVivo(); mostrarColuna("c");
  } else if ($("col-c").classList.contains("ativa")) {
    mostrarColuna("s");
  }
  /* Na coluna de servidores: fica onde está (a trava já foi reposta). */
}

function desenharServidores() {
  const topo = '<div class="srv' + (E.g === "painel" ? " atual" : "") + '" data-g="painel">' +
    '<div class="ic">📊</div><div class="nm"><b>Painel do dono</b><small>números da CYRON</small></div></div>' +
    '<div class="srv' + (E.g === "privado" ? " atual" : "") + '" data-g="privado">' +
    '<div class="ic">✉️</div><div class="nm"><b>Mensagens privadas</b><small>quem fala com a CYRON</small></div></div>' +
    '<div class="sep"></div>';
  $("lista-s").innerHTML = topo + (E.servidores.length ? E.servidores.map((s) =>
    '<div class="srv' + (s.id === E.g ? " atual" : "") + '" data-g="' + esc(s.id) + '"><div class="ic">' +
    (urlSegura(s.icone) ? '<img loading="lazy" src="' + urlSegura(s.icone) + '" alt="">' : esc((s.nome || "?").trim().charAt(0).toUpperCase())) +
    '</div><div class="nm"><b>' + esc(s.nome) + "</b><small>" + milhar(s.membros) + " membros</small></div></div>").join("")
    : '<div class="vazio">A CYRON ainda não está em nenhum servidor (ou acabou de ligar).</div>');
}

function desenharCanais() {
  let html = "", catAtual = null;
  for (const c of E.canais) {
    if (c.categoria !== catAtual) { catAtual = c.categoria; if (catAtual) html += '<div class="cat">' + esc(catAtual) + "</div>"; }
    html += '<div class="ch' + (c.id === E.c ? " atual" : "") + '" data-c="' + esc(c.id) + '" title="' + esc(c.topico) + '">' +
      '<span class="h">' + (c.tipo === "avisos" ? "📢" : "#") + '</span><span class="n">' + esc(c.nome) + "</span>" +
      (!c.ler ? '<span class="tr" title="A CYRON não lê este canal">🔒</span>' : !c.escrever ? '<span class="tr" title="A CYRON não pode falar aqui">🔇</span>' : "") + "</div>";
  }
  $("lista-c").innerHTML = html || '<div class="vazio">Nenhum canal de texto.</div>';
}

function desenharPrivados() {
  $("lista-c").innerHTML = E.canais.length ? E.canais.map((c) =>
    '<div class="srv' + (c.id === E.c ? " atual" : "") + '" data-c="' + esc(c.id) + '"><div class="ic redondo">' +
    (urlSegura(c.avatar) ? '<img loading="lazy" src="' + urlSegura(c.avatar) + '" alt="">' : esc((c.nome || "?").trim().charAt(0).toUpperCase())) +
    '</div><div class="nm"><b>' + esc(c.nome) + "</b></div></div>").join("")
    : '<div class="vazio">Ninguém falou no privado da CYRON ainda. Quando alguém mandar DM pra ela, a conversa aparece aqui.</div>';
}

/* Redesenha a coluna do meio conforme a tela aberta: canais de um servidor, ou
   as conversas do privado. */
function desenharMeio() { E.modo === "privado" ? desenharPrivados() : desenharCanais(); }

function desenharMensagens(manterPosicao) {
  const rolo = $("rolo-m"), antesAltura = rolo.scrollHeight, antesTopo = rolo.scrollTop;
  const pertoDoFim = rolo.scrollHeight - rolo.scrollTop - rolo.clientHeight < 120;
  $("msgs").innerHTML = (E.msgs.length >= 50 ? '<button class="mais" id="bt-mais">Carregar anteriores</button>' : "") +
    (E.msgs.length ? E.msgs.map((m, i) => htmlMensagem(m, E.msgs[i - 1])).join("") : '<div class="vazio">Nenhuma mensagem aqui ainda.</div>');
  if (manterPosicao === "topo") rolo.scrollTop = rolo.scrollHeight - antesAltura + antesTopo;
  else if (manterPosicao !== "parado" || pertoDoFim) rolo.scrollTop = rolo.scrollHeight;
  const mais = $("bt-mais"); if (mais) mais.onclick = carregarAnteriores;
}

function erroNa(lugar, e) { if (e.message !== "login" && e.message !== "dono") $(lugar).innerHTML = '<div class="erro">' + esc(e.message) + "</div>"; }

async function abrirServidor(g, semRolar) {
  /* A coluna de canais some só no painel (no PC); em servidor e privado ela volta. */
  $("app").classList.toggle("so-painel", g === "painel");
  if (g === "painel") return abrirPainel();
  if (g === "privado") return abrirPrivado(semRolar);
  E.modo = "servidor";
  E.g = g; E.c = ""; E.canais = []; pararPoll(); avisarCanalAoVivo();
  desenharServidores();
  const s = E.servidores.find((x) => x.id === g);
  $("nome-s").textContent = s ? s.nome : "";
  $("lista-c").innerHTML = '<div class="vazio">Carregando…</div>';
  if (!semRolar) mostrarColuna("c");
  try { const j = await api("/visao/canais?g=" + encodeURIComponent(g)); E.canais = j.canais || []; desenharCanais(); }
  catch (e) { erroNa("lista-c", e); }
}

/* As conversas no privado (DM) do bot. Cada conversa vira um "canal" que o
   resto da tela ja' sabe abrir -- so' que com foto de gente e sempre liberado
   para ler e responder (a CYRON manda na propria DM). */
async function abrirPrivado(semRolar) {
  E.modo = "privado"; E.g = "privado"; E.c = ""; E.canais = []; pararPoll(); avisarCanalAoVivo();
  desenharServidores();
  $("nome-s").textContent = "Mensagens privadas";
  $("lista-c").innerHTML = '<div class="vazio">Carregando…</div>';
  if (!semRolar) mostrarColuna("c");
  try {
    const j = await api("/visao/privado");
    E.canais = (j.conversas || []).map((p) => ({ id: p.id, nome: p.nome, avatar: p.avatar, usuario: p.usuario, tipo: "privado", ler: true, escrever: true }));
    desenharPrivados();
  } catch (e) { erroNa("lista-c", e); }
}

/* ---------------- painel do dono ---------------- */

const emK = (n) => { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n); };
const milhar = (n) => (Number(n) || 0).toLocaleString("pt-BR");
const reais = (v) => "R$ " + (Number(v) || 0).toFixed(2).replace(".", ",");
const dataCurta = (ms) => { const d = new Date(ms); return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
/* O bot manda o dia como "2026-11-09" (UTC). Na tela: "seg 09/11". Lido em
   UTC de propósito — new Date("2026-11-09") em Brasília cairia no dia 8. */
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function diaCurto(iso, comSemana) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const dm = m[3] + "/" + m[2];
  return comSemana ? SEMANA[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + " " + dm : dm;
}
/* As línguas como quem as fala escreve — "zh" e "tl" não dizem nada a ninguém. */
const IDIOMA_NOME = {
  pt: "🇧🇷 Português", en: "🇬🇧 English", es: "🇪🇸 Español", ko: "🇰🇷 한국어", ja: "🇯🇵 日本語",
  "zh-CN": "🇨🇳 中文", zh: "🇨🇳 中文", de: "🇩🇪 Deutsch", fr: "🇫🇷 Français", it: "🇮🇹 Italiano",
  ru: "🇷🇺 Русский", ar: "🇸🇦 العربية", tr: "🇹🇷 Türkçe", id: "🇮🇩 Bahasa Indonesia", th: "🇹🇭 ไทย",
  vi: "🇻🇳 Tiếng Việt", pl: "🇵🇱 Polski", nl: "🇳🇱 Nederlands", tl: "🇵🇭 Filipino", hi: "🇮🇳 हिन्दी",
  uk: "🇺🇦 Українська", "zh-TW": "🏮 繁體中文", ms: "🇲🇾 Bahasa Melayu",
};
/* Seta de tendência: verde pra cima, vermelho pra baixo. É o que faz um número
   dizer alguma coisa — "4.8k" sozinho não diz se é bom. */
function tendencia(agora, antes) {
  agora = Number(agora) || 0; antes = Number(antes) || 0;
  if (!antes) return agora ? '<span class="t-nov">novo</span>' : "";
  const p = Math.round(((agora - antes) / antes) * 100);
  if (!p) return '<span class="t-igual">= igual</span>';
  return '<span class="t-' + (p > 0 ? "up" : "dn") + '">' + (p > 0 ? "▲" : "▼") + " " + Math.abs(p) + "%</span>";
}
/* "Subiu QUANTO": a diferença em número, que é o que se lê de um dia pro
   outro. Porcentagem contra um dia só mente — de 40 para 1.180 dá "▲ 2850%",
   que não diz nada que o "+1.140" não diga melhor. */
function diferenca(agora, antes) {
  const d = (Number(agora) || 0) - (Number(antes) || 0);
  if (!d) return '<span class="t-igual">= igual</span>';
  return '<span class="t-' + (d > 0 ? "up" : "dn") + '">' + (d > 0 ? "▲ +" : "▼ −") + milhar(Math.abs(d)) + "</span>";
}

/* O painel do dono: os mesmos números do /admin, mas em tela web — com gráfico
   de verdade e tabela com busca. Abre na coluna principal (a larga).

   Recarregar não apaga a tela: os números de antes ficam até os novos
   chegarem, e a rolagem fica onde estava. Antes, ⟳ piscava "Carregando…" e
   jogava a pessoa de volta pro topo. */
async function abrirPainel(recarregando) {
  E.modo = "painel"; E.g = "painel"; E.c = ""; E.canal = null; pararPoll(); avisarCanalAoVivo();
  $("app").classList.add("so-painel");
  desenharServidores();
  $("nome-s").textContent = "Painel do dono";
  $("nome-c").textContent = "📊 Painel do dono";
  $("aovivo").hidden = true;
  $("escrever").hidden = true;
  if (!(recarregando && E.painel)) $("msgs").innerHTML = '<div class="vazio">Carregando…</div>';
  mostrarColuna("m");
  const rolo = $("rolo-m"), topo = rolo.scrollTop;
  try {
    E.painel = await api("/visao/admin/numeros");
    E.painelEm = Date.now();
    E.painelFiltro = E.painelFiltro || ""; E.painelOrdem = E.painelOrdem || "traducoes";
    desenharPainel();
    rolo.scrollTop = recarregando ? topo : 0;
  } catch (e) { erroNa("msgs", e); }
}

/* Gráfico de área em SVG, com preenchimento em degradê. Mexível: veja
   ligarGrafico. */
const GW = 600, GH = 150, GP = 10;
const gx = (i, n) => (n <= 1 ? GW / 2 : GP + (i * (GW - 2 * GP)) / (n - 1));
const gy = (v, mn, mx) => GH - GP - ((v - mn) / ((mx - mn) || 1)) * (GH - 2 * GP);
const r1 = (x) => Math.round(x * 10) / 10;

/* A curva passa por todos os pontos e NUNCA vai além deles (Fritsch–Carlson,
   a mesma ideia do curveMonotoneX do d3). A curva de antes (Catmull-Rom)
   "balançava": entre um dia zerado e um pico ela descia ABAIXO do zero e
   furava o chão do gráfico — inventando um número negativo que não existe. */
function caminhoMonotono(p) {
  const n = p.length;
  if (n === 1) return "M" + r1(p[0][0]) + " " + r1(p[0][1]);
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  const t = new Array(n);
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const s = 3 / Math.sqrt(h); t[i] = s * a * m[i]; t[i + 1] = s * b * m[i]; }
  }
  let d = "M" + r1(p[0][0]) + " " + r1(p[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += " C" + r1(p[i][0] + h) + " " + r1(p[i][1] + t[i] * h) + " " + r1(p[i + 1][0] - h) + " " +
      r1(p[i + 1][1] - t[i + 1] * h) + " " + r1(p[i + 1][0]) + " " + r1(p[i + 1][1]);
  }
  return d;
}

function svgLinha(id, serie, cor) {
  if (!Array.isArray(serie) || !serie.length) return '<div class="dim">sem dados ainda</div>';
  const mx = Math.max(1, ...serie), mn = Math.min(0, ...serie), n = serie.length;
  const p = serie.map((v, i) => [gx(i, n), gy(v, mn, mx)]);
  const linha = caminhoMonotono(p);
  const area = linha + " L" + r1(p[n - 1][0]) + " " + (GH - GP) + " L" + r1(p[0][0]) + " " + (GH - GP) + " Z";
  return '<svg id="' + id + '" class="area" viewBox="0 0 ' + GW + " " + GH + '" role="img">' +
    '<defs><linearGradient id="' + id + '-g" x1="0" x2="0" y1="0" y2="1">' +
    '<stop offset="0" stop-color="' + cor + '" stop-opacity=".30"/>' +
    '<stop offset="1" stop-color="' + cor + '" stop-opacity="0"/></linearGradient></defs>' +
    '<line x1="' + GP + '" y1="' + (GH - GP) + '" x2="' + (GW - GP) + '" y2="' + (GH - GP) + '" stroke="#3f4147" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
    '<path d="' + area + '" fill="url(#' + id + '-g)"/>' +
    '<path d="' + linha + '" fill="none" stroke="' + cor + '" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<line class="guia" x1="0" y1="' + GP + '" x2="0" y2="' + (GH - GP) + '" stroke="' + cor + '" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/>' +
    '<circle class="ponto" r="5" fill="' + cor + '" stroke="#1e1f22" stroke-width="2.5" opacity="0"/></svg>';
}

/* A régua embaixo do gráfico: de quando, até quando, e o pico — sem ela a
   curva mostrava o desenho, mas não a escala. */
function eixo(serie, rotulos) {
  if (!Array.isArray(serie) || !serie.length) return "";
  const mx = Math.max(...serie), i = serie.indexOf(mx);
  return '<div class="eixo"><span>' + esc(diaCurto(rotulos[0])) + "</span>" +
    "<span>pico " + milhar(mx) + (rotulos[i] ? " · " + esc(diaCurto(rotulos[i])) : "") + "</span><span>hoje</span></div>";
}

/* Deixa o gráfico mexível: tocar, arrastar pro lado ou passar o mouse move a
   guia e escreve o valor exato do dia, e quanto mudou do dia anterior. Começa
   mostrando hoje. */
function ligarGrafico(id, serie, rotulos, unidade) {
  const svg = document.getElementById(id); if (!svg || !serie || !serie.length) return;
  const guia = svg.querySelector(".guia"), ponto = svg.querySelector(".ponto");
  const leitura = document.getElementById(id + "-r");
  const n = serie.length, mx = Math.max(1, ...serie), mn = Math.min(0, ...serie);
  const mostrar = (i) => {
    i = Math.max(0, Math.min(n - 1, i));
    const v = serie[i];
    guia.setAttribute("x1", gx(i, n)); guia.setAttribute("x2", gx(i, n)); guia.setAttribute("opacity", ".55");
    ponto.setAttribute("cx", gx(i, n)); ponto.setAttribute("cy", gy(v, mn, mx)); ponto.setAttribute("opacity", "1");
    if (leitura) {
      /* unidade = [singular, plural]: "1 servidor novo", não "1 servidores novos". */
      const u = Array.isArray(unidade) ? unidade[v === 1 ? 0 : 1] : unidade || "";
      leitura.innerHTML = "<b>" + milhar(v) + "</b> " + esc(u) +
        ' <span class="dim">· ' + (i === n - 1 ? "hoje" : esc(diaCurto(rotulos[i], true))) + "</span>" +
        (i > 0 ? " " + diferenca(v, serie[i - 1]) + ' <span class="dim">vs dia anterior</span>' : "");
    }
  };
  /* O dedo cai na régua do SVG, que tem margem: converte pra coordenada do
     desenho antes de achar o dia, senão as pontas erravam o dia. */
  const pos = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * GW;
    mostrar(Math.round(((x - GP) / (GW - 2 * GP)) * (n - 1)));
  };
  svg.addEventListener("pointerdown", pos);
  svg.addEventListener("pointermove", pos);
  mostrar(n - 1);
}

/* Rosca (donut) em SVG pela técnica de dasharray acumulado. Mostra o total no
   meio e a legenda com os números exatos ao lado. */
function svgDonut(partes) {
  const vis = partes.filter((p) => p.valor > 0), tot = vis.reduce((s, p) => s + p.valor, 0);
  const cx = 70, cy = 70, rho = 48, sw = 20, C = 2 * Math.PI * rho;
  let acc = 0;
  const anel = tot ? vis.map((p) => {
    const len = (p.valor / tot) * C;
    const seg = '<circle cx="' + cx + '" cy="' + cy + '" r="' + rho + '" fill="none" stroke="' + p.cor +
      '" stroke-width="' + sw + '" stroke-dasharray="' + r1(len) + " " + r1(C - len) + '" stroke-dashoffset="' + r1(-acc) +
      '" transform="rotate(-90 ' + cx + " " + cy + ')"/>';
    acc += len; return seg;
  }).join("") : '<circle cx="' + cx + '" cy="' + cy + '" r="' + rho + '" fill="none" stroke="#3f4147" stroke-width="' + sw + '"/>';
  const svg = '<svg class="donut" viewBox="0 0 140 140" width="132" height="132" role="img">' + anel +
    '<text x="70" y="66" text-anchor="middle" class="d-n">' + milhar(tot) + "</text>" +
    '<text x="70" y="84" text-anchor="middle" class="d-l">servidores</text></svg>';
  const leg = '<ul class="legenda">' + partes.map((p) => '<li><span class="lp" style="background:' + p.cor + '"></span>' +
    esc(p.rotulo) + " <b>" + milhar(p.valor) +
    (tot ? ' <span class="dim">' + Math.round((p.valor / tot) * 100) + "%</span>" : "") + "</b></li>").join("") + "</ul>";
  return '<div class="donut-wrap">' + svg + leg + "</div>";
}

/* Ranking em barras: nome inteiro em cima, número à direita, barra embaixo. */
function barrasH(itens, rotulo, valor, sub, cor) {
  const mx = Math.max(1, ...itens.map(valor));
  return '<div class="barras-h"' + (cor ? ' style="--cor-barra:' + cor + '"' : "") + ">" + itens.map((x) =>
    '<div class="bh"><span class="bh-n">' + esc(rotulo(x)) + "</span>" +
    '<span class="bh-v">' + milhar(valor(x)) + (sub && sub(x) ? ' <span class="dim">· ' + esc(sub(x)) + "</span>" : "") + "</span>" +
    '<span class="bh-b"><span style="width:' + Math.max(2, Math.round((valor(x) / mx) * 100)) + '%"></span></span></div>').join("") + "</div>";
}

function desenharPainel() {
  const n = E.painel; if (!n) return;
  const d = n.dinheiro || {}, s = n.servidores || {}, h = n.hoje || {}, cr = n.crescimento || {};
  const dias = n.dias14 || [];
  const vencendo = d.vencendo || [];
  const listinha = (itens, fmt) => itens && itens.length
    ? '<ul class="mini-l">' + itens.map(fmt).join("") + "</ul>" : '<div class="dim">ninguém</div>';

  /* O que PEDE AÇÃO primeiro -- é o que o Discord fazia e faltava aqui. */
  const alertas = (n.atencao && n.atencao.length)
    ? '<div class="alertas"><div class="al-t">🔔 Pede atenção</div>' +
        n.atencao.map((a) => '<div class="al-i">' + esc(a.icone || "") + " " + esc(a.texto) + "</div>").join("") + "</div>"
    : '<div class="alertas ok">✅ Tudo em ordem — nada pedindo atenção.</div>';

  /* Faixa de destaque: traduções dos 14 dias num gráfico MEXÍVEL. Arrasta o dedo
     e a leitura acima mostra o número exato do dia -- "subiu, e subiu TANTO". */
  const hero = '<div class="hero">' +
    '<div class="hero-e"><div class="hero-r">🌐 Traduções hoje</div>' +
      '<div class="hero-v">' + milhar(h.traducoes) + "</div>" +
      '<div class="hero-s">ontem ' + milhar(h.ontem) + " · " + diferenca(h.traducoes, h.ontem) +
        (h.cache ? " · " + milhar(h.cache) + " do cache" : "") + "</div></div>" +
    '<div class="hero-g"><div class="leitura" id="g-trad-r"></div>' + svgLinha("g-trad", n.serie14, "#5865f2") +
      eixo(n.serie14, dias) + "</div></div>";

  /* Quem vence em 7 dias, separado: o cartão "Em teste" contava também quem
     PAGA, e o número embaixo dele não era de teste nenhum. */
  const vencemTeste = vencendo.filter((x) => x.teste).length;
  const vencemPagos = vencendo.length - vencemTeste;
  const tile = (ic, t, v, sub, extra, cor) => '<div class="tile" style="--ac:' + (cor || "var(--azul)") + '"><div class="ti">' + ic + " " + esc(t) + '</div><div class="tv">' + v +
    (extra ? ' <span class="tr-i">' + extra + "</span>" : "") + '</div>' + (sub ? '<div class="ts">' + sub + "</div>" : "") + "</div>";
  const tiles =
    tile("🖥️", "Servidores", milhar(s.ativos), "+" + milhar(s.novos7) + " novos · −" + milhar(s.sairam7) + " saíram (7 dias)", "", "#5865f2") +
    tile("💰", "Pagando", milhar(d.pagando), reais(d.receita) + "/mês" +
      (vencemPagos ? " · " + vencemPagos + " vence" + (vencemPagos > 1 ? "m" : "") + " em 7 dias" : ""), "", "#23a55a") +
    tile("🧪", "Em teste", milhar(d.teste),
      vencemTeste ? vencemTeste + " acaba" + (vencemTeste > 1 ? "m" : "") + " em 7 dias" : "nenhum acabando", "", "#f0b232") +
    tile("🎟️", "Códigos livres", milhar(d.codigosLivres), n.beta?.ligado ? "🧪 beta ligado" : "", "", "#00a8fc") +
    tile("📈", "Traduções · 7 dias", milhar(cr.semana), "7 dias antes: " + milhar(cr.semanaAntes), tendencia(cr.semana, cr.semanaAntes), "#eb459e") +
    tile("🐛", "Erros", milhar(n.erros), n.erros ? "veja embaixo" : "tudo limpo", "", n.erros ? "#f23f43" : "#949ba4");

  /* Rosca da carteira: quem paga, quem testa, quem foi liberado, quem é grátis. */
  const carteira = '<div class="bloco"><div class="bloco-t">🧩 Carteira de servidores</div>' +
    svgDonut([
      { rotulo: "Pagando", valor: d.pagando || 0, cor: "#23a55a" },
      { rotulo: "Em teste", valor: d.teste || 0, cor: "#f0b232" },
      { rotulo: "Liberados", valor: d.liberado || 0, cor: "#00a8fc" },
      { rotulo: "Grátis", valor: d.gratis || 0, cor: "#949ba4" },
    ]) + "</div>";

  const dinheiro = '<div class="bloco"><div class="bloco-t">💰 Dinheiro</div><div class="duas">' +
    '<div><div class="sub-t">⏰ Vencem em 7 dias</div>' +
      listinha(vencendo, (x) => "<li>" + esc(x.nome) + ' <span class="dim">' + dataCurta(x.ate) + (x.teste ? " · teste" : "") + "</span></li>") + "</div>" +
    '<div><div class="sub-t">💸 Não renovaram (30d)</div>' +
      listinha(d.naoRenovaram, (x) => "<li>" + esc(x.nome) + ' <span class="dim">venceu ' + dataCurta(x.venceu) + "</span></li>") + "</div>" +
    "</div></div>";

  const idiomas = (cr.idiomas && cr.idiomas.length)
    ? barrasH(cr.idiomas, (x) => IDIOMA_NOME[x.idioma] || x.idioma, (x) => x.n, null, "#00a8fc")
    : '<span class="dim">ninguém ainda</span>';
  const temEntradas = Array.isArray(cr.entradas14) && cr.entradas14.length;
  const crescimento = '<div class="bloco"><div class="bloco-t">🌱 Servidores novos · 14 dias</div>' +
    (temEntradas
      ? '<div class="leitura" id="g-novos-r"></div>' + svgLinha("g-novos", cr.entradas14, "#23a55a") + eixo(cr.entradas14, dias)
      : '<div class="dim">sem dados ainda</div>') +
    '<div class="sub-t" style="margin-top:14px">🆕 Chegaram nos últimos 7 dias</div>' + listinha(cr.novos, (x) => "<li>" + esc(x) + "</li>") +
    "</div>";

  const linguas = '<div class="bloco"><div class="bloco-t">🌐 Idiomas escolhidos</div>' + idiomas + "</div>";

  const funcoes = '<div class="bloco"><div class="bloco-t">📊 Funções mais usadas · mês</div>' +
    ((n.funcoes && n.funcoes.length)
      ? barrasH(n.funcoes, (x) => x.nome, (x) => x.n, (x) => (x.servidores ? x.servidores + " serv." : ""))
      : '<div class="dim">nada contado este mês ainda</div>') + "</div>";

  const horaErro = (ms) => { if (!ms) return ""; const dt = new Date(ms);
    return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
  const erros = '<div class="bloco"><div class="bloco-t">🐛 Últimos erros</div>' +
    ((n.errosLista && n.errosLista.length)
      ? n.errosLista.map((e) => '<div class="erro-i"><div class="erro-h">' + esc(e.onde || "erro") + ' <span class="dim">' + horaErro(e.quando) + "</span></div>" +
          '<div class="erro-p">' + esc(e.porque || "") + "</div></div>").join("")
      : '<div class="dim">✅ nenhum erro desde que o bot subiu</div>') + "</div>";

  /* O funil: em que passo cada servidor parou. Instalar não é usar -- doze
     servidores e dois conversando pede saber ONDE os outros dez pararam,
     porque cada passo pede um conserto diferente. */
  const fu = n.funil;
  const funil = fu && Array.isArray(fu.servidores) && fu.servidores.length ? '<div class="bloco"><div class="bloco-t">🧭 Funil · onde cada servidor parou (7 dias)</div>' +
    barrasH(fu.etapas || [], (x) => x.nome, (x) => x.n, null, "#5865f2") +
    '<div class="sub-t" style="margin-top:14px">Servidor por servidor</div>' +
    fu.servidores.map((x) => '<div class="fun-i"><div class="fun-h"><b>' + esc(x.nome) + '</b><span class="fun-e">' + esc((fu.nomes || {})[x.etapa] || x.etapa) + "</span></div>" +
      '<div class="dim">' + milhar(x.membros) + " membros · " + milhar(x.comIdioma) + " com idioma · " +
      (x.mensagens7d == null ? "mensagens: medindo" : milhar(x.mensagens7d) + " mensagens") + " · " +
      milhar(x.falas7d) + " falas nas salas" + (x.pessoas7d ? " (" + milhar(x.pessoas7d) + " pessoas)" : "") + "</div></div>").join("") +
    '<div class="dim" style="margin-top:8px">' + (fu.medindoDesde ? "mensagens contadas desde " + esc(diaCurto(fu.medindoDesde)) : "a contagem de mensagens começou agora; em um dia ela aparece") + "</div></div>" : "";

  const tabela = '<div class="bloco"><div class="bloco-t">🖥️ Servidores · traduções em 7 dias ' +
    '<input id="pf" class="pf" placeholder="buscar…" value="' + esc(E.painelFiltro || "") + '">' +
    '<button class="po" id="po"></button></div>' +
    '<table class="tab"><thead><tr><th>Servidor</th><th class="num">Trad. 7d</th><th>Plano</th></tr></thead>' +
    '<tbody id="pt"></tbody></table></div>';

  const hora = E.painelEm ? new Date(E.painelEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  $("msgs").innerHTML = '<div class="painel">' + alertas + hero + '<div class="tiles">' + tiles + "</div>" +
    funil + '<div class="grade">' + carteira + dinheiro + crescimento + linguas + funcoes + erros + "</div>" +
    tabela +
    (hora ? '<div class="atualizado">atualizado às ' + hora + " · ⟳ para recarregar</div>" : "") + "</div>";
  ligarGrafico("g-trad", n.serie14, dias, ["tradução", "traduções"]);
  if (temEntradas) ligarGrafico("g-novos", cr.entradas14, dias, ["servidor novo", "servidores novos"]);
  desenharTabelaDoPainel();
  /* Buscar e ordenar mexem SÓ na tabela. Antes cada letra redesenhava o painel
     inteiro: os gráficos voltavam pro "hoje" e o teclado do celular piscava. */
  $("pf").oninput = () => { E.painelFiltro = $("pf").value; desenharTabelaDoPainel(); };
  $("po").onclick = () => { E.painelOrdem = E.painelOrdem === "nome" ? "traducoes" : "nome"; desenharTabelaDoPainel(); };
}

function desenharTabelaDoPainel() {
  const n = E.painel, corpo = $("pt"); if (!n || !corpo) return;
  const selo = { pago: "🟢", liberado: "🔵", teste: "🟡", gratis: "⚪" };
  const filtro = (E.painelFiltro || "").toLowerCase();
  let linhas = (n.top || []).filter((x) => String(x.nome || "").toLowerCase().includes(filtro));
  if (E.painelOrdem === "nome") linhas = linhas.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  corpo.innerHTML = linhas.map((x) =>
    "<tr><td>" + (selo[x.situacao] || "⚪") + " " + esc(x.nome) + '</td><td class="num">' + milhar(x.traducoes) + "</td><td>" + esc(x.plano) + "</td></tr>").join("") ||
    '<tr><td colspan="3" class="vazio">nenhum</td></tr>';
  $("po").textContent = E.painelOrdem === "nome" ? "A→Z" : "mais usados";
}

async function abrirCanal(c) {
  E.c = c; E.canal = E.canais.find((x) => x.id === c) || null; E.msgs = []; pararPoll();
  desenharMeio();
  const dm = !!(E.canal && E.canal.tipo === "privado");
  $("nome-c").textContent = E.canal ? (dm ? "@ " : E.canal.tipo === "avisos" ? "📢 " : "# ") + E.canal.nome : "";
  $("msgs").innerHTML = '<div class="vazio">Carregando…</div>';
  $("escrever").hidden = false;
  const pode = !E.canal || E.canal.escrever;
  $("texto").disabled = !pode; $("bt-enviar").disabled = !pode; $("bt-emo").disabled = !pode;
  if (!pode) $("painel-emo").hidden = true;
  $("texto").placeholder = !pode ? "A CYRON não pode falar neste canal"
    : dm ? "Responder " + E.canal.nome + " como CYRON"
    : "Conversar em #" + (E.canal ? E.canal.nome : "") + " como CYRON";
  $("nota").textContent = "";
  mostrarColuna("m");
  try {
    const j = await api("/visao/mensagens?c=" + encodeURIComponent(c));
    if (E.c !== c) return;
    E.msgs = j.mensagens; desenharMensagens();
    avisarCanalAoVivo();
    comecarPoll();
  } catch (e) { erroNa("msgs", e); }
}

async function carregarAnteriores() {
  if (!E.msgs.length || E.carregando) return;
  E.carregando = true;
  try {
    const j = await api("/visao/mensagens?c=" + encodeURIComponent(E.c) + "&antes=" + encodeURIComponent(E.msgs[0].id));
    const ids = new Set(E.msgs.map((m) => m.id));
    E.msgs = j.mensagens.filter((m) => !ids.has(m.id)).concat(E.msgs);
    desenharMensagens("topo");
  } catch (e) { $("nota").textContent = e.message; }
  E.carregando = false;
}

async function novidades() {
  if (!E.c || document.hidden || E.carregando) return;
  const c = E.c, ultimo = E.msgs.length ? E.msgs[E.msgs.length - 1].id : "";
  try {
    const j = await api("/visao/mensagens?c=" + encodeURIComponent(c) + (ultimo ? "&depois=" + encodeURIComponent(ultimo) : ""));
    if (E.c !== c || !j.mensagens.length) return;
    const ids = new Set(E.msgs.map((m) => m.id));
    const novas = j.mensagens.filter((m) => !ids.has(m.id));
    if (novas.length) { E.msgs = E.msgs.concat(novas); desenharMensagens("parado"); }
  } catch (e) { /* a próxima volta tenta de novo */ }
}
function comecarPoll() { pararPoll(); if (!V.pronto) E.timer = setInterval(novidades, POLL_MS); }
function pararPoll() { if (E.timer) clearInterval(E.timer); E.timer = null; }

/* ---------------- ao vivo (WebSocket com o bot, não com o Discord) ---------------- */

function conectarAoVivo() {
  if (!token || V.desistiu || (V.ws && V.ws.readyState <= 1)) return;
  let ws;
  try { ws = new WebSocket(AO_VIVO); } catch (e) { return; }
  V.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ tipo: "entrar", token }));
  ws.onmessage = (ev) => {
    let e; try { e = JSON.parse(ev.data); } catch (x) { return; }
    if (e.tipo === "pronto") {
      V.pronto = true; V.espera = 2000;
      $("aovivo").hidden = false;
      if (E.c) { ws.send(JSON.stringify({ tipo: "canal", c: E.c })); novidades(); }
      pararPoll();
    } else if (e.tipo === "mensagem" && e.mensagem && E.c) {
      if (!E.msgs.some((m) => m.id === e.mensagem.id)) { E.msgs.push(e.mensagem); desenharMensagens("parado"); }
    } else if (e.tipo === "editada" && e.mensagem) {
      const i = E.msgs.findIndex((m) => m.id === e.mensagem.id);
      if (i >= 0) { E.msgs[i] = e.mensagem; desenharMensagens("parado"); }
    } else if (e.tipo === "apagada") {
      const antes = E.msgs.length;
      E.msgs = E.msgs.filter((m) => m.id !== e.id);
      if (E.msgs.length !== antes) desenharMensagens("parado");
    }
  };
  ws.onclose = (ev) => {
    V.ws = null; V.pronto = false;
    $("aovivo").hidden = true;
    if (E.c) comecarPoll();
    /* 4003: o bot disse que esta conta não é dona. Insistir não muda isso. */
    if (ev.code === 4003) { V.desistiu = true; return; }
    setTimeout(conectarAoVivo, V.espera);
    V.espera = Math.min(V.espera * 2, 30000);
  };
}
function avisarCanalAoVivo() {
  if (V.ws && V.pronto) V.ws.send(JSON.stringify({ tipo: "canal", c: E.c || "" }));
}

async function enviar() {
  const caixa = $("texto"), texto = caixa.value.trim();
  if (!texto || !E.c) return;
  $("bt-enviar").disabled = true; $("nota").textContent = "Enviando…";
  try {
    const j = await api("/visao/enviar", { method: "POST", body: JSON.stringify({ c: E.c, texto }) });
    caixa.value = ""; ajustarCaixa(); mostrarPrevia();
    if (!E.msgs.some((m) => m.id === j.mensagem.id)) E.msgs.push(j.mensagem);
    desenharMensagens();
    $("nota").textContent = "";
  } catch (e) { $("nota").textContent = "Não foi: " + e.message; }
  $("bt-enviar").disabled = false;
  caixa.focus();
}
function ajustarCaixa() { const t = $("texto"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 180) + "px"; }

/* ---------------- os emojis da CYRON ----------------

   O app fala COMO a CYRON, e os emojis do aplicativo (os da ficha de herói,
   as carinhas dela, as figurinhas) só ela pode usar -- inclusive os
   animados, sem Nitro. O botão 😊 abre todos; tocar põe o atalho :nome: na
   caixa, e o bot troca pelo emoji na hora de enviar. A prévia mostra como
   vai ficar. */
const EMO = { lista: null, grupo: "kingshot" };
const NOMES_DOS_GRUPOS = { kingshot: "Kingshot", cyron: "CYRON", figurinhas: "Figurinhas" };

async function carregarEmojis() {
  if (EMO.lista) return EMO.lista;
  const j = await api("/visao/emojis");
  /* Só o que tem cara de emoji: o nome e o id entram numa página. */
  EMO.lista = (j.emojis || []).filter((e) => /^\d{15,25}$/.test(String(e.id)) && /^\w{2,32}$/.test(String(e.atalho)) &&
    /^\w{2,32}$/.test(String(e.nome)));
  return EMO.lista;
}

function urlDoEmoji(e) {
  return "https://cdn.discordapp.com/emojis/" + e.id + "." + (e.animado ? "gif" : "png") + "?size=48";
}

function desenharEmojis() {
  const grupos = [...new Set(EMO.lista.map((e) => e.grupo))];
  if (!grupos.length) { $("abas-emo").innerHTML = ""; $("grade-emo").textContent = "A CYRON ainda não tem emojis."; return; }
  if (!grupos.includes(EMO.grupo)) EMO.grupo = grupos[0];
  $("abas-emo").innerHTML = grupos.map((g) => '<button data-grupo="' + esc(g) + '"' + (g === EMO.grupo ? ' class="sel"' : "") + ">" +
    esc(NOMES_DOS_GRUPOS[g] || g) + "</button>").join("");
  $("grade-emo").innerHTML = EMO.lista.filter((e) => e.grupo === EMO.grupo).map((e) =>
    '<button data-atalho="' + esc(e.atalho) + '" title=":' + esc(e.atalho) + ':"><img alt=":' + esc(e.atalho) + ':" src="' +
    esc(urlDoEmoji(e)) + '" loading="lazy"></button>').join("");
}

async function abrirEmojis() {
  const p = $("painel-emo");
  if (!p.hidden) { p.hidden = true; return; }
  p.hidden = false;
  if (!EMO.lista) $("grade-emo").textContent = "Carregando…";
  try { await carregarEmojis(); desenharEmojis(); }
  catch (e) { $("grade-emo").textContent = "Não consegui carregar os emojis: " + e.message; }
}

function porNaCaixa(atalho) {
  const t = $("texto");
  const junto = ":" + atalho + ": ";
  const a = t.selectionStart == null ? t.value.length : t.selectionStart;
  const b = t.selectionEnd == null ? a : t.selectionEnd;
  t.value = (t.value.slice(0, a) + junto + t.value.slice(b)).slice(0, 2000);
  t.selectionStart = t.selectionEnd = Math.min(a + junto.length, t.value.length);
  ajustarCaixa(); mostrarPrevia();
  /* No celular, focar abriria o teclado por cima do painel. */
  if (matchMedia("(pointer: fine)").matches) t.focus();
}

/* O mesmo que o bot faz ao enviar: :atalho: vira o emoji; o que já é emoji
   fica. */
function trocarAtalhos(texto) {
  const mapa = new Map();
  for (const e of EMO.lista || []) { mapa.set(e.atalho, e); mapa.set(e.nome, e); }
  return String(texto).replace(/<a?:\w+:\d+>|:(\w{2,32}):/g, (tudo, atalho) => {
    const e = atalho && mapa.get(atalho);
    return e ? "<" + (e.animado ? "a" : "") + ":" + e.nome + ":" + e.id + ">" : tudo;
  });
}

function mostrarPrevia() {
  const p = $("previa-emo"), texto = $("texto").value;
  const trocado = EMO.lista ? trocarAtalhos(texto) : texto;
  if (trocado === texto) { p.hidden = true; p.innerHTML = ""; return; }
  p.hidden = false;
  p.innerHTML = "<small>Prévia:</small>" + fmt(trocado);
}

/* ---------------- começo ---------------- */

$("bt-entrar").onclick = entrar;
$("bt-sair").onclick = sair;
$("bt-recarregar").onclick = () => E.modo === "painel" ? abrirPainel(true) : (E.c && abrirCanal(E.c));
$("bt-enviar").onclick = enviar;
$("texto").addEventListener("input", () => { ajustarCaixa(); mostrarPrevia(); });
$("bt-emo").onclick = abrirEmojis;
$("abas-emo").addEventListener("click", (ev) => { const b = ev.target.closest("[data-grupo]"); if (b) { EMO.grupo = b.dataset.grupo; desenharEmojis(); } });
$("grade-emo").addEventListener("click", (ev) => { const b = ev.target.closest("[data-atalho]"); if (b) porNaCaixa(b.dataset.atalho); });
$("texto").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && matchMedia("(pointer: fine)").matches) { ev.preventDefault(); enviar(); }
});
$("lista-s").addEventListener("click", (ev) => { const el = ev.target.closest("[data-g]"); if (el) abrirServidor(el.dataset.g); });
$("lista-c").addEventListener("click", (ev) => { const el = ev.target.closest("[data-c]"); if (el) abrirCanal(el.dataset.c); });
$("msgs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-ler]"); if (b) lerCalendario(b.dataset.ler); });
document.querySelectorAll(".voltar").forEach((b) => b.addEventListener("click", () => {
  pararPoll(); E.c = ""; avisarCanalAoVivo();
  mostrarColuna(b.dataset.ir === "s" ? "s" : "c");
}));
document.addEventListener("visibilitychange", () => { if (!document.hidden) { novidades(); conectarAoVivo(); } });

async function trocarCodePorToken(code) {
  try {
    const r = await fetch(FUNCAO, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: VOLTA, visao: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) throw new Error(j.erro || "login expirou, tente de novo");
    token = j.token; guardar("cyron-visao-token", token);
    history.replaceState(null, "", VOLTA);
    $("entrar").hidden = true;
    await iniciar();
  } catch (e) { history.replaceState(null, "", VOLTA); telaEntrar(e.message); }
}

async function iniciar() {
  if (!token) return telaEntrar();
  try {
    const eu = await api("/visao/eu");
    $("eu-nome").textContent = eu.bot.nome;
    if (eu.bot.avatar) $("eu-av").src = eu.bot.avatar;
    armarVoltar();
    conectarAoVivo();
    const j = await api("/visao/servidores");
    E.servidores = j.servidores;
    desenharServidores();
    /* No PC as três colunas aparecem juntas: abre o primeiro servidor para a
       tela não começar vazia. */
    if (matchMedia("(min-width: 821px)").matches && E.servidores[0]) abrirServidor(E.servidores[0].id, true);
  } catch (e) {
    if (e.message !== "login" && e.message !== "dono") {
      $("lista-s").innerHTML = '<div class="erro">Não consegui falar com a CYRON: ' + esc(e.message) + ". Ela pode estar reiniciando; tente de novo em um minuto.</div>";
    }
  }
}

(function () {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), estado = q.get("state");
  if (q.get("error")) { history.replaceState(null, "", VOLTA); return telaEntrar(); }
  if (code) {
    const guardado = ler("cyron-estado"); guardar("cyron-estado", null);
    /* So' recusa se havia um estado guardado e ele NAO bate (ataque de CSRF).
       Se nao havia nenhum -- armazenamento perdido entre contextos no celular --,
       segue: quem conclui o login ganha um token da PROPRIA conta, e o bot so'
       deixa ver/falar se essa conta for a dona (/visao/eu devolve 403 se nao
       for). Era este `!estado` exigindo o estado guardado que travava o celular
       num loop de "entrar de novo". */
    if (guardado && estado !== guardado) { history.replaceState(null, "", VOLTA); return telaEntrar(); }
    history.replaceState(null, "", VOLTA);
    return trocarCodePorToken(code);
  }
  if (token) iniciar(); else telaEntrar();
})();
