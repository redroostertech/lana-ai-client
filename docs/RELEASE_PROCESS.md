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

**Build Output:**
```
dist/
├── macos-arm64/LanaAI--genesis--01-arm64.dmg   # macOS Apple Silicon
├── macos-x64/LanaAI--genesis--01-x64.dmg       # macOS Intel
├── windows/LanaAI--genesis--01-setup.exe       # Windows
├── linux/LanaAI--genesis--01.AppImage          # Linux AppImage
├── linux/LanaAI--genesis--01.deb               # Linux Debian
├── LanaAI--genesis--01.zip                     # macOS auto-update
├── latest.yml                                   # Windows update manifest
├── latest-mac.yml                               # macOS update manifest
└── latest-linux.yml                             # Linux update manifest
```

### Step 3: Copy Release Files

```bash
# Copy to lana-ai-client repo
cp dist/macos-arm64/*.dmg /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
cp dist/macos-x64/*.dmg /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
cp dist/windows/*.exe /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
cp dist/linux/*.AppImage /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
cp dist/linux/*.deb /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
cp dist/latest*.yml /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
cp dist/*.zip /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client/
```

### Step 4: Create GitHub Release

```bash
cd /Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client

# Get version from main repo
VERSION=$(node -p "require('../LANA-AI/package.json').version")

# Create release (empty first)
gh release create v${VERSION} --title "v${VERSION}" --notes "Release v${VERSION}"

# Upload files one by one (handles large files better)
gh release upload v${VERSION} LanaAI--genesis--01-arm64.dmg
gh release upload v${VERSION} LanaAI--genesis--01-x64.dmg
gh release upload v${VERSION} LanaAI--genesis--01-setup.exe
gh release upload v${VERSION} LanaAI--genesis--01.AppImage
gh release upload v${VERSION} LanaAI--genesis--01.deb
gh release upload v${VERSION} LanaAI--genesis--01.zip
gh release upload v${VERSION} latest.yml
gh release upload v${VERSION} latest-mac.yml
gh release upload v${VERSION} latest-linux.yml
```

### Step 5: Update Server Policy

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

## Quick Release Script

Save this as `scripts/release-client.sh`:

```bash
#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")
CLIENT_REPO="/Users/michaelwestbrooksii/Documents/LanaAI/lana-ai-client"

echo "=== Releasing Lana AI Client v${VERSION} ==="

# Check environment
if [ -z "$APPLE_TEAM_ID" ]; then
    echo "Error: APPLE_TEAM_ID not set"
    exit 1
fi

# Build
echo "Building..."
./scripts/build-client.sh --platform mac

# Copy files
echo "Copying release files..."
cp dist/macos-arm64/*.dmg "$CLIENT_REPO/"
cp dist/macos-x64/*.dmg "$CLIENT_REPO/"
cp dist/latest-mac.yml "$CLIENT_REPO/"
cp dist/*.zip "$CLIENT_REPO/"

# Create GitHub release
echo "Creating GitHub release..."
cd "$CLIENT_REPO"
gh release create "v${VERSION}" --title "v${VERSION}" --notes "Release v${VERSION}" || true
gh release upload "v${VERSION}" LanaAI--genesis--01-arm64.dmg --clobber
gh release upload "v${VERSION}" LanaAI--genesis--01-x64.dmg --clobber
gh release upload "v${VERSION}" latest-mac.yml --clobber

echo "=== Release v${VERSION} complete! ==="
echo "GitHub: https://github.com/redroostertech/lana-ai-client/releases/tag/v${VERSION}"
```

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

Don't commit binaries to git. Use `gh release upload` instead:
```bash
gh release upload v1.0.0 LanaAI--genesis--01-arm64.dmg
```

---

## File Size Reference

| File | Typical Size |
|------|-------------|
| macOS DMG (arm64) | ~95 MB |
| macOS DMG (x64) | ~100 MB |
| Windows Setup | ~82 MB |
| Linux AppImage | ~105 MB |
| Linux Deb | ~72 MB |

---

## Checklist

- [ ] Version bumped in `package.json`
- [ ] Environment variables set (APPLE_TEAM_ID, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD)
- [ ] Build completed successfully
- [ ] App is properly signed and notarized
- [ ] Files copied to `lana-ai-client` repo
- [ ] GitHub release created with all assets
- [ ] Server update policy updated
- [ ] Tested OTA update from previous version
