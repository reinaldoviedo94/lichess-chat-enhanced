# E2E harness

`harness/index.html` reproduces the lila chat DOM so the **real built extension** can be
exercised without a lichess session. The structure was copied from lila, not invented:

| Element | Source in lichess-org/lila |
|---|---|
| `section.mchat`, `.mchat__tabs`, `.mchat__content` | `modules/chat/src/main/ChatUi.scala`, `ui/lib/src/chat/renderChat.ts` |
| `div(".mchat__content." + active.key)` | `ui/lib/src/chat/renderChat.ts` |
| `ol.mchat__messages` > `li` > `a` + `" "` + `span.text` | `ui/lib/src/chat/discussion.ts` `renderLine()` |
| `input.mchat__say` (`type=text`, `maxlength=140`) | `ui/lib/src/chat/discussion.ts` |

The harness includes two pre-loaded lines — one with `:smile:`, another with `:bounce:` and
an unknown slug — so a single page load exercises: initial transform, data-URI conversion for
static images, Lottie rendering through `FETCH_JSON`, unknown slugs left as text, and the
`data-lce-processed` markers.

`window.__receive(text)` simulates an incoming chat line, which is the only way the
`MutationObserver` can notice a new message — same as real traffic.

## Manual run

```bash
# 1. API up with demo data (from the Django service dir)
uv run python manage.py migrate
uv run python manage.py seed_demo_packs
uv run python runserver

# 2. extension built
pnpm build

# 3. harness served
cd e2e/harness && python3 -m http.server 8849 --bind 127.0.0.1
```

Then in Chrome: `chrome://extensions` → *Cargar descomprimida* → pick `dist/`, and open
`http://127.0.0.1:8849/index.html`. Look for:

- the `🙂` button next to the chat input,
- the existing `:smile:` rendered as an `<img>`, `:bounce:` as an animated `<svg>`,
- `:nope_unknown:` still plain text.

You can also load it on `https://lichess.org` directly — the manifest already matches the
real host. Just remember the chat only exists for **logged-in** players on a game that is
`!tournament && !simul && !swiss && !ai` (`RoundGame.hasChat` in lila).

## Automated run

```bash
node e2e/run.mjs
```

It stages a patched copy of `dist/` (harness origin added to the manifest), serves the
harness on 8849, loads the extension into two isolated Chrome profiles, and asserts the
catalogue, transform, picker, observer, idempotence and the popup login/acquire flow.

**Known limitation:** Playwright does not reliably expose the MV3 service worker of an
unpacked extension. The worker starts during browser startup, before Playwright attaches, so
`context.serviceWorkers()` and `waitForEvent('serviceworker')` both miss it; and Chrome
ignores `--load-extension` under some of Playwright's default argument sets. When that
happens the script exits with code `3` and prints the manual procedure instead of reporting
a pass. Treat the manual run above as the source of truth until the automated path works.
