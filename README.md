# Appcyron — painel do dono do bot

App pessoal para ver os servidores do bot do Discord, ler e falar como ele,
entrando com o **login do Discord** do dono. É um projeto à parte: usa o bot
só como teste e não mexe no bot nem no site dele.

**O token do bot nunca chega aqui.** A página entra com a conta do dono
(OAuth, escopo `identify`); quem fala com o Discord usando o token é o próprio
bot, no servidor dele. A página só guarda, nesta aba, o login do dono.

- `index.html` — a tela (estilo Discord, instala como PWA pelo `manifest.json`).
- `app.js` — o código. Mora fora da página de propósito: a política de
  segurança do `index.html` só roda código deste arquivo. Ao mudá-lo, suba o
  número em `app.js?v=N` no fim do `index.html`, senão o navegador pode usar
  o antigo por alguns minutos.
- Login: a função `cyron-entrar` troca o code do OAuth e devolve o login.
- Dados e "ao vivo": o endpoint `/visao` do bot, que confere o login e age
  como o bot.

## Ligar
1. **GitHub Pages**: Settings → Pages → Branch `main` (o repositório precisa ser
   público, ou ter plano com Pages privado). O app fica em
   `https://tiagofernando113.github.io/Appcyron/`.
2. **Discord** → Developer Portal → OAuth2 → Redirects: adicionar
   `https://tiagofernando113.github.io/Appcyron/`.

## Segurança
O app mostra texto escrito por qualquer pessoa (quem instala o bot, quem manda
DM) na mesma página que guarda o login do dono. Por isso:

- todo texto de fora é escapado, e endereço só entra em link/imagem se for
  `http(s)`;
- a página tem uma política (CSP) que só roda o `app.js`, só conversa com o bot
  e com o login, e só carrega imagem do Discord;
- `node testes/seguranca.mjs` confere tudo isso num navegador de verdade
  (precisa do Playwright). Roda sozinho em todo pull request.

Qualquer endereço novo que o app precise alcançar tem de entrar na política
do `index.html`.
