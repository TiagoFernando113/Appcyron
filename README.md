# Appcyron — painel do dono do bot

App pessoal para ver os servidores do bot do Discord, ler e falar como ele,
entrando com o **login do Discord** do dono. É um projeto à parte: usa o bot
só como teste e não mexe no bot nem no site dele.

**O token do bot nunca chega aqui.** A página entra com a conta do dono
(OAuth, escopo `identify`); quem fala com o Discord usando o token é o próprio
bot, no servidor dele. A página só guarda, nesta aba, o login do dono.

- `index.html` — o app (estilo Discord, instala como PWA pelo `manifest.json`).
- Login: a função `cyron-entrar` troca o code do OAuth e devolve o login.
- Dados e "ao vivo": o endpoint `/visao` do bot, que confere o login e age
  como o bot.

## Ligar
1. **GitHub Pages**: Settings → Pages → Branch `main` (o repositório precisa ser
   público, ou ter plano com Pages privado). O app fica em
   `https://tiagofernando113.github.io/Appcyron/`.
2. **Discord** → Developer Portal → OAuth2 → Redirects: adicionar
   `https://tiagofernando113.github.io/Appcyron/`.
