# LANA-AI VPN Implementation Guide

## Overview

This document describes the optional WireGuard VPN implementation for LANA-AI. The VPN feature enables secure remote access to LANA-AI Chef servers deployed on customer networks.

## Architecture

### Network Topology: VPN as Network Extender

The VPN is designed as a **network extender** that routes remote users into the customer's local network. This means:

- **One static IP** for all users (no separate VPN network)
- **Seamless switching** between on-network and remote access
- **Simple configuration** with minimal Chef server updates

```
Local Network: 192.168.100.0/24
├─ Mac Studio (Chef): 192.168.100.50:8080
├─ On-site users: Direct connection ✓
└─ WireGuard Server
       │
       │ Public: 203.0.113.42:51820
       │ Routes: 192.168.100.0/24 through VPN
       │
       └─ Remote users → VPN tunnel → 192.168.100.50:8080 ✓
```

### Key Benefits

✅ **Single API URL** (`http://192.168.100.50:8080`) works for all users
✅ **No multi-path detection** needed in thin client
✅ **Backwards compatible** - existing deployments unchanged
✅ **Low maintenance** - minimal Chef server redeployment

---

## Implementation Components

### 1. Backend (Chef Server)

#### Configuration Files

**`src/config/vpn.config.js`**
- VPN feature toggles
- WireGuard server configuration
- Network settings (subnet, DNS, ports)
- Client IP allocation ranges

**`src/config/features.config.js`**
- System-level feature flags
- Centralized feature availability management
- Supports hierarchical feature enablement

#### Database Schema

**Migration: `src/migrations/add_vpn_configuration.sql`**
- Adds VPN configuration to `organizations.settings` JSONB column
- Creates helper functions for VPN management:
  - `get_org_vpn_config(org_id)`
  - `update_org_vpn_config(org_id, config)`
  - `is_vpn_enabled(org_id)`
  - `get_org_features(org_id)`
  - `update_org_features(org_id, features)`

**Table: `vpn_peers`**
- Tracks VPN access per user
- Stores encrypted private keys
- Manages IP allocations
- Records connection status

#### Services

**`src/services/vpn/services/wireguard.service.js`**
- WireGuard key generation
- Server initialization
- Client config generation
- Peer management (add/remove)
- Interface control (start/stop/status)

**`src/services/vpn/repositories/vpn-peers.repository.js`**
- Database operations for VPN peers
- IP allocation tracking
- User access management

#### API Routes

**`src/services/vpn/routes/vpn.routes.js`**

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/vpn/client-config` | GET | Required | Download user's VPN config |
| `/api/v1/vpn/status` | GET | Required | Check user's VPN status |
| `/api/v1/vpn/revoke` | DELETE | Required | Revoke user's VPN access |
| `/api/v1/vpn/server-status` | GET | Required | Get WireGuard server status |
| `/api/v1/vpn/peers` | GET | Required | List organization's VPN peers |

#### Discovery Endpoint Updates

**`src/services/health/routes/health.routes.js`**

Updated `/api/health/discovery` to include VPN info when enabled:

```javascript
{
  "status": "healthy",
  "server": { "version": "1.0.2", "api_version": "v1" },
  "discovery": {
    "static_ip": "192.168.100.50",
    "port": 8080,
    "vpn": {  // Only present when VPN enabled
      "enabled": true,
      "required_for_remote_access": true,
      "public_endpoint": "203.0.113.42:51820",
      "server_public_key": "base64...",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "installer_url": "/downloads/wireguard-installer.pkg",
      "config_url": "/api/v1/vpn/client-config"
    }
  },
  "timestamp": "2025-12-09T..."
}
```

---

### 2. Frontend (Thin Client)

#### VPN Setup Page

**`public_html/vpn-setup.html`**
- Guided VPN setup wizard
- WireGuard installer downloads
- Inline authentication for config download
- Connection testing
- Step-by-step instructions

#### Login Flow Updates

**`public_html/login.html`**
- Detects VPN requirements from discovery endpoint
- Automatically redirects to VPN setup page when needed
- Seamless fallback for users without VPN

**Logic:**
```javascript
// Try to connect to server
const verifyResult = await verifyServer(apiUrl);

