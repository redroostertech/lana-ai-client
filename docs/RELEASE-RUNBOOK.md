# LANA Desktop Client: Release Runbook

Operator runbook for building, publishing, promoting, and verifying releases of the LANA desktop client (Electron app, repo `redroostertech/lana-ai-client`).

Planned security work for the 3.1.0 initiative: [Organization and server identity binding](plans/3.1.0-organization-server-identity-scope.md). This scope defines the proposed release gate and coordinated Core/control-plane work; implementation and the corresponding desktop release version are pending.

## 1. Run locally

Install dependencies, then start the app in dev mode:

```bash
npm install
npm run electron:dev
```

Use Node 24.21.0 (npm 11), the exact version in `engines`. Electron 44 no longer downloads its binary from its own install script, so the root `postinstall` (`scripts/postinstall-electron.js`, which runs Electron's `install.js`) fetches it into `node_modules/electron/dist` during `npm install` / `npm ci`. Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` to skip that download (for example in a job that only runs Jest); packaging and Playwright jobs must leave it unset. With `npm install --omit=dev` there is no Electron package, and the postinstall prints a one-line notice and does nothing.

npm 11 gates dependency install scripts behind `allowScripts`. The `allowScripts` block in `package.json` records an explicit, version-pinned denial for each of them, so installs print no install-script warnings: bcrypt, esbuild, fsevents, @parcel/watcher and unrs-resolver load their prebuilt binaries (bundled or from platform packages) without their scripts, and electron-winstaller's script only serves the Squirrel.Windows target, which this app does not build. When one of those packages changes version, npm lists it again under `npm install-scripts ls`; review it and update the pinned entry.

`electron:dev` runs `node scripts/electron-dev.js electron-main.js`, which starts Electron in development mode from a copy of Electron named for the product (so the dock says LANA AI, not Electron). Its `preelectron:dev` hook first builds the TipTap bundle, Tailwind CSS, and the screen-voice helper, so no separate build step is needed.

Run unit tests:

```bash
npm run test:unit
```

Backend dependency: the app is a client. It logs into a running LANA backend. For local work, start the backend from the `lana-ai-chef` repo:

```bash
lana start
```

## 2. Build the branch

Do feature work in a git worktree branched off `origin/development`. Never build on someone else's checkout.

```bash
cd /Users/redroostertechnologies/lana-client
git fetch origin development
git worktree add ~/worktrees/<name> -b <branch> origin/development
```

Work in `~/worktrees/<name>`. When tests are green (`npm run test:unit`), merge the branch to `development`.

## 3. Versioning

The version lives in `package.json` (`version`, plus `buildNumber` and `releaseType`). `scripts/generate-version.js` reads `package.json` and generates:

- `public_html/js/version.js` (frontend)
- `src/version.js` (backend/main process)
- version lines in `.env`

Gotcha: `src/version.js` and `public_html/js/version.js` are generated files. If you edit `package.json` by hand and do not regenerate, they go stale and the app reports the wrong version. Always bump with the script so all three agree:

```bash
# Sets package.json version AND regenerates version files in one step
node scripts/generate-version.js 4.2.0
```

Or, if you already edited `package.json`:

```bash
npm run generate-version
```

Commit `package.json`, `src/version.js`, and `public_html/js/version.js` together.

Release versions must be clean semver (`X.Y.Z`, no suffix). Prerelease suffixes on the `package.json` version (for example `4.1.0-pre.b11fab0`) interact badly with the update feeds electron-updater reads: strip them before a release build.

## 4. The release command

One command runs the release, phase by phase, on two machines. It reuses the build scripts below; it does not replace them.

```bash
npm run release -- <mode> --version 4.2.0 [options]
```

| Mode | Machine | What it does |
|---|---|---|
| `status` | either | Shows what is done: the 12 pieces in R2, the pins, the branch tips, what was uploaded. Changes nothing. |
| `parts` | parts Mac (Apple chip) | Preflight, then builds the missing pieces for all four systems at once, then makes the pins branch (pin entries plus the version) and stops for review, then the production gate. |
| `server` | parts Mac | Classifier check, the four Railway images, the signed server update, the portal stamp, the control plane image settings. |
| `installers` | installer build machine | Preflight, a fresh 7-day links file, then all four installers in one session. |
| `publish` | installer build machine | Uploads the installers with the update feeds last, then checks every link. |
| `firms` | parts Mac | Lists what to check for each firm before promoting. |

Options: `--phase <name>` runs one phase; `--target <system>` limits the pieces to one system (`macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`); `--dry-run` reads and plans but builds, uploads and pushes nothing; `--work-dir <dir>` puts the release folder (sources, builds, archives, state) on a bigger disk. The parts Mac also needs `--server-repo <LANA-AI checkout>`.

**Stop and ask.** The command never asks a question in the middle of a run, because an agent runs it. At a step that needs Michael's yes it stops with exit code 10 and says what it waits for. After the yes, run the same command again with `--yes <step>`. The steps are `azure-vms` (one yes covers every VM in that run), `production`, `server-release`, `railway-images`, `upload-installers`, `firm-update` and `promote`. Exit 0 means done and exit 1 means failed.

**Rerun.** A rerun picks up where the last one stopped. Each phase checks what is already done: a piece already in R2 is not built again, and pin entries already on production are not written again. The state file is `~/.lana-release/<version>/state.json` (or under `--work-dir`). It holds no secrets or links.

**Secrets.** Each machine reads the R2 keys from Heroku itself (`heroku login` first). They go only to the `aws` program's environment and are never printed. If the `heroku` command does not start on a Mac (a Homebrew Node problem), set `LANA_HEROKU_BIN` to the Heroku CLI's script and the command runs it with its own Node. The links file is private (mode 600), lives in the release folder, and is never printed or passed to another agent.

**Pieces in R2.** Each piece is `lana-build-parts/<target>/<part>-<id>.tar.gz` with a `.sha256` beside it, where `<id>` is the first 12 characters of the commit it is built from (LANA.cpp for Pip, LANA-AI for the engine, lana-redactor for the redactor). A piece counts as ready when its archive is there and the client's pin has its entry; the archive's content is checked against that entry when it is unpacked. An archive is never overwritten.

**Azure.** Windows and Linux pieces and the Railway images are built by LANA-AI's `scripts/release/azure-verify.sh` (suites `client-parts` and `railway-images`), with its own service principal (`~/.config/lana/azure-verify.json`, mode 600), inside its resource group, every resource tagged with the run and deleted when the run ends. The command never uses a personal `az login` and never creates a resource group. VM sizes are tried in order (`LANA_BUILD_VM_SIZES`). Windows Pip comes from LANA.cpp's release build; the Windows VM checks its embedding match with the pinned binary.

**Registry password.** The lana-push password for LANA's image registry is read from Heroku (`RAILWAY_REGISTRY_PUSH_PASSWORD` on `redroostertec-prod`) into a private file that is removed after the push.

**The order.**

1. On the parts Mac: `npm run release -- parts --version 4.2.0 --server-repo ../LANA-AI --work-dir /Volumes/<big disk>/lana-release`. It builds what is missing, uploads it, makes branch `release/4.2.0-pins`, and stops.
2. Review that branch and merge it to `development`.
3. Run the same command with `--phase gate --yes production`. Client production moves to development, and the command prints the handoff for the installer agent: the commit, the version and the commands. The handoff holds nothing secret.
4. On the parts Mac: `npm run release -- server --version 4.2.0 --server-version <server version> --server-repo ../LANA-AI ...`. It stops at each yes.
5. On the installer build machine, in a clean clone at that production commit, run `npm ci`, then `npm run release -- installers --version 4.2.0`, then `npm run release -- publish --version 4.2.0`. Publish stops for `--yes upload-installers`.
6. On the parts Mac: `npm run release -- firms --version 4.2.0`. Update each firm's server (Norton first), then promote.

Every run ends with a short summary: what was built, what was uploaded, which Release Desk boxes to tick, and what is waiting on Michael.

## 4.1 Build and publish by hand

Where things live (2026-11-23): code on GitHub only; everything hosted on Cloudflare R2. Installers and update feeds: bucket `lana-releases`, served at https://releases.lanaai.io/client/. Build parts (Pip, engine, redactor per system): the private bucket `lana-build-parts`, reached with 7-day read-only links. Azure is only for build machines (VMs for Windows and Linux pieces), never storage.

Release order: the server code is final first (the engine piece is built from it); then Pip, the engine and the redactor are built for every system (macos-arm64, macos-x64, windows-x64, linux-x64) on matching computers and uploaded to `lana-build-parts`; only then are all installers built, together, on the installer build machine. The LANA Release Desk checklist tracks each release.

Required environment on the installer build machine (the script prompts if unset):

| Variable | Purpose |
|---|---|
| `APPLE_TEAM_ID` | macOS code signing team (developer.apple.com) |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (appleid.apple.com) |
| `LANA_CLIENT_PARTS_URLS` | the parts links file (one `<target>/<part> <url>` per line) |

Build one system at a time. Each `build-client.sh` run fetches and checks the parts again while `LANA_CLIENT_PARTS_URLS` is set; `dist/` is only emptied with `--clean`, so the four runs collect in one `dist/`:

```bash
cd <clean clone at production>
npm ci
export APPLE_TEAM_ID=... APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=...
export LANA_CLIENT_PARTS_URLS=/path/to/client-parts-urls.txt
./scripts/build-client.sh --auto-discovery --platform mac --arch arm64 --skip-install
./scripts/build-client.sh --auto-discovery --platform mac --arch x64 --skip-install
./scripts/build-client.sh --auto-discovery --platform windows --skip-install
./scripts/build-client.sh --auto-discovery --platform linux --skip-install --publish
```

Useful flags: `--platform <mac|windows|linux|all>`, `--arch <x64|arm64|all>`, `--skip-install`, `--clean`, `--dev`, `--demo`, `--ip [ip:port]`, `--publish`, `--help`.

Platform outputs in `dist/` (artifact name pattern `LanaAI--genesis--<version>`):

- macOS: `dist/macos-arm64/` and `dist/macos-x64/`, each with `.dmg` and `.zip` (signed and notarized)
- Windows: `dist/windows/` with NSIS `-setup.exe` (x64) and `.zip` (not code signed yet)
- Linux: `dist/linux/` with `.AppImage` and `.deb`

`--publish` uploads nothing. It runs `node scripts/stage-client-release.js --dist dist --version <version>`, which lays the build out in `dist/r2/` in the bucket's exact shape and prints the object list:

- `client/<version>/`: every installer, zip and `.blockmap`
- `client/latest/`: stable-name copies for the download page and emails (`LANA-mac-arm64.dmg`, `LANA-mac-x64.dmg`, `LANA-windows-x64-setup.exe`, `LANA-linux-x86_64.AppImage`, `LANA-linux-amd64.deb`)
- `client/latest.yml`, `client/latest-mac.yml`, `client/latest-linux.yml`: the update feeds installed apps read (electron-updater generic provider, `https://releases.lanaai.io/client/`). Mac builds made one arch at a time are merged into one `latest-mac.yml`.

Upload `dist/r2/` to bucket `lana-releases` keeping those paths, with the `latest*.yml` feeds last so no app is pointed at a file that is not there yet. Then `curl -sI` each `client/latest/` link and expect 200.

electron-builder config: `electron-builder.client.json`, publish block `{"provider": "generic", "url": "https://releases.lanaai.io/client/"}`.

## 5. Promote the release

Open item (2026-11-23): the portal's Client releases page (`https://redroostertec.com/admin/updates/client`) and its Promote step were built to read GitHub releases. Releases now live on releases.lanaai.io, so check what that page lists before promoting, and do not promote a release to a firm whose server is older than the engine the app carries (the engine refuses a Chef below its data API minimum).

Promote, where it applies, upserts:

- One `ClientUpdatePolicy` row keyed on `{org_id, update_channel}`.
- One `ClientDownload` row per installer asset, keyed `{version, platform, arch}`.

## 6. Verify

Run the same wire check clients perform on launch:

```bash
curl -s -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H 'Content-Type: application/json' \
  -d '{"client_version":"<old>","platform":"darwin","arch":"arm64"}'
```

Method: POST. Auth: none required (clients may send `Authorization: Bearer <token>` and an `org_id` field for org-scoped policies). Optional body field `update_channel` (default `stable`).

Expect `status: "update_available"` with `latest_version` set to the promoted version, the platform-specific `download_url`, and `release_notes`. Other response fields the client consumes: `force_update`, `update_channel`, `checksum_sha256`. Repeat with `"platform":"win32","arch":"x64"` and `"platform":"linux"` to verify each installer URL.

Known limitation: `checksum_sha256` is currently always `null`. Nothing records the installers' hashes where the portal can read them. Download integrity relies on signed and notarized installers plus HTTPS. To close this, have `stage-client-release.js` write a `SHASUMS256` file into `client/<version>/` and have the portal read it.

## 7. What customers see

- On every app launch the client posts to the version-check endpoint. If an update is available, every user gets the update dialog: forced and non-dismissible when `force_update` is set (or `status` is `update_required`), otherwise dismissible with Later and Skip.
- Backend updates are NOT shown to non-admin users. This is by design.
- Admins additionally get the Client App card on Administration > Updates, and Help > Check for Updates (shipping with the next release).

## 8. Quick reference: the whole release in 3 steps

```bash
# 1. Build and publish (clean semver in package.json first, see section 3)
./scripts/build-client.sh --auto-discovery --platform all --publish
```

2. Promote in the portal: https://redroostertec.com/admin/updates/client, click Promote on the release row.

```bash
# 3. Verify
curl -s -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H 'Content-Type: application/json' \
  -d '{"client_version":"0.0.1","platform":"darwin","arch":"arm64"}'
```
