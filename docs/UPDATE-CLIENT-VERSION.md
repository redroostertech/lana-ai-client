# How to Update LANA AI Client Version

> **Last Updated:** 2026-01-16
> **Target System:** RedRoosterTech-Web MongoDB (client version management)

---

## Overview

This guide explains how to update the LANA AI client version information in the MongoDB database to trigger auto-updates for deployed Electron clients.

---

## MongoDB Collections

The auto-update system uses **two MongoDB collections**:

### 1. Client Update Policies
**Collection Names:**
- **Production:** `client_update_policies_production`
- **Development:** `client_update_policies_development`

**Purpose:** Stores version policies (latest version, minimum version, force update flags)

### 2. Client Downloads (Platform-Specific)
**Collection Names:**
- **Production:** `client_downloads_production`
- **Development:** `client_downloads_development`

**Purpose:** Stores platform-specific download URLs (macOS ARM64/x64, Windows x64, Linux x64)

---

## Quick Reference: Key Properties

### ClientUpdatePolicy Document
```javascript
{
  _id: ObjectId("..."),
  org_id: "global",                          // "global" or org-specific ID
  latest_version: "3.1.0",                   // ← UPDATE THIS
  minimum_supported_version: "2.0.0",        // ← UPDATE THIS (if needed)
  allowed_client_version: "2.0.0",
  update_channel: "stable",                  // "stable", "beta", or "alpha"
  force_update: false,                       // ← Set to true to force update
  release_notes: "What's new in 3.1.0...",   // ← UPDATE THIS
  download_url: "https://github.com/...",    // Fallback URL
  checksum_sha256: "abc123...",              // SHA-256 checksum
  is_active: true,
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

### ClientDownload Document (Platform-Specific)
```javascript
{
  _id: ObjectId("..."),
  version: "3.1.0",                          // ← UPDATE THIS
  platform: "darwin",                        // "darwin", "win32", or "linux"
  arch: "arm64",                             // "x64", "arm64", or "ia32"
  download_url: "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-arm64.dmg",
  checksum_sha256: "abc123...",              // SHA-256 of the file
  file_size_bytes: 123456789,                // File size in bytes
  release_notes: "macOS ARM64 build",
  update_channel: "stable",
  is_active: true,
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

---

## Method 1: Using MongoDB Shell (Direct Database Access)

### Step 1: Connect to MongoDB

```bash
# If MongoDB Atlas (production)
mongosh "mongodb+srv://cluster.mongodb.net/redroostertec" --username <username>

# If local MongoDB
mongosh "mongodb://localhost:27017/redroostertec"
```

### Step 2: List Current Policies

```javascript
// View all active policies
db.client_update_policies_production.find({ is_active: true }).pretty()

// View global policy (applies to all clients)
db.client_update_policies_production.findOne({ org_id: "global", is_active: true })
```

### Step 3: Update Global Policy

```javascript
// Update the global policy to version 3.1.0
db.client_update_policies_production.updateOne(
  { org_id: "global", is_active: true },
  {
    $set: {
      latest_version: "3.1.0",
      minimum_supported_version: "2.0.0",  // Optional: update if needed
      release_notes: "Version 3.1.0 - New features:\n- Feature A\n- Feature B\n- Bug fixes",
      download_url: "https://github.com/redroostertech/lana-ai-client/releases/tag/v3.1.0",
      checksum_sha256: "YOUR_SHA256_CHECKSUM_HERE",
      force_update: false,  // Set to true to force all clients to update
      updatedAt: new Date()
    }
  }
)
```

### Step 4: Add Platform-Specific Downloads (Optional but Recommended)

```javascript
// macOS ARM64 (Apple Silicon)
db.client_downloads_production.insertOne({
  version: "3.1.0",
  platform: "darwin",
  arch: "arm64",
  download_url: "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-arm64.dmg",
  checksum_sha256: "YOUR_ARM64_SHA256_HERE",
  file_size_bytes: 123456789,
  release_notes: "macOS ARM64 (Apple Silicon) build",
  update_channel: "stable",
  is_active: true,
  createdAt: new Date(),
  updatedAt: new Date()
})

// macOS x64 (Intel)
db.client_downloads_production.insertOne({
  version: "3.1.0",
  platform: "darwin",
  arch: "x64",
  download_url: "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-x64.dmg",
  checksum_sha256: "YOUR_X64_SHA256_HERE",
  file_size_bytes: 123456789,
  release_notes: "macOS x64 (Intel) build",
  update_channel: "stable",
  is_active: true,
  createdAt: new Date(),
  updatedAt: new Date()
})

// Windows x64
db.client_downloads_production.insertOne({
  version: "3.1.0",
  platform: "win32",
  arch: "x64",
  download_url: "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-Setup-3.1.0.exe",
  checksum_sha256: "YOUR_WIN_SHA256_HERE",
  file_size_bytes: 123456789,
  release_notes: "Windows x64 build",
  update_channel: "stable",
  is_active: true,
  createdAt: new Date(),
  updatedAt: new Date()
})

// Linux x64
db.client_downloads_production.insertOne({
  version: "3.1.0",
  platform: "linux",
  arch: "x64",
  download_url: "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-x86_64.AppImage",
  checksum_sha256: "YOUR_LINUX_SHA256_HERE",
  file_size_bytes: 123456789,
  release_notes: "Linux x64 build",
  update_channel: "stable",
  is_active: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

### Step 5: Verify Update

```javascript
// Verify policy update
db.client_update_policies_production.findOne({ org_id: "global", is_active: true })

// Verify platform downloads
db.client_downloads_production.find({ version: "3.1.0", is_active: true }).pretty()
```

---

## Method 2: Using Admin API (Recommended for Automation)

### Prerequisites
You need to authenticate with the admin API. Set up your credentials:

```bash
export ADMIN_API_URL="https://www.redroostertec.com"
export ADMIN_TOKEN="your-admin-token-here"  # If authentication is required
```

### Step 1: View Current Policy

```bash
curl -X GET "$ADMIN_API_URL/api/admin/client-updates?org_id=global" \
  -H "Content-Type: application/json"
```

### Step 2: Create New Policy (or Update Existing)

#### Option A: Create New Policy
```bash
curl -X POST "$ADMIN_API_URL/api/admin/client-updates" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "global",
    "latest_version": "3.1.0",
    "minimum_supported_version": "2.0.0",
    "allowed_client_version": "2.0.0",
    "update_channel": "stable",
    "force_update": false,
    "release_notes": "Version 3.1.0 - New features and improvements",
    "download_url": "https://github.com/redroostertech/lana-ai-client/releases/tag/v3.1.0",
    "checksum_sha256": "YOUR_SHA256_HERE"
  }'