if (!verifyResult.reachable && verifyResult.vpnRequired) {
  // Redirect to VPN setup page
  window.location.href = 'vpn-setup.html?server=...';
}
```

---

### 3. Setup Scripts

#### WireGuard Installation Script

**`scripts/setup-wireguard.sh`**

```bash
sudo ./scripts/setup-wireguard.sh
```

**What it does:**
1. Checks for Homebrew and WireGuard
2. Installs WireGuard if needed
3. Generates server keys
4. Creates server configuration
5. Configures IP forwarding
6. Updates `.env` with VPN settings

**Output:**
- Server keys: `/usr/local/etc/wireguard/server_*.key`
- Config file: `/usr/local/etc/wireguard/wg0.conf`
- Updated `.env` with VPN variables

---

## Deployment Guide

### Prerequisites

- Mac Studio/Mini with macOS
- Static IP address assigned (local network or public)
- Firewall access for UDP port 51820
- Homebrew installed

### Step 1: Install WireGuard

```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI
sudo ./scripts/setup-wireguard.sh
```

### Step 2: Configure .env

Edit `.env` and set:

```bash
# Required: Your public IP or domain
WIREGUARD_PUBLIC_ENDPOINT=203.0.113.42:51820

# Enable VPN
VPN_ENABLED=true
WIREGUARD_ENABLED=true

# Optional: Customize subnet and DNS
WIREGUARD_SUBNET=10.100.0.0/24
WIREGUARD_DNS=10.100.0.1

# Optional: Customize local networks accessible through VPN
WIREGUARD_ALLOWED_LOCAL_NETWORKS=192.168.100.0/24
```

### Step 3: Run Database Migration

```bash
# Run migration to add VPN schema
psql -d lana_chef -f src/migrations/add_vpn_configuration.sql
```

Or if using the migration system:
```bash
npm run migrate
```

### Step 4: Start WireGuard Server

```bash
sudo wg-quick up wg0
```

To start on boot (macOS):
```bash
sudo cp /usr/local/etc/wireguard/wg0.conf /Library/LaunchDaemons/
# Create LaunchDaemon plist (manual step)
```

### Step 5: Enable IP Forwarding

**⚠️ CRITICAL**: IP forwarding must be enabled for VPN to route traffic between VPN clients and your local network.

```bash
# Check current setting
sysctl net.inet.ip.forwarding

# Enable IP forwarding
sudo sysctl -w net.inet.ip.forwarding=1
```

**Make it permanent** (survives reboots):

```bash
# Create sysctl configuration
sudo tee /etc/sysctl.conf > /dev/null <<EOF
# Enable IP forwarding for WireGuard VPN
net.inet.ip.forwarding=1
EOF
```

**Why this is required:**
- macOS disables IP forwarding by default for security
- Without it, VPN clients can connect but cannot access network resources
- IP forwarding allows routing between VPN subnet (10.100.0.0/24) and local network
- The `sysctl -w` command is temporary; /etc/sysctl.conf makes it permanent

### Step 6: Configure Firewall

Allow UDP port 51820:

```bash
# macOS built-in firewall
sudo pfctl -e
# Add rule to /etc/pf.conf
echo "pass in proto udp from any to any port 51820" | sudo tee -a /etc/pf.conf
sudo pfctl -f /etc/pf.conf
```

### Step 7: Restart LANA-AI Chef

```bash
pm2 restart lana-chef
```

Verify VPN is enabled:
```bash
curl http://localhost:8080/api/health/discovery | jq .discovery.vpn
```

---

## User Experience Flow

### Scenario 1: User in Office (On Local Network)

1. User opens LANA-AI thin client
2. Connects directly to `http://192.168.100.50:8080`
3. No VPN needed ✓

### Scenario 2: User at Home (Remote)

1. User opens LANA-AI thin client
2. Thin client tries to connect → **fails** (not on local network)
3. Discovery endpoint indicates VPN required
4. **Automatically redirected to VPN setup page**
5. User downloads WireGuard installer
6. User logs in to download personal VPN config
7. User imports config into WireGuard
8. User activates VPN connection
9. VPN routes `192.168.100.0/24` traffic through tunnel
10. User returns to login page
11. Connects successfully to `http://192.168.100.50:8080` ✓

### Scenario 3: Seamless Switching

