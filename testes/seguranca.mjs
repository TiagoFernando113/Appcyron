/* Os testes de segurança do Painel CYRON. Rodam num navegador de verdade:

     node testes/seguranca.mjs

   Esta página guarda o login do dono e desenha texto escrito por estranhos
   (qualquer um instala a CYRON, ou manda DM pra ela). O que se confere aqui:

   1. Nenhum texto, por mais torto, vira tag com código (onmouseover & cia),
      nem link/imagem que não seja http(s). Uma lista de ataques conhecidos e
      dezenas de milhares de textos sorteados.
   2. A segunda tranca (a política da página) segura o que escapar da primeira.
   3. O texto normal continua saindo como antes: negrito, link, menção. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png" };

/* A página de verdade, servida por http: com file:// a política da página não
   vale do mesmo jeito, e o teste aprovaria uma tranca que não tranca. */
const servidor = createServer(async (req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const arquivo = path.join(RAIZ, caminho === "/" ? "index.html" : caminho);
  if (!arquivo.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  try {
    const corpo = await readFile(arquivo);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream" });
    res.end(corpo);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
const ENDERECO = `http://127.0.0.1:${servidor.address().port}/`;

let passou = 0;
const falhas = [];
const verdade = (nome, valor, detalhe = "") => { if (valor) passou++; else falhas.push(nome + (detalhe ? " — " + detalhe : "")); };
const igual = (nome, real, esperado) => verdade(nome, real === esperado, `saiu ${JSON.stringify(real)}, esperava ${JSON.stringify(esperado)}`);

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const estouros = [];
pagina.on("pageerror", (e) => estouros.push(e.message));
/* Nada de rede de verdade: o bot e o login são de mentira. */
await pagina.addInitScript(() => {
  window.fetch = async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  window.WebSocket = class { constructor() { this.readyState = 3; } send() {} close() {} };
});
await pagina.goto(ENDERECO);
await pagina.waitForFunction(() => typeof fmt === "function" && typeof htmlMensagem === "function");

/* ---------- 1. o que o texto de um estranho pode virar ---------- */

/* Roda DENTRO da página. Monta o HTML fora da tela e devolve tudo o que nele
   seria perigoso. Vazio = limpo. */
const examinar = () => {
  window.perigos = (html) => {
    const molde = document.createElement("template");
    molde.innerHTML = html;
    const ruins = [];
    const PROIBIDAS = /^(SCRIPT|IFRAME|OBJECT|EMBED|FORM|BASE|META|LINK|STYLE|SVG|MATH|INPUT|BUTTON|TEXTAREA|FRAME|FRAMESET)$/i;
    for (const el of molde.content.querySelectorAll("*")) {
      if (PROIBIDAS.test(el.tagName)) ruins.push("tag " + el.tagName);
      for (const a of el.attributes) {
        const nome = a.name.toLowerCase(), valor = a.value;
        if (nome.startsWith("on")) ruins.push(`<${el.tagName} ${a.name}>`);
        else if (nome === "href" || nome === "src") { if (!/^https?:\/\//i.test(valor)) ruins.push(`${nome}=${valor.slice(0, 40)}`); }
        else if (nome === "style") { if (!/^border-left-color:#[0-9a-f]{3,8}$/i.test(valor)) ruins.push(`style=${valor.slice(0, 40)}`); }
        else if (!["class", "target", "rel", "alt", "title", "loading", "data-id", "controls", "preload"].includes(nome)) ruins.push(`atributo ${a.name}`);
      }
    }
    return ruins;
  };
  window.mensagemDe = (texto, extra) => Object.assign({
    id: "1", quando: 1, editada: null, texto, responde: null, anexos: [], figurinhas: [], cartoes: [],
    autor: { id: "9", nome: texto.slice(0, 40), avatar: "", bot: false, webhook: false },
    nomes: { u: { 123: texto.slice(0, 40) }, c: { 789: texto.slice(0, 40) }, r: { 456: texto.slice(0, 40) } },
  }, extra || {});
};
await pagina.evaluate(examinar);

const ATAQUES = [
  /* o furo de verdade, e os parentes dele */
  "[x](https://a/(https://b/onmouseover=window.furo=1//)",
  "[x](<https://a/(https://b/onmouseover=window.furo=1//>)",
  "[x](https://a/(https://b/onpointerenter=location='javascript:window.furo=1'//)",
  "[x](https://a/(https://b/style=animation-name:x/onanimationstart=window.furo=1//)",
  "[x](https://a/ (https://b/onmouseover=window.furo=1//)",
  "(https://a/(https://b/onmouseover=window.furo=1//",
  "https://a/\"onmouseover=window.furo=1//",
  "https://a/<@123>onmouseover=window.furo=1//",
  "https://a/<:ab:123456789012345678>onmouseover=window.furo=1//",
  "[x](https://a/<@123>/onmouseover=window.furo=1//)",
  "[x](https://a/@everyone/onmouseover=window.furo=1//)",
  "[`x`](https://a/`onmouseover=window.furo=1//`)",
  "`x`[y](https://a/`onmouseover=window.furo=1//`)",
  "```x```[y](https://a/```onmouseover=window.furo=1//```)",
  "[ https://a/ onmouseover=window.furo=1 ](https://b/)",
  "[x](javascript:window.furo=1)",
  "[x](https://a/\"onmouseover=\"window.furo=1)",
  "<img src=x onerror=window.furo=1>",
  "<script>window.furo=1</script>",
  "\"><svg onload=window.furo=1>",
  "'-window.furo-'",
  "<@123><@&456><#789>",
  "0 1 `a` [b](https://c/0)",
  "999",
  "**[x](https://a/**(https://b/onmouseover=window.furo=1//)**",
  "__https://a/__onmouseover=window.furo=1__",
  "<https://a/\"onmouseover=window.furo=1//>",
  "<https://a/(https://b/onmouseover=window.furo=1//>",
];
const sujosDosAtaques = await pagina.evaluate((lista) => lista.map((t) => [t, perigos(htmlMensagem(mensagemDe(t), null))]).filter((x) => x[1].length), ATAQUES);
verdade(`${ATAQUES.length} ataques conhecidos não viram código`, !sujosDosAtaques.length, JSON.stringify(sujosDosAtaques.slice(0, 3)));

/* Os campos que não são texto: endereço e cor vêm do bot, mas o bot só repassa
   o que o Discord entregou. Nenhum deles é confiado às cegas. */
const cartaoRuim = await pagina.evaluate(() => {
  const ruim = "javascript:window.furo=1", quebra = "x\" onerror=\"window.furo=1";
  const m = mensagemDe("oi", {
    autor: { id: "9", nome: "<img src=x onerror=1>", avatar: quebra, bot: false, webhook: false },
    anexos: [{ url: ruim, nome: quebra, tipo: "image/png" }, { url: ruim, nome: "a", tipo: "video/mp4" },
      { url: ruim, nome: "a", tipo: "audio/ogg" }, { url: ruim, nome: quebra, tipo: "" },
      { url: "https://cdn.discordapp.com/a.png", nome: quebra, tipo: "image/png" }],
    figurinhas: [{ url: ruim, nome: quebra }, { url: "https://media.discordapp.net/s.png", nome: quebra }],
    cartoes: [{ cor: "red\" onmouseover=\"window.furo=1", autor: "<b>a</b>", titulo: "t", url: ruim, texto: "[x](https://a/(https://b/onmouseover=window.furo=1//)",
      campos: [{ nome: "[x](https://a/(https://b/onmouseover=window.furo=1//)", valor: quebra }], imagem: ruim, miniatura: quebra, rodape: "<u>r</u>" },
      { cor: "#5865f2", autor: "", titulo: "t", url: "https://ok/", texto: "", campos: [], imagem: "https://media.discordapp.net/i.png", miniatura: "", rodape: "" }],
  });
  const html = htmlMensagem(m, null);
  return { ruins: perigos(html), temCorBoa: html.includes('style="border-left-color:#5865f2"'), temLinkBom: html.includes('href="https://ok/"'),
    anexoBom: html.includes('src="https://cdn.discordapp.com/a.png"'), semJs: !/javascript:/i.test(html.replace(/&[a-z#0-9]+;/g, "")) };
});
verdade("endereço, cor e nome ruins de anexo/cartão/figurinha não passam", !cartaoRuim.ruins.length, JSON.stringify(cartaoRuim.ruins.slice(0, 4)));
verdade("endereço que não é http(s) nem aparece", cartaoRuim.semJs);
verdade("cor, link e anexo bons continuam aparecendo", cartaoRuim.temCorBoa && cartaoRuim.temLinkBom && cartaoRuim.anexoBom);

/* As listas da esquerda: nome de servidor, de canal e de pessoa são de quem os criou. */
const listas = await pagina.evaluate(() => {
  const x = "\"><img src=x onerror=window.furo=1>";
  E.servidores = [{ id: x, nome: x, icone: "javascript:1", membros: x }];
  E.g = "";
  desenharServidores();
  const a = perigos(document.getElementById("lista-s").innerHTML.replace(/data-g=/g, "data-id="));
  E.canais = [{ id: x, nome: x, tipo: "texto", topico: x, categoria: x, ler: true, escrever: true }];
  desenharCanais();
  const b = perigos(document.getElementById("lista-c").innerHTML.replace(/data-c=/g, "data-id="));
  E.canais = [{ id: x, nome: x, avatar: "javascript:1", tipo: "privado" }];
  desenharPrivados();
  const c = perigos(document.getElementById("lista-c").innerHTML.replace(/data-c=/g, "data-id="));
  return a.concat(b, c);
});
verdade("nome de servidor, canal e pessoa não vira tag", !listas.length, JSON.stringify(listas.slice(0, 4)));

/* Os emojis da CYRON: o nome e o id vêm do bot, mas o painel os desenha numa
   página que guarda o login. Nome torto não entra, e o que entra é escapado. */
const painelEmo = await pagina.evaluate(async () => {
  const x = "\"><img src=x onerror=window.furo=1>";
  const original = window.fetch;
  window.fetch = async () => new Response(JSON.stringify({ emojis: [
    { atalho: x, nome: x, id: x, animado: true, grupo: x },
    { atalho: "ks_brilho", nome: "ks_brilho_abc123", id: "900000000000000001", animado: true, grupo: "kingshot" },
    { atalho: "ok", nome: "ok", id: "javascript:1", grupo: "figurinhas" },
    { atalho: "gg", nome: "gg", id: "900000000000000003", animado: false, grupo: x }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  EMO.lista = null; EMO.grupo = "kingshot";
  await carregarEmojis();
  window.fetch = original;
  desenharEmojis();
  const html = document.getElementById("abas-emo").innerHTML + document.getElementById("grade-emo").innerHTML;
  /* Os botões e os data- do painel são meus; o que sobrar é o que veio de fora. */
  const meu = html.replace(/<button/g, "<span").replace(/<\/button>/g, "</span>").replace(/data-(grupo|atalho)=/g, "data-id=");
  return { perigos: perigos(meu), atalhos: EMO.lista.map((e) => e.atalho).join(","), temImg: /emojis\/900000000000000001\.gif/.test(html) };
});
verdade("painel de emojis: nome ou id torto não entra", painelEmo.atalhos === "ks_brilho,gg", painelEmo.atalhos);
verdade("painel de emojis: o grupo vindo do bot não vira tag", !painelEmo.perigos.length, JSON.stringify(painelEmo.perigos.slice(0, 3)));
verdade("painel de emojis: o emoji animado aparece como GIF", painelEmo.temImg);

/* O sorteio. Semente fixa: se um dia falhar, falha igual de novo e dá pra ver qual texto foi. */
const sorteio = await pagina.evaluate(({ quantos, semente }) => {
  const PECAS = ["[", "]", "(", ")", "<", ">", "\"", "'", "`", "```", "*", "**", "_", "__", "~~", "\n", " ", " ", "=", "/", "//", "&", ";", ":",
    "https://a/", "http://b/", "https://", "javascript:", "data:text/html,", "onmouseover=", "onerror=", "window.furo=1", "style=", "href=", "src=x",
    "<@123>", "<@!123>", "<@&456>", "<#789>", "<:ab:123456789012345678>", "<a:ab:123456789012345678>", "@everyone", "@here",
    "&lt;", "&gt;", "&quot;", "&#39;", "&amp;", "-# ", "> ", "", "", "0", "1", "x", "</a>", "<a ", "<img ", "<svg ", "<script>", "\u0000", "\t", "\\"];
  let s = semente >>> 0;
  const acaso = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ruins = [];
  for (let i = 0; i < quantos && ruins.length < 5; i++) {
    let texto = "";
    for (let n = 1 + Math.floor(acaso() * 16); n > 0; n--) texto += PECAS[Math.floor(acaso() * PECAS.length)];
    const nomes = { u: { 123: texto }, c: { 789: texto }, r: { 456: texto } };
    const p = perigos(fmt(texto, nomes));
    if (p.length) ruins.push([texto, p]);
    /* de vez em quando, a mensagem inteira (resposta, cabeçalho, cartão) */
    if (i % 25 === 0) {
      const q = perigos(htmlMensagem(mensagemDe(texto, { cartoes: [{ cor: texto, autor: texto, titulo: texto, url: texto, texto, campos: [{ nome: texto, valor: texto }], imagem: texto, miniatura: texto, rodape: texto }],
        anexos: [{ url: texto, nome: texto, tipo: "image/png" }] }), null));
      if (q.length) ruins.push([texto, q]);
    }
  }
  return ruins;
}, { quantos: 60000, semente: 20261115 });
verdade("60.000 textos sorteados: nenhum vira código", !sorteio.length, JSON.stringify(sorteio.slice(0, 2)));

/* ---------- 2. a segunda tranca ---------- */

const tranca = await pagina.evaluate(async () => {
  window.furo = 0;
  const caixa = document.createElement("div");
  document.body.appendChild(caixa);
  caixa.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.furo=1" onerror="window.furo=1">' +
    '<a id="t-js" href="javascript:window.furo=2">x</a><button id="t-bt" onclick="window.furo=3">x</button>';
  document.getElementById("t-js").click();
  document.getElementById("t-bt").click();
  const s = document.createElement("script"); s.textContent = "window.furo=4"; document.body.appendChild(s);
  let rede = "não tentou";
  try { await XMLHttpRequestFora(); } catch (e) { rede = "sem xhr"; }
  await new Promise((ok) => setTimeout(ok, 300));
  caixa.remove();
  return { furo: window.furo, politica: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || "" };
  function XMLHttpRequestFora() { return Promise.reject(new Error("fetch é de mentira neste teste")); }
});
igual("código injetado na página não roda (política da página)", tranca.furo, 0);
verdade("a política não aceita código escrito na página", /script-src 'self'/.test(tranca.politica) && !/script-src[^;]*unsafe-inline/.test(tranca.politica) && !/script-src[^;]*unsafe-eval/.test(tranca.politica));
verdade("a política só deixa falar com o bot e com o login", /connect-src https:\/\/top-best-discord-bot\.fly\.dev wss:\/\/top-best-discord-bot\.fly\.dev https:\/\/[a-z]+\.supabase\.co(;|$)/.test(tranca.politica));
verdade("a política só carrega imagem do Discord", /img-src 'self' data: https:\/\/\*\.discordapp\.com https:\/\/\*\.discordapp\.net(;|$)/.test(tranca.politica));
verdade("o que não foi liberado está fechado", /default-src 'none'/.test(tranca.politica) && /base-uri 'none'/.test(tranca.politica) && /form-action 'none'/.test(tranca.politica));

const html = await readFile(path.join(RAIZ, "index.html"), "utf8");
verdade("nenhum código mora dentro da página", !/<script(?![^>]*\ssrc=)[^>]*>/i.test(html) && !/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<style[\s\S]*?<\/style>/i, "")));
const app = await readFile(path.join(RAIZ, "app.js"), "utf8");
verdade("a página se recusa a abrir dentro de outra", /window\.top !== window\.self/.test(app));
/* Trocar o endereço do bot no app.js e esquecer a política deixaria o app mudo
   sem erro nenhum na tela: o navegador recusa a conversa calado. */
const constante = (nome) => new RegExp("const " + nome + ' = "([^"]+)"').exec(app)?.[1] || "";
const fontes = (/connect-src ([^;]+)/.exec(html)?.[1] || "").split(" ");
verdade("a política libera exatamente o bot e o login que o app usa",
  !!constante("BOT") && fontes.includes(new URL(constante("BOT")).origin) && fontes.includes(new URL(constante("BOT")).origin.replace(/^http/, "ws"))
  && fontes.includes(new URL(constante("FUNCAO")).origin) && fontes.length === 3, fontes.join(" "));
verdade("o app não monta código a partir de texto", !/\beval\(|new Function\(|document\.write\(|setTimeout\(\s*["'`]|setInterval\(\s*["'`]/.test(app));

/* ---------- 3. o texto normal continua saindo ---------- */

const normal = await pagina.evaluate(() => ({
  negrito: fmt("**oi** __u__ *i* ~~s~~"),
  codigo: fmt("`a*b*` e ```js\nx<y```"),
  link: fmt("veja https://a.com/x?b=1&c=2 agora"),
  nomeado: fmt("[**site**](https://a.com)"),
  angulo: fmt("<https://a.com/x>"),
  mencao: fmt("<@123> <@&456> <#789> @everyone", { u: { 123: "Ana <3" }, r: { 456: "R5" }, c: { 789: "geral" } }),
  emoji: fmt("<:ok:123456789012345678>"),
  linhas: fmt("-# pequeno\n> citado"),
  marcaSolta: fmt("a0b"),
  vazio: fmt(null),
}));
const A = (u, t) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
igual("negrito, sublinhado, itálico, riscado", normal.negrito, "<b>oi</b> <u>u</u> <i>i</i> <s>s</s>");
igual("código não é formatado por dentro", normal.codigo, "<code>a*b*</code> e <pre>x&lt;y</pre>");
igual("endereço solto vira link inteiro", normal.link, "veja " + A("https://a.com/x?b=1&amp;c=2", "https://a.com/x?b=1&amp;c=2") + " agora");
igual("link com nome", normal.nomeado, A("https://a.com", "<b>site</b>"));
igual("endereço entre < >", normal.angulo, A("https://a.com/x", "https://a.com/x"));
igual("menções com o nome de verdade", normal.mencao,
  '<span class="men">@Ana &lt;3</span> <span class="men">@R5</span> <span class="men">#geral</span> <span class="men">@everyone</span>');
igual("emoji do servidor", normal.emoji, '<img class="emo" alt=":ok:" title=":ok:" src="https://cdn.discordapp.com/emojis/123456789012345678.png?size=48">');
igual("texto pequeno e citação", normal.linhas, "<small>pequeno</small>\n<q>citado</q>");
igual("marca do cofre escrita por alguém some", normal.marcaSolta, "a0b");
igual("texto vazio", normal.vazio, "");

/* tocar no emoji põe o atalho na caixa; a prévia mostra o emoji; o que já é
   emoji fica como está */
const usoEmo = await pagina.evaluate(() => {
  EMO.lista = [{ atalho: "ks_brilho", nome: "ks_brilho_abc123", id: "900000000000000001", animado: true, grupo: "kingshot" }];
  const t = document.getElementById("texto");
  t.disabled = false; t.value = "bora !"; t.selectionStart = t.selectionEnd = 5;
  porNaCaixa("ks_brilho");
  return { caixa: t.value, previa: document.getElementById("previa-emo").innerHTML,
    pronto: trocarAtalhos("<a:ks_brilho_abc123:900000000000000001> :nada: :ks_brilho:") };
});
igual("tocar no emoji põe o atalho onde estava o cursor", usoEmo.caixa, "bora :ks_brilho: !");
verdade("a prévia mostra o emoji animado", /<img class="emo"[^>]+emojis\/900000000000000001\.gif/.test(usoEmo.previa), usoEmo.previa);
igual("emoji pronto fica; atalho estranho fica como texto", usoEmo.pronto,
  "<a:ks_brilho_abc123:900000000000000001> :nada: <a:ks_brilho_abc123:900000000000000001>");

verdade("a página não estourou nenhuma vez", !estouros.length, estouros.slice(0, 2).join(" | "));

await navegador.close();
servidor.close();
if (falhas.length) {
  console.error(`\n${falhas.length} FALHA(S):\n` + falhas.map((f) => "  ✗ " + f).join("\n"));
  process.exit(1);
}
console.log(`✓ ${passou} conferências de segurança passaram`);