```

#### Option B: Update Existing Policy
```bash
# First, get the policy ID
POLICY_ID=$(curl -s -X GET "$ADMIN_API_URL/api/admin/client-updates?org_id=global" | jq -r '.policies[0]._id')

# Then update it
curl -X PUT "$ADMIN_API_URL/api/admin/client-updates/$POLICY_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "latest_version": "3.1.0",
    "release_notes": "Version 3.1.0 - New features and improvements",
    "force_update": false
  }'
```

### Step 3: Add Platform-Specific Downloads

```bash
# macOS ARM64
curl -X POST "$ADMIN_API_URL/api/admin/client-downloads" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3.1.0",
    "platform": "darwin",
    "arch": "arm64",
    "download_url": "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-arm64.dmg",
    "checksum_sha256": "YOUR_ARM64_SHA256_HERE",
    "file_size_bytes": 123456789,
    "release_notes": "macOS ARM64 build",
    "update_channel": "stable"
  }'

# macOS x64
curl -X POST "$ADMIN_API_URL/api/admin/client-downloads" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3.1.0",
    "platform": "darwin",
    "arch": "x64",
    "download_url": "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-x64.dmg",
    "checksum_sha256": "YOUR_X64_SHA256_HERE",
    "file_size_bytes": 123456789,
    "release_notes": "macOS x64 build",
    "update_channel": "stable"
  }'

# Windows x64
curl -X POST "$ADMIN_API_URL/api/admin/client-downloads" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3.1.0",
    "platform": "win32",
    "arch": "x64",
    "download_url": "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-Setup-3.1.0.exe",
    "checksum_sha256": "YOUR_WIN_SHA256_HERE",
    "file_size_bytes": 123456789,
    "release_notes": "Windows x64 build",
    "update_channel": "stable"
  }'