- User starts at office → connected via local network
- User goes home → opens laptop
- Thin client detects connection failure
- User connects VPN
- **Same URL still works** (`192.168.100.50:8080`)
- No configuration changes needed

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VPN_ENABLED` | `false` | Enable VPN feature |
| `WIREGUARD_ENABLED` | `false` | Enable WireGuard specifically |
| `WIREGUARD_INTERFACE` | `wg0` | Interface name |
| `WIREGUARD_PORT` | `51820` | Listen port |
| `WIREGUARD_SERVER_ADDRESS` | `10.100.0.1/24` | Server VPN IP |
| `WIREGUARD_SUBNET` | `10.100.0.0/24` | VPN subnet |
| `WIREGUARD_DNS` | `10.100.0.1` | DNS servers (comma-separated) |
| `WIREGUARD_PUBLIC_ENDPOINT` | `null` | Public IP:port for clients |
| `WIREGUARD_ALLOWED_LOCAL_NETWORKS` | `192.168.100.0/24` | Local networks accessible via VPN |
| `WIREGUARD_CLIENT_IP_START` | `10.100.0.10` | Client IP range start |
| `WIREGUARD_CLIENT_IP_END` | `10.100.0.254` | Client IP range end |
| `VPN_ENCRYPTION_KEY` | `random` | Encryption key for storing private keys |

### Organization Settings (JSONB)

```json
{
  "vpn": {
    "enabled": false,
    "wireguard": {
      "server_public_key": "base64...",
      "public_endpoint": "203.0.113.42:51820",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_local_networks": ["192.168.100.0/24"]
    }
  },
  "features": {
    "vpn_enabled": false,
    "mfa_enabled": false,
    "workflows_enabled": false
  }
}
```

---

## Troubleshooting

### VPN Server Won't Start

```bash
# Check WireGuard installation
which wg

# Check config syntax
wg-quick strip /usr/local/etc/wireguard/wg0.conf

# Check interface status
sudo wg show wg0
```

### Clients Can't Connect

1. Verify firewall allows UDP 51820
2. Check public endpoint is correct in .env
3. Verify IP forwarding enabled:
   ```bash
   sysctl net.inet.ip.forwarding  # Should return 1
   ```
   If disabled:
   ```bash
   sudo sysctl -w net.inet.ip.forwarding=1
   ```
4. Check WireGuard logs:
   ```bash
   sudo wg show wg0
   ```

### Connection Works But Can't Access Chef

**Most common cause: IP forwarding not enabled or not permanent**

1. **Check IP forwarding** (must return 1):
   ```bash
   sysctl net.inet.ip.forwarding
   ```

   If it returns 0, enable it:
   ```bash
   # Temporary (until reboot)
   sudo sysctl -w net.inet.ip.forwarding=1

   # Permanent (survives reboot)
   sudo tee /etc/sysctl.conf > /dev/null <<EOF
   net.inet.ip.forwarding=1
   EOF
   ```

2. Verify allowed local networks in client config:
   ```bash
   cat /usr/local/etc/wireguard/clients/<user>.conf
   # Should include AllowedIPs = 192.168.100.0/24
   ```

3. Test connectivity from VPN client:
   ```bash
   # Test VPN gateway
   ping 10.100.0.1

   # Test local network routing
   ping 192.168.100.50
   curl http://192.168.100.50:8080/api/health/discovery
   ```

4. Check routing on Mac server:
   ```bash
   # Verify WireGuard interface is up
   sudo wg show wg0

   # Check routing table
   netstat -rn | grep 10.100.0
   ```

---

## Security Considerations

### Private Key Storage

- User private keys are **encrypted** before storing in database
- Encryption key stored in `VPN_ENCRYPTION_KEY` environment variable
- Consider using a proper KMS (Key Management Service) for production

### Access Control

- VPN access granted per-user (unique config for each user)
- Admins can revoke access via `/api/v1/vpn/revoke`
- IP allocation tracked to prevent conflicts

### Network Isolation

- Split-tunnel configuration (only routes specific networks)
- Users' internet traffic NOT routed through VPN by default
- Customize `WIREGUARD_ALLOWED_LOCAL_NETWORKS` to restrict access

---

## Future Enhancements

### Planned Features

- [ ] Admin UI for VPN peer management
- [ ] Automatic VPN installer download in thin client
- [ ] VPN connection monitoring and alerts
- [ ] Multi-site VPN mesh networking
- [ ] Integration with customer VPN solutions (Cisco, OpenVPN)

### Hosting Discovery Service Updates

When updating the hosted discovery service (separate git project), ensure it returns:

```json
{
  "status": "healthy",
  "server": {...},
  "domain": "customer.lanaai.io",
  "discovery": {
    "static_ip": "192.168.100.50",
    "port": 8080,
    "is_secure_ssl": false
  },
  "timestamp": "..."
}
```

The Chef's `/api/health/discovery` endpoint will add VPN info when clients query it directly.

---

## Uninstallation and Cleanup

### Complete VPN Removal

#### Option 1: Using the Cleanup Script (Recommended)

The easiest way to disable or remove VPN is to use the provided cleanup script:

```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI
sudo ./scripts/cleanup-vpn.sh
```

**What the script does:**
1. Stops WireGuard interface
2. Disables VPN flags in `.env`
3. Optionally removes WireGuard configuration files
4. Optionally restarts Chef server
5. Provides verification commands

**Interactive prompts:**
- Whether to remove config files (keeps them by default for re-enabling)
- Whether to restart Chef server (required for changes to take effect)

#### Option 2: Manual Cleanup

If you prefer manual cleanup or need more control:

##### Step 1: Stop WireGuard Interface

```bash
# Stop the VPN interface
sudo wg-quick down wg0

