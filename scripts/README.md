# Lana AI Client Build Scripts

This directory contains scripts for building and testing the Lana AI Electron desktop client.

## Version Management

### Centralized Version System

LANA AI uses a centralized version management system where the version is set in **ONE location** and automatically propagates everywhere.

**Source of Truth:** `package.json`

```json
{
  "version": "3.0.0",
  "buildNumber": "1",
  "releaseType": "beta"
}
```

**Version Format:** `v{version}{suffix}{buildNumber}`
- Examples: `v3.0.0b1` (beta build 1), `v3.0.0` (stable), `v3.0.0rc2` (release candidate 2)

**Release Type Suffixes:**
- `stable` → no suffix (e.g., `v3.0.0`)
- `beta` → `b` (e.g., `v3.0.0b1`)
- `alpha` → `a` (e.g., `v3.0.0a1`)
- `rc` → `rc` (e.g., `v3.0.0rc1`)
- `dev` → `dev` (e.g., `v3.0.0dev1`)
- `pre-release` → `pre` (e.g., `v3.0.0pre1`)

### How to Update Version

1. **Edit `package.json`:**
   ```json
   {
     "version": "3.1.0",
     "buildNumber": "1",
     "releaseType": "beta"
   }
   ```

2. **Run version generator:**
   ```bash
   npm run generate-version
   ```

3. **Version appears everywhere:**
   - Menu footer (e.g., "v3.1.0b1")
   - Login page footer
   - Activation page footer
   - Password reset pages
   - Electron About dialog
   - `.env` file (for backend)

**Auto-generation:** Version files are automatically generated on `npm start` via the `prestart` hook.

**Generated Files:**
- `public_html/js/version.js` - Frontend version object (`window.APP_VERSION`)
- `src/version.js` - Backend version module
- `.env` - Environment variables updated with version info

**Version API:**
```javascript
// Frontend (browser)
window.APP_VERSION.getVersion()           // "v3.0.0b1"
window.APP_VERSION.getDetailedVersion()   // "v3.0.0b1 (Build 1, Beta)"
window.APP_VERSION.getSemanticVersion()   // "3.0.0"

// Backend (Node.js)
const version = require('./src/version.js');
version.getVersion()           // "v3.0.0b1"
version.getDetailedVersion()   // "v3.0.0b1 (Build 1, Beta)"
version.getSemanticVersion()   // "3.0.0"
```

---

## Build Scripts

### `build-client.sh`
Main script for building the Electron desktop application.

**Usage:**
```bash
# Build for all platforms
./scripts/build-client.sh --ip <backend-ip:port>

# Build for specific platform
./scripts/build-client.sh --ip 192.168.1.100:8080 --platform mac
./scripts/build-client.sh --ip 192.168.1.100:8080 --platform win
./scripts/build-client.sh --ip 192.168.1.100:8080 --platform linux

# Build for specific architecture
./scripts/build-client.sh --ip 192.168.1.100:8080 --arch arm64
./scripts/build-client.sh --ip 192.168.1.100:8080 --arch x64

# Clean build
./scripts/build-client.sh --ip 192.168.1.100:8080 --clean

# Demo mode (no backend required)
./scripts/build-client.sh --demo
```

**Options:**
- `--ip <ip:port>` - Backend server IP and port (required unless --demo)
- `--platform <platform>` - Target: `mac`, `win`, `linux`, `all` (default: all)
- `--arch <arch>` - Architecture: `x64`, `arm64`, `all` (default: all)
- `--clean` - Clean build directories first
- `--skip-install` - Skip npm install
- `--demo` - Build demo mode (no backend connection)

**Output:**
Installers are created in `dist/` directory:
- `dist/macos-arm64/` - macOS Apple Silicon builds
- `dist/macos-x64/` - macOS Intel builds
- `dist/windows/` - Windows builds
- `dist/linux/` - Linux builds

---

### `bundle-electron.js`
Helper script for bundling Electron application code.

Used internally by `build-client.sh`. You typically don't need to run this directly.

---

## Test Scripts

### `test/test-ota.sh`
Tests the over-the-air (OTA) update mechanism for the Electron client.

**Usage:**
```bash
./scripts/test/test-ota.sh
```

Verifies that the auto-update feature works correctly.

---

## Common Workflows

### Building for Customer Deployment

1. **Determine backend server IP**
   ```bash
   # The backend server's static IP address
   BACKEND_IP="192.168.1.100:8080"
   ```

2. **Build client for all platforms**
   ```bash
   ./scripts/build-client.sh --ip $BACKEND_IP --platform all
   ```

3. **Distribute installers to end users**
   - macOS (Apple Silicon): `dist/macos-arm64/LanaAI-*.dmg`
   - macOS (Intel): `dist/macos-x64/LanaAI-*.dmg`
   - Windows: `dist/windows/LanaAI-setup.exe`
   - Linux: `dist/linux/LanaAI-*.AppImage` or `.deb`

### Development Testing

1. **Build for your platform only**
   ```bash
   # macOS Apple Silicon
   ./scripts/build-client.sh --ip localhost:8080 --platform mac --arch arm64

   # Windows x64
   ./scripts/build-client.sh --ip localhost:8080 --platform win --arch x64
   ```

2. **Test the build**
   - macOS: Open the DMG and run the app
   - Windows: Run the installer
   - Linux: Run the AppImage or install the .deb/.rpm

### Demo Mode Build

For trade shows or demos where no backend is available:

```bash
./scripts/build-client.sh --demo --platform mac
```

This creates a demo version with mock data.

---

## Troubleshooting

### Build fails with permission errors
```bash
# Make sure build script is executable
chmod +x ./scripts/build-client.sh

# Try with clean build
./scripts/build-client.sh --ip <backend-ip> --clean
```

### Cross-platform build issues
Building for all platforms from a single machine has limitations:
- macOS can build for: Mac, Windows, Linux
- Windows can build for: Windows, Linux (not Mac)
- Linux can build for: Windows, Linux (not Mac)

Recommendation: Build on macOS for best cross-platform support.

### Out of memory during build
Electron builds can be memory-intensive. Close other applications and try again.

---

## See Also

- Main README: `../README.md`
- Electron Configuration: `../electron-main.js`
- Build Configuration: `../electron-builder.client.json`

---

**Last Updated:** 2025-12-21