# Linux x64
curl -X POST "$ADMIN_API_URL/api/admin/client-downloads" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "3.1.0",
    "platform": "linux",
    "arch": "x64",
    "download_url": "https://github.com/redroostertech/lana-ai-client/releases/download/v3.1.0/LanaAI-3.1.0-x86_64.AppImage",
    "checksum_sha256": "YOUR_LINUX_SHA256_HERE",
    "file_size_bytes": 123456789,
    "release_notes": "Linux x64 build",
    "update_channel": "stable"
  }'
```

---

## Method 3: Quick Update Script

Create a script to automate the update process:

```bash
#!/bin/bash
# update-client-version.sh

VERSION="3.1.0"
MIN_VERSION="2.0.0"
FORCE_UPDATE=false
RELEASE_NOTES="Version 3.1.0 - New features and improvements"

# MongoDB connection string
MONGO_URI="mongodb+srv://username:password@cluster.mongodb.net/redroostertec"

echo "Updating LANA AI Client to version $VERSION..."

# Update policy via MongoDB
mongosh "$MONGO_URI" --quiet --eval "
db.client_update_policies_production.updateOne(
  { org_id: 'global', is_active: true },
  {
    \$set: {
      latest_version: '$VERSION',
      minimum_supported_version: '$MIN_VERSION',
      release_notes: '$RELEASE_NOTES',
      force_update: $FORCE_UPDATE,
      updatedAt: new Date()
    }
  }
)
"

echo "Version updated to $VERSION"
echo "Minimum supported version: $MIN_VERSION"
echo "Force update: $FORCE_UPDATE"
echo ""
echo "Test the endpoint:"
echo "curl -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"client_version\":\"2.0.0\"}'"
```

---

## Calculating SHA-256 Checksums

### For macOS/Linux:
```bash
# DMG file
shasum -a 256 LanaAI-3.1.0-arm64.dmg

# AppImage file
shasum -a 256 LanaAI-3.1.0-x86_64.AppImage
```

### For Windows:
```powershell
# EXE file
certutil -hashfile LanaAI-Setup-3.1.0.exe SHA256
```

### Get File Size:
```bash
# macOS/Linux
ls -l LanaAI-3.1.0-arm64.dmg | awk '{print $5}'

# Or use stat
stat -f%z LanaAI-3.1.0-arm64.dmg  # macOS
stat -c%s LanaAI-3.1.0-x86_64.AppImage  # Linux
```

---

## Testing the Update

After updating the database, test the endpoint:

```bash
# Test with old version (should show update available)
curl -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H "Content-Type: application/json" \
  -d '{"client_version":"2.0.0","platform":"darwin","arch":"arm64"}'

# Test with current version (should show current)
curl -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H "Content-Type: application/json" \
  -d '{"client_version":"3.1.0","platform":"darwin","arch":"arm64"}'
```

---

## Update Strategies

### 1. Optional Update (Recommended)
Users can skip or postpone the update.

```javascript
{
  force_update: false
}
```

**Client sees:** "Update Now" / "Remind Me Later" / "Skip This Version"

### 2. Force Update (Critical Security Fixes)
Users must update to continue using the app.

```javascript
{
  force_update: true
}
```

**Client sees:** "Update Now" (only option)

### 3. Minimum Version Enforcement
Block very old clients that are no longer supported.

```javascript
{
  latest_version: "3.1.0",
  minimum_supported_version: "2.0.0"  // Clients < 2.0.0 are blocked
}
```

---

## Org-Specific Updates

You can create org-specific policies for individual customers:

```javascript
// Customer ABC gets version 3.1.0
db.client_update_policies_production.insertOne({
  org_id: "customer-abc-123",  // Specific org ID
  latest_version: "3.1.0",
  minimum_supported_version: "2.0.0",
  update_channel: "stable",
  force_update: false,
  release_notes: "Version 3.1.0 for Customer ABC",
  is_active: true,
  createdAt: new Date(),
  updatedAt: new Date()
})

