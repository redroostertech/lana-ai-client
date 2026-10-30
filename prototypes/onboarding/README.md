# LANA onboarding harness

Runs the **real** `<lex-onboarding>` component in Chrome with stand-ins for the
API, auth, navigation and the Ask LANA dock, so the tour can be reviewed and
tested without Electron or the backend. Nothing here ships.

Plan and decisions: `docs/plans/onboarding-experience-plan.md`.

## Run it

From the `lana-ai-client` root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open:

```
http://127.0.0.1:8765/prototypes/onboarding/index.html?name=Michael
```

| Param | Effect |
|---|---|
| `name=Michael` | First name in the greeting |
| `role=admin` | An admin who cannot create users: connect, matter, ask (no invite) |
| `role=member` | A non-admin: library, matter, ask |
| (default) | An org admin or system admin: connect, matter, ask, invite |
| `theme=dark` | Dark LANA AI media-kit look (the app default is light) |

The page shows where the tour sent the user ("Navigated to ...") and what is
saved on this device. **Reset** starts over as a new user; **Relaunch** reloads to test
the launch rules; **Replay the tour** does what the profile menu item does.

## Files

| File | Role |
|---|---|
| `index.html` | Stand-in dashboard; loads the real component from `src/` |
| `harness.js` | Stand-ins: `window.api.user`, `Lex.Auth` (role levels), `Lex.Nav`, `Lex.Toast`, dock `openWith()` |
| `harness.css` | Stand-in page styles |

## Where the real code lives

| File | Role |
|---|---|
| `src/js/lex/components/foundation/lex-onboarding.js` | The component and `Lex.Onboarding.launch()` |
| `src/css/lex-onboarding.css` | Styles, scoped under `lex-onboarding` |
| `src/js/onboarding/onboarding-flow.js` | Pure state machine, scenes, first-step destinations |
| `src/js/onboarding/onboarding-state.js` | Saves onboarding status on the device, one record per user |
| `src/fonts/lana/` | Montserrat and Playfair Display Italic (SIL Open Font License) |
