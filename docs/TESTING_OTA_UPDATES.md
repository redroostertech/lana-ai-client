# Testing OTA Updates - Step by Step Guide

This guide walks through testing the complete thin client deployment and OTA update flow.

## Prerequisites

- Mac Studio server running LANA AI backend
- PostgreSQL database running
- GitHub repository for releases (or use local testing)
- Node.js and npm installed

---

## Phase 1: Server Setup

### 1.1 Start the Server

```bash
# Make sure PostgreSQL is running
brew services start postgresql@17

# Start the LANA AI server
cd /Users/michaelwestbrooksii/Documents/LanaAI/LANA-AI
npm run dev
```

### 1.2 Run the Thin Client Setup Script

```bash
./scripts/setup/setup-thin-client.sh \
  --org-id "test-org" \
  --org-name "Test Organization" \
  --static-ip "127.0.0.1"
```

### 1.3 Verify Server Endpoints

```bash
# Test health endpoint
curl http://localhost:8080/api/health

# Test discovery endpoint (this is what thin clients use)
curl http://localhost:8080/api/health/discovery

# Test update policy endpoint
curl -H "x-client-version: 1.0.0" http://localhost:8080/api/client/update-policy
```

Expected discovery response:
```json
{
  "status": "healthy",
  "server": {
    "org_id": "test-org",
    "org_name": "Test Organization",
    "version": "1.0.0",
    "api_version": "v1"
  },
  "discovery": {
    "bonjour_name": "LANA AI - Test Organization",
    "static_ip": "127.0.0.1",
    "port": 8080
  }
}
```

### 1.4 Verify Bonjour Broadcast

```bash
# In a separate terminal, listen for Bonjour services
dns-sd -B _lana._tcp

# You should see:
# Browsing for _lana._tcp
# DATE: ---Fri 05 Dec 2025---
# Timestamp     A/R    Flags  if Domain  Service Type  Instance Name
# 12:00:00.000  Add        2   5  local. _lana._tcp.   LANA AI - Test Organization
```

---

## Phase 2: Build Test Versions

### 2.1 Build Version 1.0.0 (Initial Release)

```bash
# Ensure package.json has version 1.0.0
node -e "console.log(require('./package.json').version)"
# Should output: 1.0.0

# Build the client
npm run build:mac

# Check the output
ls -la dist/*.dmg
```

### 2.2 Install Version 1.0.0

```bash
# Open the DMG and install
open dist/LanaAI--genesis--01-arm64.dmg

# Drag to Applications (or run directly for testing)
```

### 2.3 Build Version 1.1.0 (Update)

```bash
# Bump version
npm version minor
# This changes package.json to 1.1.0 and creates a git tag

# Build the new version
npm run build:mac

# You now have two versions:
# - Version 1.0.0 installed on your system
# - Version 1.1.0 DMG ready for release
```

---

## Phase 3: Set Up GitHub Releases (Production)

### 3.1 Create the GitHub Repository

```bash
# If you haven't already, create the client repo
gh repo create redroostertech/lana-ai-client --private

# Or use the GitHub web UI
```

### 3.2 Push Tags

```bash
git tag v1.0.0
git tag v1.1.0
git push origin --tags
```

### 3.3 Create Releases

**Option A: GitHub CLI**
```bash
# Create v1.0.0 release
gh release create v1.0.0 \
  dist/LanaAI--genesis--01-arm64.dmg \
  --title "v1.0.0" \
  --notes "Initial release"

# Create v1.1.0 release
gh release create v1.1.0 \
  dist/LanaAI--genesis--01-arm64.dmg \
  --title "v1.1.0" \
  --notes "Bug fixes and improvements"
```

**Option B: GitHub Web UI**
1. Go to https://github.com/redroostertech/lana-ai-client/releases
2. Click "Create a new release"
3. Select tag v1.1.0
4. Upload the DMG file
5. Publish

---

## Phase 4: Test OTA Update Flow

### 4.1 Configure Server to Allow Update

```bash
# Set the allowed version to 1.1.0
curl -X PUT http://localhost:8080/api/client/update-policy/admin \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_version": "1.1.0",
    "channel": "stable",
    "force_update": false,
    "release_notes": "Bug fixes and performance improvements"
  }'
```

### 4.2 Verify Update Policy

```bash
# Check what version is allowed
curl -H "x-client-version: 1.0.0" http://localhost:8080/api/client/update-policy

# Expected response:
{
  "current_client_version": "1.0.0",
  "allowed_client_version": "1.1.0",
  "update_required": false,
  "update_available": true,
  "channel": "stable",
  "release_notes": "Bug fixes and performance improvements",
  "download_url": "https://github.com/redroostertech/lana-ai-client/releases/download/v1.1.0/LanaAI--genesis--01-arm64.dmg"
}
```

### 4.3 Launch the Installed Client (v1.0.0)

```bash
# Launch the app
open /Applications/Lana\ AI\ Client.app

# Or for development, run the electron app directly
npm run electron
```

### 4.4 Expected Behavior

