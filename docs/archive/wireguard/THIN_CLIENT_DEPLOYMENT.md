# LANA AI Thin Client Deployment Architecture

## Overview

This document describes the deployment architecture for the LANA AI thin client (Electron app) and how it connects to customer-specific Mac Studio servers (Chef devices). The architecture supports:

- **Zero-configuration setup** for end users via network auto-discovery
- **Per-customer update control** via server-managed update policies
- **Secure VPN-based access** for all deployments

---

## Table of Contents

1. [Deployment Model](#deployment-model)
2. [Network Architecture](#network-architecture)
3. [Auto-Discovery Mechanism](#auto-discovery-mechanism)
4. [Client Connection Flow](#client-connection-flow)
5. [Update Management](#update-management)
6. [Implementation Details](#implementation-details)
7. [Setup Procedures](#setup-procedures)

---

## Deployment Model

### Components

| Component | Description | Location |
|-----------|-------------|----------|
| **Chef (Mac Studio)** | Server running LANA AI backend, database, AI services | Customer premises (one per customer) |
| **Thin Client** | Electron app providing UI | User's laptop/desktop |
| **VPN** | Secure network tunnel | Customer-provided or WireGuard |

### Key Principles

1. **One Chef per customer** - Each law firm has their own Mac Studio server
2. **One universal thin client** - Same Electron app for all customers
3. **VPN required** - Users must be on VPN to access their Chef
4. **Zero user configuration** - Client auto-discovers server on network

---

## Network Architecture

### Scenario A: Customer Has Existing VPN

When the customer already has VPN infrastructure (Cisco, OpenVPN, etc.):

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer Network                                               │
│                                                                 │
│  ┌──────────────────┐         ┌─────────────────────────────┐  │
│  │ Customer's VPN   │         │ Mac Studio (Chef)           │  │
│  │ Infrastructure   │◄───────►│ Static IP: 10.x.x.x         │  │
│  │ (Cisco, etc.)    │         │ Port: 8080                  │  │
│  └────────┬─────────┘         │ Bonjour: _lana._tcp         │  │
│           │                   └─────────────────────────────┘  │
│           │                                                     │
│  ┌────────┴─────────────────────────────────────────────────┐  │
│  │                    VPN Network                            │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │  │
│  │  │ User 1  │  │ User 2  │  │ User 3  │  │ User N  │     │  │
│  │  │ Laptop  │  │ Laptop  │  │ Desktop │  │ Device  │     │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Setup Steps:**
1. Customer IT assigns static IP to Mac Studio on their VPN network
2. Mac Studio configured with assigned IP during initial setup
3. Users connect to customer VPN as they normally would
4. Thin client auto-discovers Mac Studio via Bonjour

### Scenario B: Customer Has No VPN (WireGuard Deployment)

When the customer lacks VPN infrastructure, we deploy WireGuard:

```
┌─────────────────────────────────────────────────────────────────┐
│  WireGuard VPN Network (We Configure)                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Mac Studio (Chef)                                        │   │
│  │ ┌─────────────────┐  ┌────────────────────────────────┐ │   │
│  │ │ LANA AI Server  │  │ WireGuard Server               │ │   │
│  │ │ Port: 8080      │  │ Public IP: x.x.x.x             │ │   │
│  │ │                 │  │ VPN Subnet: 10.100.0.0/24      │ │   │
│  │ └─────────────────┘  │ Server IP: 10.100.0.1          │ │   │
│  │                      └────────────────────────────────┘ │   │
│  └──────────────────────────────────────┬──────────────────┘   │
│                                         │                       │
│  ┌──────────────────────────────────────┴───────────────────┐  │
│  │                 WireGuard Tunnel                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
│  │  │ User 1      │  │ User 2      │  │ User N      │       │  │
│  │  │ 10.100.0.2  │  │ 10.100.0.3  │  │ 10.100.0.x  │       │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Setup Steps:**
1. Install WireGuard on Mac Studio during initial setup
2. Configure WireGuard server with VPN subnet (e.g., 10.100.0.0/24)
3. Generate WireGuard config files for each user
4. Users install WireGuard client and import their config
5. Thin client auto-discovers Mac Studio via Bonjour over WireGuard tunnel

---

## Auto-Discovery Mechanism

### Primary: Bonjour/mDNS (Zero-Config)

The Mac Studio advertises itself on the local network using Bonjour (Apple's implementation of mDNS/DNS-SD).

**Service Advertisement:**
```
Service Type: _lana._tcp
Service Name: LANA AI - [Organization Name]
Port: 8080
TXT Record:
  - org_id=[organization-id]
  - org_name=[Organization Name]
  - version=[server-version]
  - api_version=[api-version]
```

**How Discovery Works:**
1. Thin client broadcasts mDNS query for `_lana._tcp` services
2. Mac Studio responds with its service information
3. Client receives: hostname, IP, port, organization info
4. Client displays found server(s) to user

### Fallback: Direct Health Check

If mDNS doesn't traverse the VPN (some VPN configurations block multicast):

1. Client queries known subnet ranges for LANA servers
2. Attempts connection to `http://[ip]:8080/api/health`
3. Health endpoint returns server identity if LANA is running

**Health Endpoint Response:**
```json
{
  "status": "healthy",
  "server": {
    "org_id": "smith-law-2024",
    "org_name": "Smith & Associates",
    "version": "1.0.0",
    "api_version": "v1"
  },
  "discovery": {
    "bonjour_name": "LANA AI - Smith & Associates",
    "static_ip": "100.64.0.26",
    "port": 8080
  }
}
```

### Fallback: Manual Connection

As a last resort, admin can provide:
- **QR Code** - Scanned by thin client camera
- **Invite Link** - `lana://connect/[encoded-config]`
- **Connection Code** - Short alphanumeric code (e.g., `SMITH-7X9K`)

---

## Client Connection Flow

### First Launch (New Installation)

```
┌─────────────────────────────────────────────────────────────────┐
│                        FIRST LAUNCH                             │
│                                                                 │
│  ┌─────────────────┐                                           │
│  │  App Starts     │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐     No      ┌────────────────────────┐   │
│  │ Check local     │────────────►│ Start network          │   │
│  │ storage for     │             │ discovery (Bonjour)    │   │
│  │ saved server    │             └───────────┬────────────┘   │
│  └─────────────────┘                         │                 │
│           │ Yes                              ▼                 │
│           │                    ┌─────────────────────────┐     │
│           ▼                    │ Server(s) found?        │     │
│  ┌─────────────────┐           └───────────┬─────────────┘     │
│  │ Connect to      │                Yes    │    No             │
│  │ saved server    │◄──────────────────────┘    │              │
│  └────────┬────────┘                            ▼              │
│           │                    ┌─────────────────────────┐     │
│           │                    │ Show manual connection  │     │
│           │                    │ options (QR/Code/URL)   │     │
│           │                    └─────────────────────────┘     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │ Show Login      │                                           │
│  │ Screen          │                                           │
│  └─────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Discovery UI

**Single Server Found:**
```
┌────────────────────────────────────────┐
│                                        │
│      LANA AI Server Found              │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  Smith & Associates              │  │
│  │  100.64.0.26:8080                │  │
│  └──────────────────────────────────┘  │
│                                        │
│            [ Connect ]                 │
│                                        │
└────────────────────────────────────────┘
```

**Multiple Servers Found (rare edge case):**
```
┌────────────────────────────────────────┐
│                                        │
│    Select Your LANA AI Server          │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ ○ Smith & Associates             │  │
│  │   100.64.0.26:8080               │  │
│  ├──────────────────────────────────┤  │
│  │ ○ Johnson Legal Group            │  │
│  │   100.64.0.50:8080               │  │
│  └──────────────────────────────────┘  │
│                                        │
│            [ Connect ]                 │
│                                        │
└────────────────────────────────────────┘
```

### Persistent Storage

After successful connection, client stores server info locally:

**Storage Location:** `~/Library/Application Support/Lana AI Client/`

**Stored Data:**
```json
{
  "server": {
    "url": "http://100.64.0.26:8080",
    "org_id": "smith-law-2024",
    "org_name": "Smith & Associates"
  },
  "connected_at": "2025-12-05T10:30:00Z",
  "last_verified": "2025-12-05T14:22:00Z"
}
```

This persists across:
- App restarts
- App updates (OTA updates)
- System reboots

---

## Update Management

### Architecture

Updates are controlled **per-customer** through their Mac Studio server:

```
┌────────────────────────────────────────────────────────────────┐
│                     UPDATE FLOW                                │
│                                                                │
│  ┌──────────────┐                      ┌────────────────────┐ │
│  │ Thin Client  │                      │ GitHub Releases    │ │
│  │              │                      │ (All Versions)     │ │
│  └──────┬───────┘                      └─────────▲──────────┘ │
│         │                                        │             │
│         │ 1. "What version can I run?"           │             │
│         ▼                                        │             │
│  ┌──────────────────────────┐                   │             │
│  │ Customer's Mac Studio    │                   │             │
│  │ (Chef)                   │                   │             │
│  │                          │    3. Download    │             │
│  │ Update Policy:           │       update      │             │
│  │ - allowed_version: 1.2.0 │───────────────────┘             │
│  │ - channel: stable        │                                 │
│  └──────────────────────────┘                                 │
│         │                                                      │
│         │ 2. "You can update to 1.2.0"                        │
│         ▼                                                      │
│  ┌──────────────┐                                             │
│  │ Client       │                                             │
│  │ downloads    │                                             │
│  │ & installs   │                                             │
│  └──────────────┘                                             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Update Policy Endpoint

Each Mac Studio exposes an endpoint for update policy:

**Endpoint:** `GET /api/client/update-policy`

**Response:**
```json
{
  "current_client_version": "1.1.0",
  "allowed_client_version": "1.2.0",
  "update_required": false,
  "update_available": true,
  "channel": "stable",
  "release_notes": "Bug fixes and performance improvements",
  "download_url": "https://github.com/org/repo/releases/download/v1.2.0/lana-client-1.2.0.dmg",
  "checksum": "sha256:abc123..."
}
```

### Update Scenarios

| Scenario | Server Config | Result |
|----------|---------------|--------|
| Normal update | `allowed_version: 1.3.0` | Client updates to 1.3.0 |
| Hold back customer | `allowed_version: 1.2.0` | Client stays on 1.2.0 even if 1.3.0 exists |
| Force update | `update_required: true` | Client must update before continuing |
| Beta testing | `channel: beta` | Client gets beta releases |

### Admin Configuration

On the Mac Studio admin panel:

```
┌─────────────────────────────────────────────────────────────┐
│  Client Update Settings                                     │
│                                                             │
│  Current Released Version: 1.3.0                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Allowed Client Version                              │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ 1.2.0                                     [▼]   │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │ ○ Allow all versions up to selected                 │   │
│  │ ● Pin to exact version                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Update Channel                                      │   │
│  │ ○ Stable (recommended)                              │   │
│  │ ○ Beta (early access to new features)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [ ] Require users to update (force update)                │
│                                                             │
│                              [ Save Settings ]              │
└─────────────────────────────────────────────────────────────┘
```

### GitHub Release Configuration

**electron-builder.client.json** publish config:
```json
{
  "publish": {
    "provider": "github",
    "owner": "your-org",
    "repo": "lana-ai-client",
    "releaseType": "release"
  }
}
```

**Release Process:**
1. Tag new version in git
2. GitHub Actions builds and publishes to Releases
3. Each customer's Mac Studio can be configured to allow the new version
4. Staged rollout: Enable for beta customers first, then all customers

---

## Implementation Details

### Server Side (Mac Studio)

#### 1. Bonjour Service Advertisement

**File:** `src/services/bonjour.js`

```javascript
const bonjour = require('bonjour')();

function startBonjourAdvertisement(config) {
  const service = bonjour.publish({
    name: `LANA AI - ${config.orgName}`,
    type: 'lana',
    port: config.port,
    txt: {
      org_id: config.orgId,
      org_name: config.orgName,
      version: config.version,
      api_version: 'v1'
    }
  });

  service.on('up', () => {
    console.log(`Bonjour service published: LANA AI - ${config.orgName}`);
  });

  return service;
}
```

#### 2. Health/Discovery Endpoint

**File:** `src/routes/health.js`

```javascript
router.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: {
      org_id: config.orgId,
      org_name: config.orgName,
      version: pkg.version,
      api_version: 'v1'
    },
    discovery: {
      bonjour_name: `LANA AI - ${config.orgName}`,
      static_ip: config.staticIp,
      port: config.port
    }
  });
});
```

#### 3. Update Policy Endpoint

**File:** `src/routes/client-updates.js`

```javascript
router.get('/api/client/update-policy', authenticate, (req, res) => {
  const policy = getUpdatePolicy(); // From database/config

  res.json({
    current_client_version: req.headers['x-client-version'],
    allowed_client_version: policy.allowedVersion,
    update_required: policy.forceUpdate,
    update_available: semver.gt(policy.allowedVersion, req.headers['x-client-version']),
    channel: policy.channel,
    download_url: getDownloadUrl(policy.allowedVersion),
    checksum: getChecksum(policy.allowedVersion)
  });
});
```

### Client Side (Electron)

#### 1. Network Discovery

**File:** `electron-discovery.js`

```javascript
const bonjour = require('bonjour')();

function discoverLanaServers() {
  return new Promise((resolve) => {
    const servers = [];

    const browser = bonjour.find({ type: 'lana' }, (service) => {
      servers.push({
        name: service.name,
        host: service.host,
        port: service.port,
        orgId: service.txt.org_id,
        orgName: service.txt.org_name
      });
    });

    // Stop searching after 5 seconds
    setTimeout(() => {
      browser.stop();
      resolve(servers);
    }, 5000);
  });
}
```

#### 2. Connection Storage

**File:** `electron-storage.js`

```javascript
const Store = require('electron-store');

const store = new Store({
  name: 'server-config',
  encryptionKey: 'your-encryption-key' // Encrypt sensitive data
});

function saveServerConnection(server) {
  store.set('server', {
    url: `http://${server.host}:${server.port}`,
    orgId: server.orgId,
    orgName: server.orgName,
    connectedAt: new Date().toISOString()
  });
}

function getSavedServer() {
  return store.get('server');
}

function clearSavedServer() {
  store.delete('server');
}
```

#### 3. Update Checker

**File:** `electron-updater-custom.js`

```javascript
const { autoUpdater } = require('electron-updater');

async function checkForUpdates(serverUrl) {
  // First, check with our server what version we're allowed to run
  const response = await fetch(`${serverUrl}/api/client/update-policy`, {
    headers: {
      'x-client-version': app.getVersion(),
      'Authorization': `Bearer ${getAuthToken()}`
    }
  });

  const policy = await response.json();

  if (!policy.update_available) {
    return { updateAvailable: false };
  }

  if (policy.update_required) {
    // Force update - block app until updated
    return { updateAvailable: true, required: true, version: policy.allowed_client_version };
  }

  // Optional update available
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'your-org',
    repo: 'lana-ai-client'
  });

  // Only update to the version our server allows
  autoUpdater.allowDowngrade = false;

  return autoUpdater.checkForUpdates();
}
```

#### 4. Main Process Integration

**File:** `electron-main.js` (additions)

```javascript
const { discoverLanaServers } = require('./electron-discovery');
const { getSavedServer, saveServerConnection } = require('./electron-storage');
const { checkForUpdates } = require('./electron-updater-custom');

app.whenReady().then(async () => {
  // Check for saved server first
  const savedServer = getSavedServer();

  if (savedServer) {
    // Verify server is still reachable
    const isReachable = await verifyServer(savedServer.url);
    if (isReachable) {
      createMainWindow(savedServer.url);
      checkForUpdates(savedServer.url);
      return;
    }
  }

  // No saved server or unreachable - start discovery
  createDiscoveryWindow();
});

ipcMain.handle('discover-servers', async () => {
  return await discoverLanaServers();
});

ipcMain.handle('connect-to-server', async (event, server) => {
  saveServerConnection(server);
  createMainWindow(`http://${server.host}:${server.port}`);
});
```

---

## Setup Procedures

### New Customer Deployment Checklist

#### Pre-Deployment

- [ ] Determine VPN scenario (customer VPN or WireGuard)
- [ ] Obtain static IP assignment for Mac Studio
- [ ] Prepare organization configuration (org_id, org_name)
- [ ] Generate WireGuard configs if needed

#### Mac Studio Setup

1. **Initial OS Setup**
   - [ ] Configure macOS with admin account
   - [ ] Enable SSH for remote management
   - [ ] Configure static IP or DHCP reservation

2. **VPN Configuration**

   *If customer VPN:*
   - [ ] Install customer's VPN client if needed
   - [ ] Configure static IP on VPN interface

   *If WireGuard:*
   - [ ] Install WireGuard: `brew install wireguard-tools`
   - [ ] Generate server keys: `wg genkey | tee privatekey | wg pubkey > publickey`
   - [ ] Configure `/etc/wireguard/wg0.conf`
   - [ ] Enable WireGuard service
   - [ ] Generate client configs for each user

3. **LANA AI Server Setup**
   - [ ] Clone/install LANA AI server
   - [ ] Configure environment variables
   - [ ] Set organization details in config
   - [ ] Configure update policy settings
   - [ ] Start services
   - [ ] Verify Bonjour advertisement: `dns-sd -B _lana._tcp`

4. **Verification**
   - [ ] Test health endpoint: `curl http://[ip]:8080/api/health`
   - [ ] Test Bonjour from another device on network
   - [ ] Test thin client auto-discovery

#### User Onboarding

1. **VPN Access**
   - Provide VPN credentials/config to user
   - Verify user can connect to VPN

2. **Thin Client Installation**
   - User downloads LANA AI Client from distribution point
   - User installs application
   - User connects to VPN
   - User launches app - server auto-discovered
   - User logs in with their credentials

---

## Development & Debugging

### Running in Development Mode

To run the Electron client locally with Chrome DevTools enabled:

```bash
# First time setup (rebuilds native modules for Electron)
npm install && npm run electron:rebuild

# Run with DevTools open
npm run electron:dev
```

This enables:
- **Chrome DevTools**: Automatically opens on launch for debugging
- **Debug logging**: Enhanced console output
- **Network inspection**: Monitor API calls to the backend

**Note:** The backend server must be running for the client to connect. The Electron client is a thin client that connects to a remote LanaAI server.

### CommonJS Compatibility

Several dependencies are pinned to specific versions to maintain CommonJS compatibility with Electron's Node.js environment:

| Package | Version | Reason |
|---------|---------|--------|
| `pg-boss` | ^9.0.3 | v10+ is ESM-only |
| `uuid` | ^9.0.1 | v10+ is ESM-only |
| `dotenv` | ^16.4.5 | v17+ is ESM-only |
| `zod` | ^3.23.8 | v4+ is ESM-only |

**Do not upgrade these packages** beyond the specified major versions without testing Electron compatibility. ESM-only packages will cause `ERR_REQUIRE_ESM` errors at runtime.

### Native Module Rebuilding

Native modules (like `bcrypt`) must be rebuilt for Electron's architecture:

```bash
# Rebuild native modules for Electron
npm run electron:rebuild
```

Run this command:
- After `npm install`
- When switching between server dev (`npm run dev`) and Electron dev
- If you see architecture mismatch errors (e.g., "incompatible architecture")

### Debugging Tips

1. **Inspect network requests**: Use DevTools Network tab to see API calls
2. **Check console errors**: View JavaScript errors in DevTools Console
3. **Bonjour discovery**: Watch for discovery events in console logs
4. **Storage inspection**: Use DevTools Application tab to inspect electron-store data

---

## Troubleshooting

### Client Can't Find Server

1. **Verify VPN connection**
   - User must be connected to VPN
   - Check VPN IP assignment

2. **Verify Bonjour is working**
   - On Mac Studio: `dns-sd -B _lana._tcp`
   - Check firewall isn't blocking mDNS (port 5353 UDP)

3. **Try direct connection**
   - Manually enter server URL in client settings
   - Check `http://[server-ip]:8080/api/health`

### Updates Not Working

1. **Check update policy**
   - Verify server's update policy endpoint
   - Check `allowed_client_version` setting

2. **Check GitHub releases**
   - Verify release exists for allowed version
   - Check release assets include correct platform

3. **Check code signing (macOS)**
   - Updates require signed/notarized builds
   - Verify certificate validity

---

## Security Considerations

1. **VPN Required**: All traffic between client and server traverses VPN tunnel
2. **No Public Exposure**: Mac Studio never exposed to public internet
3. **Encrypted Storage**: Client stores server config with encryption
4. **Authentication**: All API calls require valid JWT after login
5. **Update Verification**: Updates verified via checksum before installation
6. **Code Signing**: Electron builds signed and notarized for macOS

---

## Future Enhancements

- [ ] QR code generation for manual server connection
- [ ] Deep link support (`lana://connect/...`)
- [ ] Multi-server support (for users at multiple firms)
- [ ] Offline mode with sync on reconnection
- [ ] Automatic VPN connection from within client
