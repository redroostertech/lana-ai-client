# Lana AI Client - Release Process

This document outlines the complete process for building, notarizing, and releasing the Lana AI Desktop Client.

---

## Prerequisites

1. **Apple Developer Account** with valid signing certificate
2. **GitHub CLI** (`gh`) installed and authenticated
3. **Environment variables** configured (see below)

---

## Environment Setup

Before building, export these environment variables:

```bash
# Apple Notarization (required for macOS)
export APPLE_TEAM_ID="YOUR_TEAM_ID"           # Find at developer.apple.com/account → Membership
export APPLE_ID="your@email.com"              # Your Apple ID email
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # Generate at appleid.apple.com

# Optional: Add to ~/.zshrc or ~/.bashrc for persistence
```

### Getting Your Credentials

**Apple Team ID:**
1. Go to https://developer.apple.com/account
2. Click "Membership" in the sidebar
3. Copy your Team ID

**App-Specific Password:**
1. Go to https://appleid.apple.com
2. Sign in → Security → App-Specific Passwords
3. Click "+" to generate one
4. Name it "electron-notarize"

---

## Release Process

### Step 1: Update Version

```bash
cd /Users/michaelwestbrooksii/Documents/LanaAI/LANA-AI

# Bump version (choose one)
npm version patch   # 1.0.0 → 1.0.1 (bug fixes)
npm version minor   # 1.0.0 → 1.1.0 (new features)
npm version major   # 1.0.0 → 2.0.0 (breaking changes)

# Verify version
node -p "require('./package.json').version"
```

### Step 2: Build the Client

```bash
# Build for all platforms
./scripts/build-client.sh

# Or build for specific platform
./scripts/build-client.sh --platform mac      # macOS only
./scripts/build-client.sh --platform win      # Windows only
./scripts/build-client.sh --platform linux    # Linux only
```

**Build Output:** (where `X.Y.Z` is the version from package.json)
```
dist/
├── macos-arm64/LanaAI--genesis--X.Y.Z-arm64.dmg   # macOS Apple Silicon
├── macos-x64/LanaAI--genesis--X.Y.Z-x64.dmg       # macOS Intel
├── windows/LanaAI--genesis--X.Y.Z-setup.exe       # Windows
├── linux/LanaAI--genesis--X.Y.Z.AppImage          # Linux AppImage
├── linux/LanaAI--genesis--X.Y.Z.deb               # Linux Debian
├── LanaAI--genesis--X.Y.Z.zip                     # macOS auto-update
├── latest.yml                                      # Windows update manifest
├── latest-mac.yml                                  # macOS update manifest
└── latest-linux.yml                                # Linux update manifest
```

### Step 3: Build and Publish (Recommended)

The build script can automatically create the GitHub release and upload all artifacts:

```bash
# Build and publish to GitHub in one step
./scripts/build-client.sh --publish

# Or build for specific platform and publish
./scripts/build-client.sh --platform mac --publish
```

This will:
1. Build the client for the specified platform(s)
2. Create a GitHub release tagged `vX.Y.Z`
3. Upload all artifacts with proper naming: `LanaAI--genesis--X.Y.Z-{arch}.{ext}`
4. Display the release URL when complete

### Step 3 (Alternative): Manual Release

If you prefer to create the release manually:

```bash
cd /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# Create release
gh release create v${VERSION} --title "v${VERSION}" --notes "Release v${VERSION}"

# Upload files (filenames include version automatically)
gh release upload v${VERSION} dist/macos-arm64/LanaAI--genesis--${VERSION}-arm64.dmg
gh release upload v${VERSION} dist/macos-x64/LanaAI--genesis--${VERSION}-x64.dmg
gh release upload v${VERSION} dist/windows/LanaAI--genesis--${VERSION}-setup.exe
gh release upload v${VERSION} dist/linux/LanaAI--genesis--${VERSION}.AppImage
gh release upload v${VERSION} dist/linux/LanaAI--genesis--${VERSION}.deb
gh release upload v${VERSION} dist/latest*.yml
```

### Step 4: Update Server Policy

After release is published, update the hosted discovery service to allow the new version:

1. Log in to the Red Rooster Tech admin panel
2. Navigate to Client Updates management
3. Update the `latest_version` to the new version number
4. Set `force_update` as needed (false for optional, true for required)

**API Endpoints Reference:**
- **Version Check**: `POST https://www.redroostertec.com/lana-ai/v1/client/version-check`
- **Admin List**: `GET https://www.redroostertec.com/api/admin/client-updates`

**Verify the update policy:**
```bash
# Test version check endpoint
curl -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H "Content-Type: application/json" \
  -H "User-Agent: LanaAI-Client/1.0.0" \
  -d '{"client_version": "1.0.0", "platform": "darwin", "arch": "arm64"}'
```

---

## Quick Release Command

The build script now supports automatic GitHub release with the `--publish` flag:

```bash
# Full release for all platforms
./scripts/build-client.sh --publish

# macOS only release
./scripts/build-client.sh --platform mac --publish

# Windows only release
./scripts/build-client.sh --platform win --publish

# Linux only release
./scripts/build-client.sh --platform linux --publish
```

The `--publish` flag will:
- Create a draft GitHub release tagged with the version from `package.json`
- Upload all built artifacts with versioned filenames (e.g., `LanaAI--genesis--3.0.0-arm64.dmg`)
- Upload update manifests (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`)
- Display the release URL when complete

---

## Troubleshooting

### "App contains malware" / App won't open

The app isn't notarized. Ensure:
1. `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` are set
2. You have a valid Apple Developer certificate
3. Rebuild with notarization enabled

**Temporary workaround:**
```bash
xattr -cr /Applications/Lana\ AI\ Client.app
```

### Build fails with entitlements error

Ensure `build/entitlements.mac.plist` exists:
```bash
ls -la build/entitlements.mac.plist
```

### Windows build fails on macOS

This can happen due to corrupted cache:
```bash
rm -rf ~/Library/Caches/electron/electron-*-win32-*
rm -rf dist/win-unpacked
```

### GitHub upload fails (file too large)

Don't commit binaries to git. Use `gh release upload` or the `--publish` flag:
```bash
# Automatic (recommended)
./scripts/build-client.sh --platform mac --publish

# Manual
gh release upload v3.0.0 dist/macos-arm64/LanaAI--genesis--3.0.0-arm64.dmg
```

---

## File Size Reference

| File | Typical Size |
|------|-------------|
| `LanaAI--genesis--X.Y.Z-arm64.dmg` (macOS ARM64) | ~95 MB |
| `LanaAI--genesis--X.Y.Z-x64.dmg` (macOS Intel) | ~100 MB |
| `LanaAI--genesis--X.Y.Z-setup.exe` (Windows) | ~82 MB |
| `LanaAI--genesis--X.Y.Z.AppImage` (Linux) | ~105 MB |
| `LanaAI--genesis--X.Y.Z.deb` (Linux Debian) | ~72 MB |

---

## Checklist

- [ ] Version bumped in `package.json`
- [ ] Environment variables set (APPLE_TEAM_ID, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD)
- [ ] Build completed with `--publish` flag
- [ ] App is properly signed and notarized
- [ ] GitHub release created with versioned artifacts
- [ ] Release URL displayed in build output
- [ ] Server update policy updated
- [ ] Tested OTA update from previous version