1. **App launches** → Shows discovery screen (or connects to saved server)
2. **After 5 seconds** → App checks `/api/client/update-policy`
3. **Update dialog appears** → "Update to v1.1.0?"
4. **User clicks "Update Now"** → App downloads from GitHub
5. **Download completes** → App restarts with new version

---

## Phase 5: Test Force Update

### 5.1 Enable Force Update

```bash
curl -X PUT http://localhost:8080/api/client/update-policy/admin \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_version": "1.2.0",
    "force_update": true,
    "release_notes": "Critical security update - required"
  }'
```

### 5.2 Expected Behavior

1. **App launches** → Checks update policy
2. **Force update dialog** → "Required update to v1.2.0"
3. **Only option is "Update Now"** → Cannot skip
4. **App blocks usage until updated**

---

## Phase 6: Local Testing (Without GitHub)

If you don't want to use GitHub releases during development, you can test locally:

### 6.1 Create a Local HTTP Server for Updates

```bash
# Create a releases directory
mkdir -p local-releases/v1.1.0

# Copy the DMG
cp dist/LanaAI--genesis--01-arm64.dmg local-releases/v1.1.0/

# Start a simple HTTP server
cd local-releases
python3 -m http.server 9000
```

### 6.2 Configure Server for Local Updates

```bash
curl -X PUT http://localhost:8080/api/client/update-policy/admin \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_version": "1.1.0",
    "download_url": "http://localhost:9000/v1.1.0/LanaAI--genesis--01-arm64.dmg"
  }'
```

### 6.3 Modify electron-updater for Local Testing

In `electron-updater-custom.js`, the download URL comes from the server policy, so it will use your local URL.

---

## Phase 7: Testing Checklist

### Server-Side Tests

- [ ] `GET /api/health` returns healthy status
- [ ] `GET /api/health/discovery` returns org info
- [ ] `GET /api/client/update-policy` returns current policy
- [ ] `PUT /api/client/update-policy/admin` updates policy
- [ ] Bonjour service broadcasts `_lana._tcp`
- [ ] Environment variables load correctly (ORG_ID, ORG_NAME)

### Client-Side Tests

- [ ] Discovery screen appears on first launch
- [ ] Bonjour auto-discovers server
- [ ] Manual connection code works
- [ ] Server connection is saved after first connect
- [ ] Update check runs 5 seconds after launch
- [ ] Optional update dialog appears
- [ ] Force update blocks app usage
- [ ] Update downloads successfully
- [ ] App restarts after update
- [ ] New version runs correctly

### OTA Update Flow

- [ ] Client v1.0.0 installed
- [ ] Server configured for v1.1.0
- [ ] Update available dialog appears
- [ ] Download progress shown
- [ ] Update installs successfully
- [ ] App now shows v1.1.0

---

## Troubleshooting

### Update Not Detected

```bash
# Check what the client is sending
# In electron-updater-custom.js, add logging:
console.log('Checking update policy at:', policyUrl);
console.log('Client version:', app.getVersion());

# Check server logs for incoming requests
# Look for: [GET /api/client/update-policy]
```

### Bonjour Not Working

```bash
# Check if mDNS is blocked by firewall
sudo pfctl -s rules | grep mdns

# Restart mDNS responder
sudo killall -HUP mDNSResponder

# Test from another device on same network
dns-sd -B _lana._tcp
```

### Download Fails

```bash
# Check if the download URL is accessible
curl -I "https://github.com/redroostertech/lana-ai-client/releases/download/v1.1.0/LanaAI--genesis--01-arm64.dmg"

# Check for CORS issues in Electron console
# Open DevTools: Cmd+Shift+I
```

### Version Comparison Issues

```bash
# Test the semver comparison
node -e "const semver = require('semver'); console.log(semver.gt('1.1.0', '1.0.0'))"
# Should output: true
```

---

## Quick Test Script

Save this as `test-ota.sh`:

```bash
#!/bin/bash

echo "=== Testing OTA Update Flow ==="

# 1. Check server health
echo -e "\n1. Testing server health..."
curl -s http://localhost:8080/api/health | jq .

# 2. Check discovery endpoint
echo -e "\n2. Testing discovery endpoint..."
curl -s http://localhost:8080/api/health/discovery | jq .

# 3. Check update policy (as v1.0.0 client)
echo -e "\n3. Testing update policy (client v1.0.0)..."
curl -s -H "x-client-version: 1.0.0" http://localhost:8080/api/client/update-policy | jq .

# 4. Set allowed version to 1.1.0
echo -e "\n4. Setting allowed version to 1.1.0..."
curl -s -X PUT http://localhost:8080/api/client/update-policy/admin \
  -H "Content-Type: application/json" \
  -d '{"allowed_version": "1.1.0", "force_update": false}' | jq .

# 5. Check update policy again
echo -e "\n5. Checking update policy after change..."
curl -s -H "x-client-version: 1.0.0" http://localhost:8080/api/client/update-policy | jq .

echo -e "\n=== Test Complete ==="
```

Run it:
```bash
chmod +x test-ota.sh
./test-ota.sh
```
