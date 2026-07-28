# LANA Desktop Client: Release Runbook

Operator runbook for building, publishing, promoting, and verifying releases of the LANA desktop client (Electron app, repo `redroostertech/lana-ai-client`).

## 1. Run locally

Install dependencies, then start the app in dev mode:

```bash
npm install
npm run electron:dev
```

`electron:dev` runs `NODE_ENV=development npx electron electron-main.js`. Its `preelectron:dev` hook first builds the TipTap bundle, Tailwind CSS, and the screen-voice helper, so no separate build step is needed.

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

Release versions must be clean semver (`X.Y.Z`, no suffix). Prerelease suffixes on the `package.json` version (for example `4.1.0-pre.b11fab0`) interact badly with the GitHub `latest` update channel used by electron-updater: strip them before a release build.

## 4. Build and publish the release

Build with `scripts/build-client.sh`. It backs up and rewrites `public_html/js/config.js` for the chosen mode (auto-discovery is the default and correct for releases), cleans `dist/`, builds CSS, bundles Electron files, runs electron-builder with `electron-builder.client.json`, and organizes output into platform folders.

Required environment (script prompts interactively if unset):

| Variable | Purpose |
|---|---|
| `APPLE_TEAM_ID` | macOS code signing team (developer.apple.com) |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (appleid.apple.com) |

`gh` CLI must be installed and authenticated (`gh auth login`) for `--publish`.

Full release build and publish, all platforms:

```bash
cd <worktree-or-checkout>
export APPLE_TEAM_ID=... APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=...
./scripts/build-client.sh --auto-discovery --platform all --publish
```

Useful flags: `--platform <mac|windows|linux|all>`, `--arch <x64|arm64|all>`, `--skip-install`, `--clean`, `--dev`, `--demo`, `--ip [ip:port]`, `--publish`, `--help`.

Platform outputs in `dist/` (artifact name pattern `LanaAI--genesis--<version>`):

- macOS: `dist/macos-arm64/` and `dist/macos-x64/`, each with `.dmg` and `.zip` (signed and notarized)
- Windows: `dist/windows/` with NSIS `-setup.exe` (x64) and `.zip`
- Linux: `dist/linux/` with `.AppImage` and `.deb` (the script also uploads `.rpm` files if present, but the current `electron-builder.client.json` Linux targets are AppImage and deb only)

`--publish` behavior (verified in `scripts/build-client.sh`):

1. Creates git tag `v<version>` if missing and pushes it to origin.
2. Generates release notes from git history since the previous tag (feat/fix/other sections).
3. Creates a DRAFT GitHub release via `gh release create v<version> --draft`.
4. Uploads all platform artifacts plus `dist/latest*.yml` update manifests. The `latest*.yml` files are required by electron-updater; a release without them cannot be auto-updated to.
5. Publishes the release (`gh release edit v<version> --draft=false`).

Binaries land at https://github.com/redroostertech/lana-ai-client/releases.

electron-builder config: `electron-builder.client.json`, publish block `{"provider": "github", "owner": "redroostertech", "repo": "lana-ai-client", "releaseType": "release"}`.

## 5. Promote the release

Open the admin portal page:

```
https://redroostertec.com/admin/updates/client
```

The Client releases table lists GitHub releases, newest first, with a Recommended badge on the newest full release. Click Promote on the release row:

- Org: leave blank for global.
- Channel select: prereleases default to `beta`.
- Force checkbox: optional, makes the update mandatory for clients.

Promote server-side-fetches the release by tag from GitHub and upserts in Mongo:

- One `ClientUpdatePolicy` row keyed on `{org_id, update_channel}`.
- One `ClientDownload` row per installer asset, keyed `{version, platform, arch}`.

The Convergence panel on the same page flags any policy pointing at a version that is not on GitHub. Resolve flags before considering the release live.

## 6. Verify

Run the same wire check clients perform on launch:

```bash
curl -s -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H 'Content-Type: application/json' \
  -d '{"client_version":"<old>","platform":"darwin","arch":"arm64"}'
```

Method: POST. Auth: none required (clients may send `Authorization: Bearer <token>` and an `org_id` field for org-scoped policies). Optional body field `update_channel` (default `stable`).

Expect `status: "update_available"` with `latest_version` set to the promoted version, the platform-specific `download_url`, and `release_notes`. Other response fields the client consumes: `force_update`, `update_channel`, `checksum_sha256`. Repeat with `"platform":"win32","arch":"x64"` and `"platform":"linux"` to verify each installer URL.

Known limitation: `checksum_sha256` is currently always `null`. The GitHub API does not expose asset hashes, so promote cannot fill it. Download integrity relies on signed and notarized installers plus HTTPS. To close this, publish a `SHASUMS256` asset from `build-client.sh` and parse it during promote.

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
