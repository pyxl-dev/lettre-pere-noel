# Instructions for AI agents

You are an AI coding agent working on **Lettre au Père Noël**: a Cloudflare Worker where two people each write a Christmas wishlist as a letter to Santa, seal it, and can only read the other one after `REVEAL_AT`. The UI and all user-facing text are in French.

## Layout

| Path | Role |
| --- | --- |
| `src/worker.js` | HTTP API, security headers, `LettersStore` Durable Object (SQLite), mail sending (SMTP then Resend) |
| `src/logic.js` | pure rules: tokens, reveal date, letter cleaning, mail content. Keep it free of Cloudflare imports so Node tests can load it |
| `src/smtp.js` | minimal SMTP client; `connect` is injected (`cloudflare:sockets` in the Worker, a Node adapter in tests) |
| `public/` | the app: `index.html`, `app.css`, `app.js` (no framework, no build) |
| `scripts/` | `smtp-sink.mjs` (fake SMTP), `new-tokens.mjs`, `e2e.sh`, `browser-steps.mjs` (Playwright step runner) |
| `test/` | `*.test.mjs` for `node --test`, `e2e/*.json` browser scenarios |

## Rules

- **Never** commit `.dev.vars`, the two people's names or email addresses, tokens or SMTP credentials. They are Worker secrets (`wrangler secret put`). Tests and fixtures use Alice, Bob and `example.test`. The repository is meant to be public. The sender address, domain and SMTP host in `wrangler.jsonc` are the maintainer's public infrastructure, not personal data.
- The server enforces the guarantees: a sent letter is frozen (HTTP 409), the partner letter is only returned once `isRevealed()` is true, links must be `http(s)`. Never move one of these checks to the browser only.
- The Content-Security-Policy forbids inline `style` attributes and inline scripts. Set styles with classes, or with `element.style.x = …` from JS.
- Render user text with `textContent` (the `h()` helper does this). Never `innerHTML` with letter content.
- Animations go through `anim()` / `sleep()` in `app.js`, so "Passer l'animation" and `prefers-reduced-motion` keep working.
- Text in French, no emoji, no em dash.

## Check before you commit

```sh
npm test       # unit tests, about 1 s
npm run e2e    # full journey, desktop 1440 and mobile 375, about 1 min; needs `npx playwright install chromium` once
```

Look at the screenshots in `.pilote-shots/` when you touch the UI: a green run on a wrong-looking screenshot is a failure. `TESTING.md` lists the cases to keep covered.

## Deploying

`npm run deploy` publishes to the real domain and the real people. Do it only when the maintainer asks.
