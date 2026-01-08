# VPN Mobile Setup & Product Deployment Guide

**Last Updated:** 2025-12-10
**Version:** 1.0.0

## Table of Contents

1. [Mobile VPN Setup Instructions](#mobile-vpn-setup-instructions)
2. [Product Installation on Mac Studio/Mini](#product-installation-on-mac-studiomini)
3. [Customer Onboarding Process](#customer-onboarding-process)
4. [Complete VPN Flow Documentation](#complete-vpn-flow-documentation)
5. [Edge Cases & Troubleshooting](#edge-cases--troubleshooting)

---

## Mobile VPN Setup Instructions

### Prerequisites
- iPhone or iPad running iOS 15+ or Android device running 10+
- Access to your LanaAI account credentials
- Internet connection (Wi-Fi or cellular)

### Step-by-Step Setup (iOS)

#### Step 1: Install WireGuard App
1. Open the **App Store** on your iPhone/iPad
2. Search for "**WireGuard**"
3. Download and install the **WireGuard** app by WireGuard Development Team
4. Open the app after installation

#### Step 2: Access the VPN Setup Page
1. Open **Safari** on your mobile device
2. Navigate to your organization's thin client login page:
   ```
   https://your-thin-client-url.com/login.html
   ```
3. Enter your **Organization ID** (e.g., "norton", "redrooster-technologies")
4. Click **"Connect to Organization"**

5. If you're connecting from outside the office network, you'll automatically be redirected to:
   ```
   https://your-thin-client-url.com/vpn-setup.html
   ```

#### Step 3: Download Your VPN Configuration
1. On the VPN Setup page, scroll to **Step 2: Download Your VPN Configuration**
2. Enter your **LanaAI email** and **password**
3. Click **"Login & Download VPN Config"**
4. Your browser will download a `.conf` file (e.g., `lana-vpn-you@example.com.conf`)
5. Tap **"Open in..."** or **"Share"** → Choose **WireGuard**

#### Step 4: Import Configuration in WireGuard
1. WireGuard will automatically open and ask to import the tunnel
2. Review the tunnel name (e.g., "LanaAI - you@example.com")
3. Tap **"Add Tunnel"** or **"Allow"**
4. If prompted, authorize WireGuard to add VPN configurations

#### Step 5: Connect to VPN
1. In the WireGuard app, you'll see your imported tunnel
2. Toggle the switch to **ON** (it will turn green)
3. You may see a connection request popup - tap **"Allow"**
4. Look for the **VPN icon** in your status bar (top of screen)

#### Step 6: Test Connection
1. Return to Safari and go back to the login page:
   ```
   https://your-thin-client-url.com/login.html
   ```
2. Enter your organization ID again
3. Click **"Connect to Organization"**
4. You should now successfully connect to the LanaAI server!

#### Step 7: Login to LanaAI
1. Enter your **email** and **password**
2. Click **"Login"**
3. You're now connected remotely via VPN!

---

### Step-by-Step Setup (Android)

#### Step 1: Install WireGuard App
1. Open the **Google Play Store**
2. Search for "**WireGuard**"
3. Download and install **WireGuard** by WireGuard Development Team
4. Open the app after installation

#### Step 2-7: Follow the same steps as iOS
The process is identical to iOS, with the following differences:
- Use **Chrome** or your preferred mobile browser instead of Safari
- When downloading the `.conf` file, tap **"Open with"** → Choose **WireGuard**
- The VPN icon on Android appears in the notification shade

---

### QR Code Setup (Alternative Method)

If your administrator provides a QR code:

1. Open **WireGuard** app
2. Tap the **"+"** button
3. Select **"Scan from QR code"**
4. Point your camera at the QR code
5. Tap **"Add Tunnel"**
6. Toggle the switch to **ON**

---

## Product Installation on Mac Studio/Mini

This section covers deploying LanaAI on a new Mac Studio or Mac Mini for customer sites.

### Hardware Requirements
- **Mac Studio** or **Mac Mini** (M1/M2/M3 or Intel)
- **macOS 13.0 (Ventura)** or later
- **16GB RAM minimum** (32GB recommended for production)
- **512GB SSD minimum** (1TB recommended)
- **Network connection** (Ethernet preferred for server deployment)
- **Static IP address** configured on local network

### Pre-Installation Checklist

- [ ] Mac Studio/Mini is physically installed and powered on
- [ ] Network cable connected (Ethernet)
- [ ] Static IP address assigned (e.g., `10.0.0.3`)
- [ ] Router/firewall configured to allow traffic to static IP
- [ ] Mac is logged in with administrator account
- [ ] macOS is up to date

---

### Installation Steps

#### Step 1: Clone the Repository

```bash
cd ~/Desktop
git clone https://github.com/your-org/LANA-AI.git
cd LANA-AI
```

#### Step 2: Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file
nano .env
```

**Required Environment Variables:**

```bash
# Server Configuration
PORT=8080
NODE_ENV=production
STATIC_IP=10.0.0.3  # Your Mac's static IP

# Database Configuration
DATABASE_URL=postgresql://lana:password@localhost:5432/lanaai
PGUSER=lana
PGPASSWORD=password
PGHOST=localhost
PGPORT=5432
PGDATABASE=lanaai

# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# VPN Configuration (if enabling VPN)
VPN_ENABLED=true
WIREGUARD_ENABLED=true
WIREGUARD_PORT=51820
WIREGUARD_SERVER_ADDRESS=10.100.0.1/24
WIREGUARD_SUBNET=10.100.0.0/24
WIREGUARD_PUBLIC_ENDPOINT=<your-public-ip>:51820  # Your router's public IP
VPN_REQUIRED_FOR_REMOTE=true

# SSL Configuration (optional)
SSL_ENABLED=false
```

#### Step 3: Run Production Setup Script

```bash
# This will configure the Mac for 24/7 server operation
sudo ./scripts/configure-production-settings.sh
```

**This script will:**
- ✓ Disable sleep mode
- ✓ Enable automatic restart after power failure
- ✓ Configure wake on network access
- ✓ Optimize Spotlight indexing
- ✓ Set up automatic login (if needed)
- ✓ Configure energy saver settings

#### Step 4: Deploy the Application

```bash
# Deploy without auto-starting
./deploy-prod-mac.sh
```

**This script will:**
- ✓ Install Homebrew (if not present)
- ✓ Install Node.js, PostgreSQL, MinIO
- ✓ Install WireGuard (if VPN enabled)
- ✓ Set up database and schema
- ✓ Install npm dependencies
- ✓ Configure PM2 for process management
- ✓ Set up PM2 startup script

#### Step 5: Verify Installation

```bash
# Check if all services are running
pm2 status

# Expected output:
# ┌─────┬──────────┬─────────┬─────────┐
# │ id  │ name     │ status  │ restart │
# ├─────┼──────────┼─────────┼─────────┤
# │ 0   │ lana-api │ stopped │ 0       │
# └─────┴──────────┴─────────┴─────────┘

# Check PostgreSQL
psql -U lana -d lanaai -c "SELECT version();"

# Check MinIO
mc alias set local http://localhost:9000 minioadmin minioadmin
mc ls local/
```

#### Step 6: Start the Application

```bash
# Start the application
./run.sh
```

**This script will:**
- ✓ Start all services (PostgreSQL, MinIO, etc.)
- ✓ Start the LanaAI API server via PM2
- ✓ Display logs and status

#### Step 7: Verify Server is Accessible

```bash
# Test health endpoint
curl http://10.0.0.3:8080/api/health/discovery

# Expected response:
# {
#   "status": "healthy",
#   "server": {
#     "version": "1.0.0",
#     "api_version": "v1"
#   },
#   "discovery": {
#     "static_ip": "10.0.0.3",
#     "port": 8080,
#     "is_secure_ssl": false,
#     "vpn": {
#       "enabled": true,
#       "wireguard_endpoint": "203.0.113.42:51820",
#       "subnet": "10.100.0.0/24",
#       ...
#     }
#   },
#   "timestamp": "2025-12-10T12:00:00.000Z"
# }
```

---

### VPN Setup (If Enabled)

If VPN is enabled, you need to configure WireGuard on the Mac:

#### Step 1: Generate Server Keys

```bash
# Run the WireGuard setup helper (if available)
sudo ./scripts/setup-wireguard.sh

# OR manually:
wg genkey | sudo tee /usr/local/etc/wireguard/server_private.key
sudo cat /usr/local/etc/wireguard/server_private.key | wg pubkey | sudo tee /usr/local/etc/wireguard/server_public.key
```

#### Step 2: Configure WireGuard Interface

```bash
# Create wg0.conf
sudo nano /usr/local/etc/wireguard/wg0.conf
```

```ini
[Interface]
Address = 10.100.0.1/24
ListenPort = 51820
PrivateKey = <contents of server_private.key>
PostUp = /usr/sbin/sysctl -w net.inet.ip.forwarding=1
PostDown = /usr/sbin/sysctl -w net.inet.ip.forwarding=0
```

#### Step 3: Enable IP Forwarding

```bash
sudo sysctl -w net.inet.ip.forwarding=1
```

#### Step 4: Configure Router Port Forwarding

On your router, forward UDP port **51820** to your Mac's static IP (`10.0.0.3`).

**Example (varies by router):**
- Protocol: **UDP**
- External Port: **51820**
- Internal IP: **10.0.0.3**
- Internal Port: **51820**

#### Step 5: Start WireGuard

```bash
sudo wg-quick up wg0

# Verify
sudo wg show
```

---

## Customer Onboarding Process

### Overview

When onboarding a new customer, you need to:
1. Create the customer's organization in the database
2. Register the server with the hosted discovery service
3. Create initial user accounts
4. Provide access instructions to the customer

---

### Step 1: Prepare Customer Information

**Required Information:**
- Organization ID (e.g., `norton-estate-planning`)
- Organization Name (e.g., `Norton Estate Planning`)
- Organization Domain (e.g., `norton.lanaai.io`)
- Primary Contact Email
- Server Static IP (e.g., `10.0.0.3`)
- Number of licenses

---

### Step 2: Run Onboarding Script

We have an onboarding script that handles database setup:

```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI

# Prepare onboarding data
nano config/onboarding/onboarding.xlsx
```

**Edit the Excel file with:**
- Organization details
- Initial users (name, email, role)
- License information

**Run the import script:**

```bash
python3 scripts/onboarding/import_excel_onboarding.py \
  --file config/onboarding/onboarding.xlsx \
  --sheet "Norton Estate Planning"
```

**This will:**
- ✓ Create organization in database
- ✓ Create initial users
- ✓ Generate activation codes
- ✓ Export activation codes to `exports/`

---

### Step 3: Register with Hosted Discovery Service

The hosted discovery service at `https://www.redroostertec.com/lana-ai/v1/discovery` needs to know about this organization.

**Add an entry to the discovery database:**

```sql
-- On the hosted discovery server
INSERT INTO organizations (
  org_id,
  org_name,
  domain,
  static_ip,
  port,
  is_secure_ssl,
  is_active,
  vpn_enabled,
  wireguard_endpoint
) VALUES (
  'norton-estate-planning',
  'Norton Estate Planning',
  'norton.lanaai.io',
  '10.0.0.3',
  8080,
  false,
  true,
  true,
  '203.0.113.42:51820'  -- Your router's public IP
);
```

---

### Step 4: Generate VPN Activation Codes (Optional)

If using VPN, you can pre-generate activation codes for users:

```bash
# Generate activation codes
npm run generate-vpn-codes -- --org norton-estate-planning --count 10

# Codes will be saved to:
# exports/activation-codes-norton-estate-planning-YYYYMMDD_HHMMSS.json
```

---

### Step 5: Provide Access Instructions to Customer

**Send an email to the customer with:**

#### For On-Site Access (Same Network)

```
Subject: LanaAI Access Instructions - On-Site

Hi [Customer Name],

Your LanaAI server is now ready! Here's how to access it from your office:

1. Connect to your office Wi-Fi or network
2. Open your thin client or browser
3. Navigate to: http://10.0.0.3:8080
4. Login with your credentials:
   - Email: [user@example.com]
   - Temporary Password: [temp_password]

You'll be prompted to change your password on first login.

Support: [support@redroostertec.com]
```

#### For Remote Access (VPN Required)

```
Subject: LanaAI Remote Access Instructions

Hi [Customer Name],

To access LanaAI remotely, you'll need to set up a VPN connection:

1. Visit the thin client login page:
   https://[your-thin-client-url]/login.html

2. Enter your Organization ID: norton-estate-planning

3. You'll be redirected to VPN setup page

4. Follow the on-screen instructions to:
   - Install WireGuard
   - Download your VPN config
   - Connect to VPN

5. Once connected, return to login page and sign in

Your credentials:
- Email: [user@example.com]
- Temporary Password: [temp_password]

For mobile access, see attached mobile setup guide.

Support: [support@redroostertec.com]
```

---

### Step 6: Verify Customer Can Connect

**Test the complete flow:**

1. **Test On-Site Access:**
   ```bash
   # From the customer's network
   curl http://10.0.0.3:8080/api/health/discovery
   ```

2. **Test Remote Access (VPN):**
   ```bash
   # From outside network (with VPN connected)
   curl http://10.0.0.3:8080/api/health/discovery
   ```

3. **Test Thin Client Discovery:**
   ```bash
   # Test hosted discovery lookup
   curl -X POST https://www.redroostertec.com/lana-ai/v1/discovery \
     -H "Content-Type: application/json" \
     -d '{"org_id": "norton-estate-planning", "domain": "norton.lanaai.io"}'
   ```

   **Expected response:**
   ```json
   {
     "status": "healthy",
     "server": {
       "org_id": "norton-estate-planning",
       "org_name": "Norton Estate Planning"
     },
     "discovery": {
       "static_ip": "10.0.0.3",
       "port": 8080,
       "is_secure_ssl": false,
       "vpn": {
         "enabled": true,
         "wireguard_endpoint": "203.0.113.42:51820",
         ...
       }
     }
   }
   ```

---

## Complete VPN Flow Documentation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Flow                              │
└─────────────────────────────────────────────────────────────────┘

User (Mobile/Desktop) → Thin Client Login Page
                              ↓
                    Enter Organization ID
                              ↓
        ┌──────────────────────────────────────┐
        │ Hosted Discovery Service              │
        │ https://www.redroostertec.com/...    │
        │                                       │
        │ POST /lana-ai/v1/discovery            │
        │ { org_id, domain }                    │
        └──────────────────────────────────────┘
                              ↓
        Returns: { static_ip, port, vpn: {...} }
                              ↓
                ┌─────────────────────────┐
                │  Try to Connect         │
                │  http://10.0.0.3:8080   │
                └─────────────────────────┘
                     ↓            ↓
            ┌────────┘            └─────────┐
       SUCCESS                          FAIL
            ↓                                ↓
      Login Page                    VPN Enabled?
                                         ↓        ↓
                                       YES       NO
                                         ↓        ↓
                              Redirect to     Show Error
                              VPN Setup
                                         ↓
                          ┌──────────────────────────┐
                          │  VPN Setup Page          │
                          │                          │
                          │ 1. Install WireGuard     │
                          │ 2. Login & Download Conf │
                          │ 3. Import to WireGuard   │
                          │ 4. Connect VPN           │
                          │ 5. Test Connection       │
                          └──────────────────────────┘
                                         ↓
                              Return to Login Page
                                         ↓
                                  Login Success!
```

---

### Detailed Flow Steps

#### 1. User Enters Organization ID

**Frontend:** `login.html:317-328`

```javascript
const response = await fetch('https://www.redroostertec.com/lana-ai/v1/discovery', {
  method: 'POST',
  body: JSON.stringify({
    org_id: "norton-estate-planning",
    domain: "norton.lanaai.io"
  })
});
```

#### 2. Discovery Service Returns Server Info

**Response:**

```json
{
  "status": "healthy",
  "server": {
    "org_id": "norton-estate-planning",
    "org_name": "Norton Estate Planning",
    "version": "1.0.0",
    "api_version": "v1"
  },
  "discovery": {
    "static_ip": "10.0.0.3",
    "port": 8080,
    "is_secure_ssl": false,
    "vpn": {
      "enabled": true,
      "wireguard_endpoint": "203.0.113.42:51820",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_networks": ["192.168.100.0/24"],
      "required_for_remote_access": true
    }
  },
  "domain": "norton.lanaai.io",
  "timestamp": "2025-12-10T12:00:00.000Z"
}
```

#### 3. Frontend Extracts VPN Info

**Frontend:** `login.html:356-370`

```javascript
const vpnInfo = data.discovery.vpn || null;

return {
  url: "http://10.0.0.3:8080",
  staticIp: "10.0.0.3",
  port: 8080,
  vpn: vpnInfo  // ← Stored for later use
};
```

#### 4. Frontend Tries to Connect to Server

**Frontend:** `login.html:455`

```javascript
const isReachable = await verifyServer("http://10.0.0.3:8080");
```

**What happens:**
- Makes a GET request to `http://10.0.0.3:8080/api/health/discovery`
- Timeout: 5 seconds
- If successful → Continue to login
- If fails → Check for VPN

#### 5. Server Unreachable → Check for VPN

**Frontend:** `login.html:457-468`

```javascript
if (!isReachable) {
  // Server not reachable - check if VPN is available from discovery
  if (serverInfo.vpn && serverInfo.vpn.enabled) {
    // VPN is available! Redirect to setup page
    const serverInfoEncoded = btoa(JSON.stringify(serverInfo));
    window.location.href = `vpn-setup.html?server=${encodeURIComponent(serverInfoEncoded)}`;
    return;
  }

  // No VPN available - just show error
  throw new Error("Unable to reach server...");
}
```

**Key Insight:** VPN info comes from the **hosted discovery service**, NOT from the local server (which is unreachable).

#### 6. VPN Setup Page Loads

**Frontend:** `vpn-setup.html:137-150`

```javascript
// Parse server info from URL params
const params = new URLSearchParams(window.location.search);
const serverInfoEncoded = params.get('server');
const serverInfo = JSON.parse(atob(serverInfoEncoded));

// Display organization info
document.getElementById('orgName').textContent = serverInfo.orgName;
document.getElementById('serverUrl').textContent = `${serverInfo.staticIp}:${serverInfo.port}`;
```

#### 7. User Logs In and Downloads VPN Config

**Frontend:** `vpn-setup.html:162-228`

```javascript
// Set API base URL (may fail due to network, but we try)
api.baseUrl = serverInfo.url;

// Login
await api.login(email, password);

// Download VPN config
const response = await fetch(`${serverInfo.url}/api/v1/vpn/client-config`, {
  headers: {
    'Authorization': `Bearer ${api.getAccessToken()}`
  }
});

// Download the .conf file
const blob = await response.blob();
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
a.click();
```

**Note:** This step requires that either:
- User is on the same network (can reach server)
- OR they've already connected via VPN once
- OR we provide an alternative auth flow (activation codes, etc.)

**POTENTIAL ISSUE:** If user is off-network and has never connected, they can't authenticate to download the config!

#### 8. Backend Generates VPN Config

**Backend:** `src/services/vpn/routes/vpn.routes.js:37-108`

```javascript
router.get('/client-config', authMiddleware, async (req, res) => {
  // 1. Check if user already has a peer
  let peer = await vpnPeersRepository.getByUserId(userId);

  if (!peer) {
    // 2. Generate new keys
    const clientKeys = await wireguardService.generateKeyPair();

    // 3. Allocate IP
    const clientIp = wireguardService.getNextAvailableIp(allocatedIps);

    // 4. Store in database (with encrypted private key)
    peer = await vpnPeersRepository.create({
      userId,
      vpnIp: clientIp,
      publicKey: clientKeys.publicKey,
      privateKeyEncrypted: encrypt(clientKeys.privateKey)
    });

    // 5. Add to WireGuard server
    await wireguardService.addPeer({
      publicKey: clientKeys.publicKey,
      allowedIp: `${clientIp}/32`
    });
  }

  // 6. Generate client config file
  const configContent = await wireguardService.generateClientConfig({
    userId,
    userEmail,
    clientIp: peer.vpn_ip,
    clientPrivateKey: decrypt(peer.private_key_encrypted),
    clientPublicKey: peer.public_key
  });

  // 7. Send as downloadable file
  res.setHeader('Content-Disposition', `attachment; filename="lana-vpn-${userEmail}.conf"`);
  res.send(configContent);
});
```

#### 9. User Imports Config to WireGuard

**Mobile (iOS/Android):**
- Download triggers "Open in WireGuard"
- WireGuard imports the tunnel
- User toggles switch to connect

**Desktop (macOS/Windows):**
- User opens WireGuard app
- Clicks "Import tunnel(s) from file"
- Selects the downloaded `.conf` file
- Clicks "Activate"

#### 10. User Tests Connection

**Frontend:** `vpn-setup.html:237-258`

```javascript
testConnectionBtn.addEventListener('click', async () => {
  const response = await fetch(`${serverInfo.url}/api/health/discovery`, {
    signal: AbortSignal.timeout(5000)
  });

  if (response.ok) {
    Toast.success('Connection successful!');
  } else {
    Toast.error('Server is not reachable. Ensure VPN is connected.');
  }
});
```

#### 11. User Returns to Login Page

Once VPN is connected, user can:
1. Click "Back to Login"
2. Re-enter organization ID
3. Server verification succeeds (because VPN routes traffic)
4. Login normally

---

## Edge Cases & Troubleshooting

### Edge Case 1: Hosted Discovery Service Down

**Scenario:** User tries to connect, but `redroostertec.com` is unreachable.

**Current Behavior:**
```javascript
// login.html:373-375
if (error.message === 'Failed to fetch') {
  throw new Error('Unable to reach discovery service. Please check your internet connection.');
}
```

**Impact:** User cannot connect at all (even if they know the server IP).

**Potential Solution:** Add a "Manual Entry" option to bypass discovery:
- User clicks "Enter server manually"
- User enters: `http://10.0.0.3:8080`
- System skips discovery and goes straight to server verification

---

### Edge Case 2: Server Down (Not VPN Issue)

**Scenario:** VPN is connected, but the LanaAI server is actually offline.

**Current Behavior:**
```javascript
// vpn-setup.html:247-257
const response = await fetch(`${serverInfo.url}/api/health/discovery`);
if (response.ok) {
  Toast.success('Connection successful!');
} else {
  Toast.error('Server is not reachable.');
}
```

**Impact:** User thinks VPN is broken, but server is just down.

**Potential Solution:** Provide more specific error messages:
- "VPN connected, but server is offline"
- "Contact your administrator"

---

### Edge Case 3: User Off-Network, Never Connected Before

**Scenario:** New user is trying to access from home (off-network), has never logged in before.

**Current Behavior:**
- User is redirected to VPN setup page
- User enters credentials
- **Login fails** because user can't reach server to authenticate!

**Impact:** Chicken-and-egg problem - need VPN to login, but need to login to get VPN config.

**Potential Solutions:**

**Option A: Activation Codes**
- Admin pre-generates activation codes
- User enters activation code instead of logging in
- System generates VPN config based on activation code
- No authentication required

**Option B: Hosted VPN Config Generation**
- Move VPN config generation to hosted service
- User authenticates with hosted service (which is reachable)
- Hosted service generates config and returns it

**Option C: Ship VPN Configs**
- Pre-generate VPN configs during onboarding
- Email configs to users
- Users import configs manually

---

### Edge Case 4: VPN Config Already Exists (Re-Download)

**Scenario:** User downloads VPN config, but loses it and needs to download again.

**Current Behavior:**
```javascript
// vpn.routes.js:51
let peer = await vpnPeersRepository.getByUserId(userId);

if (!peer) {
  // Generate new peer
} else {
  // Use existing peer
}
```

**Impact:** ✅ Works correctly! Existing peer is reused, same config regenerated.

---

### Edge Case 5: Multiple Devices for Same User

**Scenario:** User wants VPN on both phone and laptop.

**Current Behavior:** Each download reuses the same peer (same private key).

**Impact:** ⚠️ Both devices use the same WireGuard identity. This works, but:
- WireGuard connections may conflict
- Can't distinguish devices in logs

**Potential Solution:**
- Allow multiple peers per user
- Add "device name" to VPN config request
- Each device gets its own IP and keys

---

### Edge Case 6: User on VPN but Wrong Network

**Scenario:** User connects VPN but can't reach server (firewall, routing issue).

**Current Behavior:**
```javascript
const isReachable = await verifyServer(serverInfo.url);
// Returns false
```

**Impact:** User is confused - VPN shows "Connected" but login fails.

**Potential Solution:**
- Test VPN connectivity specifically
- "VPN connected, but can't reach server. Check your network configuration."

---

### Edge Case 7: WireGuard Not Installed

**Scenario:** User tries to import config but doesn't have WireGuard installed.

**Current Behavior:** Browser downloads `.conf` file, but nothing happens.

**Impact:** User is stuck.

**Potential Solution:**
- Detect if WireGuard is not installed
- Show prominent "Install WireGuard first!" message
- Provide direct download links

---

## Troubleshooting Commands

### Check if Services are Running

```bash
# Check PM2 status
pm2 status

# Check PostgreSQL
pg_isready -h localhost -p 5432

# Check MinIO
curl http://localhost:9000/minio/health/live

# Check LanaAI server
curl http://localhost:8080/api/health
```

### Check WireGuard Status

```bash
# Check if WireGuard interface is up
sudo wg show

# Expected output:
# interface: wg0
#   public key: <server_public_key>
#   private key: (hidden)
#   listening port: 51820
#
# peer: <client_public_key>
#   endpoint: <client_ip>:<port>
#   allowed ips: 10.100.0.10/32
#   latest handshake: 1 minute ago
#   transfer: 2.50 MiB received, 1.20 MiB sent
```

### Check Network Connectivity

```bash
# From client device (with VPN connected)
ping 10.100.0.1  # VPN gateway
ping 10.0.0.3    # LanaAI server

# Test HTTP connectivity
curl http://10.0.0.3:8080/api/health/discovery
```

### View Logs

```bash
# PM2 logs
pm2 logs lana-api

# System logs (macOS)
log show --predicate 'process == "node"' --last 1h

# PostgreSQL logs
tail -f /usr/local/var/log/postgresql@17.log

# WireGuard logs (macOS)
sudo log show --predicate 'subsystem == "com.apple.networking"' --last 1h | grep wireguard
```

---

## Summary

### What We Have ✅

1. **Thin Client Discovery Flow**
   - ✅ Hosted discovery service returns static IP + VPN info
   - ✅ Frontend extracts VPN config from discovery response
   - ✅ Frontend redirects to VPN setup if server unreachable

2. **VPN Setup Page**
   - ✅ Step-by-step instructions
   - ✅ Login and download config
   - ✅ Test connection button

3. **Backend VPN API**
   - ✅ Generate WireGuard key pairs
   - ✅ Allocate IPs
   - ✅ Create peer configs
   - ✅ Download `.conf` files

4. **Server Discovery Endpoint**
   - ✅ Returns VPN info if enabled
   - ✅ Includes wireguard_endpoint, subnet, dns

### What Needs Attention ⚠️

1. **Chicken-and-Egg Problem**
   - ⚠️ New users off-network can't authenticate to download VPN config
   - 💡 Solution: Implement activation codes OR hosted config generation

2. **Multiple Devices per User**
   - ⚠️ Same VPN config reused for all devices
   - 💡 Solution: Allow multiple peers per user

3. **Better Error Messages**
   - ⚠️ Generic "can't reach server" messages
   - 💡 Solution: Distinguish VPN issues from server issues

4. **Manual Server Entry**
   - ⚠️ No fallback if discovery service is down
   - 💡 Solution: Add "Enter server manually" option

---

## Next Steps

1. **Test the complete flow from mobile device**
2. **Deploy to a test Mac Studio/Mini**
3. **Onboard a test customer**
4. **Address chicken-and-egg problem**
5. **Add better error handling and user feedback**

---

**Questions? Issues?**
Contact: support@redroostertec.com