# Verify it's stopped
sudo wg show wg0
# Should output: "Unable to access interface: No such device"
```

##### Step 2: Disable VPN in Configuration

Edit `.env`:

```bash
nano .env
```

Change these values to `false`:
```bash
VPN_ENABLED=false
WIREGUARD_ENABLED=false
FEATURE_VPN_AVAILABLE=false
FEATURE_WIREGUARD_AVAILABLE=false
```

##### Step 3: Remove WireGuard Configuration (Optional)

```bash
# Remove server configuration
sudo rm -rf /usr/local/etc/wireguard/

# Remove LaunchDaemon (if you set one up)
sudo rm /Library/LaunchDaemons/com.lana.wireguard.plist
sudo launchctl unload /Library/LaunchDaemons/com.lana.wireguard.plist
```

##### Step 4: Clean Up Database (Optional)

To remove all VPN peer data from the database:

```bash
# Connect to database
psql -d lana_chef

# View existing VPN peers
SELECT user_id, assigned_ip, enabled FROM vpn_peers;

# Delete all VPN peers
DELETE FROM vpn_peers;

# Delete activation codes
DELETE FROM vpn_peer_activation_codes;

# Disable VPN in organization settings
UPDATE organizations
SET settings = jsonb_set(
    settings,
    '{vpn,enabled}',
    'false'::jsonb
)
WHERE settings->'vpn'->>'enabled' = 'true';

# Verify
SELECT id, name, settings->'vpn' as vpn_config
FROM organizations;

# Exit psql
\q
```

##### Step 5: Disable IP Forwarding (Optional)

If you don't need IP forwarding for other purposes:

```bash
# Disable IP forwarding
sudo sysctl -w net.inet.ip.forwarding=0

# Remove sysctl.conf if you created it
sudo rm /etc/sysctl.conf
```

##### Step 6: Remove Firewall Rules (Optional)

If you added firewall rules for VPN:

```bash
# Edit pf.conf and remove WireGuard rule
sudo nano /etc/pf.conf

# Look for and remove:
# pass in proto udp from any to any port 51820

# Reload firewall
sudo pfctl -f /etc/pf.conf
```

##### Step 7: Restart Chef Server

```bash
pm2 restart lana-api
```

##### Step 8: Verify VPN is Disabled

```bash
# Check discovery endpoint (should not include vpn field)
curl http://localhost:8080/api/health/discovery | jq .discovery.vpn
# Expected: null (or field not present)

# Verify WireGuard is stopped
sudo wg show wg0
# Expected: "Unable to access interface: No such device"

# Check .env settings
grep -E "(VPN_ENABLED|WIREGUARD_ENABLED)" .env
# Expected: Both should be false
```

### Uninstall WireGuard Completely

To completely remove WireGuard from the system:

```bash
# Uninstall via Homebrew
brew uninstall wireguard-tools