// All other customers use the global policy
// (org_id: "global")
```

**Priority:** Org-specific policy > Global policy

---

## Rollback Procedure

If you need to rollback to a previous version:

```javascript
// Rollback to version 3.0.0
db.client_update_policies_production.updateOne(
  { org_id: "global", is_active: true },
  {
    $set: {
      latest_version: "3.0.0",
      release_notes: "Rolling back to stable version 3.0.0",
      updatedAt: new Date()
    }
  }
)
```

---

## Update Channels

### Stable (Production)
```javascript
{ update_channel: "stable" }
```
All production clients receive this version.

### Beta (Early Access)
```javascript
{ update_channel: "beta" }
```
Beta testers receive this version.

### Alpha (Internal Testing)
```javascript
{ update_channel: "alpha" }
```
Internal team only.

**Note:** Client must be configured to check the appropriate channel.

---

## Troubleshooting

### Issue: Clients not receiving update
**Check:**
1. Policy is active: `is_active: true`
2. Version comparison is correct (use semantic versioning)
3. Client is checking the correct endpoint
4. MongoDB is accessible from the web server

### Issue: Wrong download URL
**Check:**
1. Platform-specific download exists for the platform/arch combination
2. Fallback `download_url` in policy is correct
3. GitHub release tag matches the version

### Issue: Checksum verification fails
**Check:**
1. SHA-256 checksum is correct (recalculate)
2. Download URL points to the correct file
3. File hasn't been modified after upload

---

## Full Workflow Example

### Scenario: Releasing version 3.2.0

**Step 1: Build and upload clients**
```bash
cd lana-client
npm run build:all
# Upload to GitHub releases
gh release create v3.2.0 dist/*.dmg dist/*.exe dist/*.AppImage
```

**Step 2: Calculate checksums**
```bash
shasum -a 256 dist/LanaAI-3.2.0-arm64.dmg
shasum -a 256 dist/LanaAI-3.2.0-x64.dmg
shasum -a 256 dist/LanaAI-Setup-3.2.0.exe
shasum -a 256 dist/LanaAI-3.2.0-x86_64.AppImage
```

**Step 3: Update MongoDB**
```javascript
// Update global policy
db.client_update_policies_production.updateOne(
  { org_id: "global", is_active: true },
  {
    $set: {
      latest_version: "3.2.0",
      minimum_supported_version: "2.0.0",
      release_notes: "Version 3.2.0:\n- New chat interface\n- Performance improvements\n- Bug fixes",
      download_url: "https://github.com/redroostertech/lana-ai-client/releases/tag/v3.2.0",
      force_update: false,
      updatedAt: new Date()
    }
  }
)

// Add platform-specific downloads
// (insert all 4 platforms as shown above)
```

**Step 4: Test**
```bash
curl -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check \
  -H "Content-Type: application/json" \
  -d '{"client_version":"3.1.0","platform":"darwin","arch":"arm64"}'
```

**Step 5: Monitor**
- Check client update logs
- Monitor download counts
- Watch for error reports

---

## Security Best Practices

1. ✅ Always use HTTPS for download URLs
2. ✅ Always provide SHA-256 checksums
3. ✅ Test updates in beta channel first
4. ✅ Use force_update only for critical security fixes
5. ✅ Keep minimum_supported_version reasonable (don't force too many users to update)
6. ✅ Monitor update success rates
7. ✅ Have a rollback plan ready

---

## API Reference

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/client-updates` | List all policies |
| `POST` | `/api/admin/client-updates` | Create new policy |
| `PUT` | `/api/admin/client-updates/:id` | Update policy |
| `DELETE` | `/api/admin/client-updates/:id` | Delete policy |
| `GET` | `/api/admin/client-downloads` | List platform downloads |
| `POST` | `/api/admin/client-downloads` | Create platform download |
| `PUT` | `/api/admin/client-downloads/:id` | Update platform download |
| `DELETE` | `/api/admin/client-downloads/:id` | Delete platform download |

### Public Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/lana-ai/v1/client/version-check` | Client version check (public) |

---

## Support

For issues or questions:
- Check MongoDB connection: `mongosh "YOUR_MONGO_URI"`
- Test endpoint: `curl -X POST https://www.redroostertec.com/lana-ai/v1/client/version-check`
- Review logs: Check RedRoosterTech-Web application logs

---

## Related Files

- **Route Handler:** `RedRoosterTech-Web/routes/lana-ai.js` (lines 1297-1419)
- **Admin Routes:** `RedRoosterTech-Web/routes/client-updates.js`
- **Models:**
  - `RedRoosterTech-Web/models/ClientUpdatePolicy.js`
  - `RedRoosterTech-Web/models/ClientDownload.js`
- **Client Code:** `lana-client/electron-updater-custom.js`

---

**Document Version:** 1.0
**Last Updated:** 2026-01-16
**Author:** Red Rooster Technologies
