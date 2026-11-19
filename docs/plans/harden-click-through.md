# Desktop hardening: click-through checklist

For Michael, in the real app, after parts A (pages served from `lana-app://`,
web security and a strict page CSP; `docs/plans/harden-web.md`) and B (an
allowlist for what pages can ask the app to do, sandboxed windows, firm keys
kept out of pages; `docs/plans/harden-ipc.md`) land together.

How to read a problem: keep the app log at hand (Help > Export Debug Logs..., or the log
file). A line with `[ipc] refused` means a page asked for something and the app
said no; a CSP message in the developer console means a page tried to load or
run something it should not (Help > Toggle Developer Tools). Either one on a normal action is a bug: note the
page and what you clicked.

## 1. First start after the upgrade

1. Quit the old version. Start the new one on a computer that was signed in.
2. The app opens without asking you to sign in again (the login token is kept
   by the app, not the page).
3. Your saved things that live in the page are still there: the last page you
   were on, sidebar state, recent searches, theme. (They are copied to the new
   page address once.)
4. Quit and start again: still signed in, nothing copied twice, no flash of
   the sign-in page.
5. Light, Dark and System appearance is the same as before.
6. For a LANA One install: the LANA One name and logo show on every page,
   including the sign-in page.

## 2. Sign in and connect

1. Sign out. On the sign-in page, enter your organization ID and Connect.
2. Enter an ID that does not exist: "We could not find that organization",
   with Retry and the support line. Then the right ID connects.
3. Turn the network off and Connect: "LANA could not reach the sign-in
   service". Turn it back on and Retry works.
4. A firm reachable only over a VPN, with the VPN off: the same "only
   reachable over the VPN" message as before.
5. A hardware box firm (pinned certificate): it connects, and a wrong
   certificate shows the certificate message, not "not reachable".
6. Sign in with email and password, and with MFA if your account has it.
7. App links from email: accept an invite, activate an account (also from the
   "Activate here" link), finish MFA setup, open a shared link. Each lands on
   the right page.
8. After signing in, restart the app: Settings > Capabilities > AI still shows
   Forge (the firm keys are now kept by the app only).
9. Connect links (`lana-ai://connect/<your-org-id>`, typed in the browser's
   address bar):
   - with the sign-in page open: the organization ID box fills in;
   - with LANA quit: LANA starts on the sign-in page with the ID filled in;
   - with LANA open on another page: nothing changes (the link is not used);
     sign out and the sign-in page does not show that ID;
   - a bad link such as `lana-ai://connect/x'y` shows "Invalid connection
     link." and nothing else happens.

## 3. Daily use

New in this build: some actions now ask in a LANA window (not in the page)
before they happen. Cancel is the default; that is expected. Links open in the
browser right away after you click; if a page opens one on its own, or a
second or more after your click (for example after it waits on the server),
LANA asks "Open this link in your browser?" first. If you choose Cancel, that
window does not ask again for about 10 seconds, and only one such question
shows at a time.

1. Dashboard, Matters (workspaces) and a matter's details page load with
   icons. Click around: open a matter, its tabs, its menus, pinned matters.
   Every button that used to work still works (many inline handlers were
   rewritten).
2. Open a document: the file viewer shows a PDF, and the editor opens a DOCX.
   Document review loads the editor.
3. Chat: ask a question in a matter; answers stream; no images load from the
   internet in answers (expected).
4. Automation: open runs and the library; open an artifact and download one
   (storage links work after sign-in).
5. Workflows builder: the canvas (Drawflow) draws and you can connect nodes.
6. Insights and Admin > Reporting: charts draw.
7. Help, FAQ and an article open with their content.
8. Connectors:
   - open Data connectors, start the connect wizard, and connect one over
     OAuth (CRM or communications): the browser opens (possibly after "Open
     this link in your browser?"), you approve, and the app finishes the
     connection;
   - in the connector viewer, Authorize after it saves: expect the "Open this
     link in your browser?" question, then the browser;
   - connector viewer, the MCP connect wizard and the connector setup card in
     chat work.
9. Links that should open your browser do: calendar meeting links, settings
   and billing links, "add seats" on the seat limit screen, external links in
   pages, chat answer links, download and "Open in new window" links in
   Automation, connector API documentation links. They open on your click
   with no question. Links that should stay in the app do. Clicking four
   links within a few seconds opens three; that is the new limit. A plain
   http:// link (not https, for example the two model links on the Insights
   module page) asks "Open this link in your browser?" first (expected).
10. A link inside a document preview or an embedded page does not open the
    browser on its own (expected). A mail link in a matter (a contact's email)
    opens your mail app with just the address; a link to another app's scheme
    (for example `ms-settings:` or `foo://`) does nothing.
11. Embedded partner apps (if your firm has one) load inside the app.
12. Briefs: start a meeting recording (the hidden capture window records):
    the microphone works without a new prompt from LANA, the level meters
    move, stop and save it, and play it back. The tone player plays. After
    Briefs stops (sign out), Location still works in Settings.
13. Brainchild (Knowledge base):
    - choose the install folder, then the vault folder (two dialogs in a row;
      the second must still open);
    - Connect, browse and search notes, open a note in Brainchild, open from
      Drive, then Unlink;
    - Reveal a note: LANA asks "Show this note in its folder?" with the file
      name; Show opens the folder, Cancel does nothing.
14. PAC companion: from the companion, trigger a sign-in request. Allow works
    (only right after you click it), Deny works. "Always allow" asks again in
    a LANA window ("Always let your LANA companion app use your LANA
    sign-in?"); Always allow saves it, Cancel leaves the request unanswered
    (the companion then reports it was not allowed).
15. Screen diction (Mac, if your firm has it): turn it on, use the voice
    overlay end to end, including copy, undo and settings from the overlay.
16. Leave the app open past a token refresh (about an hour): you stay signed
    in.
17. If the local AI engine or editor restarts, a page that stops reaching it
    works again after a reload (expected).

## 4. Settings

1. General: About shows the version and this computer; the Location row turns
   location on and off, and "Open System Settings" opens the computer's page.
   There is no VPN card any more (expected).
2. Appearance: Light, Dark and System change every page at once.
3. Capabilities: the local AI plan, servers, and switching the chat model.
4. Local AI: restart the engine, turn it on or off, background jobs; the
   status banner follows.
5. Screen diction: the toggle, voice settings and the permission buttons.
6. Connected Apps: the list shows the companion; Revoke removes it.
7. Notifications, Sessions, Profile and Security pages open and save.
8. First-launch screen (a fresh install, or `first-launch.html`): pick a
   model, Continue, Pause and Resume the downloads.

## 5. Updates

1. Settings > General > Check for updates answers (and Help > Check for Updates…); Install opens the update
   window.
2. In the update window: Install, Later, Skip and, after a failed download,
   Retry. The "download it yourself" link opens the browser.
3. Admin > Updates: Check, then Install through its confirm dialog. LANA then
   asks in its own window "Install LANA <version> now?" with the new version
   number: Cancel leaves
   everything as it was; "Install and restart" downloads, quits and restarts
   on the new version.
4. After the update restarts the app: still signed in, pages load, and the
   Section 1 checks hold.