# Remove all related files
sudo rm -rf /usr/local/etc/wireguard/
sudo rm -rf /opt/homebrew/etc/wireguard/

# Verify removal
which wg
which wg-quick
# Expected: No output (command not found)
```

### Mobile Client Cleanup

#### iOS (iPhone/iPad)

**Remove VPN Configuration:**
1. Open WireGuard app
2. Swipe left on the LANA-AI configuration
3. Tap **Delete**
4. Confirm deletion

**Uninstall WireGuard App (Optional):**
1. Long-press WireGuard app icon
2. Tap **Remove App**
3. Tap **Delete App**
4. Confirm deletion

**Verify Removal:**
1. Open **Settings** → **General** → **VPN & Device Management**
2. Verify no WireGuard VPN profiles remain
3. If any remain, tap and select **Delete VPN**

#### Android

**Remove VPN Configuration:**
1. Open WireGuard app
2. Long-press the LANA-AI tunnel
3. Tap **Delete**
4. Confirm deletion

**Uninstall WireGuard App (Optional):**
1. Open **Settings** → **Apps**
2. Find and tap **WireGuard**
3. Tap **Uninstall**
4. Confirm

**Verify Removal:**
1. Open **Settings** → **Network & Internet** → **VPN**
2. Verify no WireGuard VPN profiles remain
3. If any remain, tap the gear icon and select **Forget**

### Partial Cleanup (Temporary Disable)

If you want to temporarily disable VPN but keep the option to re-enable it quickly:

**Recommended approach:**
1. Stop WireGuard: `sudo wg-quick down wg0`
2. Set `VPN_ENABLED=false` in `.env`
3. Restart Chef: `pm2 restart lana-api`
4. **Keep all config files and database data**

**To re-enable later:**
1. Start WireGuard: `sudo wg-quick up wg0`
2. Set `VPN_ENABLED=true` in `.env`
3. Restart Chef: `pm2 restart lana-api`

### Troubleshooting Cleanup

#### "WireGuard won't stop"

```bash
# Force kill WireGuard processes
sudo killall wg-quick

# Check for remaining interfaces
ifconfig | grep wg

# Manually remove interface if still present
sudo ifconfig wg0 destroy
```

#### "Can't delete /usr/local/etc/wireguard/"

```bash
# Check permissions
ls -la /usr/local/etc/ | grep wireguard

# Force remove with sudo
sudo rm -rf /usr/local/etc/wireguard/

# If still failing, check for file locks
lsof | grep wireguard
```

#### "Database won't let me delete VPN peers"

```bash
# Check for foreign key constraints
psql -d lana_chef -c "\d vpn_peers"

# Delete in correct order
psql -d lana_chef -c "DELETE FROM vpn_peer_activation_codes;"
psql -d lana_chef -c "DELETE FROM vpn_peers;"
```

#### "Discovery endpoint still shows VPN"

```bash
# Clear any caches
pm2 restart lana-api --update-env

# Verify .env is being read
pm2 env lana-api | grep VPN

# Check if .env.backup is being used instead
ls -la .env*
```

### Cleanup Verification Checklist

After cleanup, verify these items:

- [ ] `sudo wg show wg0` returns "No such device"
- [ ] `.env` has `VPN_ENABLED=false`
- [ ] `/api/health/discovery` does not include `vpn` field
- [ ] Database has zero rows in `vpn_peers` table (if you deleted them)
- [ ] No `/usr/local/etc/wireguard/` directory (if you removed it)
- [ ] `sysctl net.inet.ip.forwarding` returns 0 (if you disabled it)
- [ ] Firewall rules don't include port 51820 (if you removed them)
- [ ] Mobile clients can't connect to VPN
- [ ] Chef server is accessible without VPN (for on-network users)

---

## Support

For issues or questions:
1. Check logs: `pm2 logs lana-chef`
2. Verify config: `cat /usr/local/etc/wireguard/wg0.conf`
3. Test WireGuard: `sudo wg show wg0`
4. Contact system administrator

---

**Document Version:** 1.1.0
**Last Updated:** 2025-12-10
**Author:** LANA-AI Engineering Team
