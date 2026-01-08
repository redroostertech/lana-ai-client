# VPN Client Registration Implementation Summary

**Date:** 2025-12-11
**Status:** ✅ Backend Implementation Complete
**Version:** 1.0.0

---

## Overview

This document summarizes the implementation of the VPN client registration flow for LANA-AI, following the architecture described in `VPN_CLIENT_REGISTRATION_FLOW.md`.

The implementation enables:
- Client-side WireGuard key generation
- Post-authentication device registration
- Bootstrap PSK for initial connections (solves chicken-and-egg problem)
- Dynamic WireGuard peer management
- Admin device management

---

## Implementation Status

### ✅ Completed

1. **Database Layer**
   - Migration for `user_devices` table
   - Migration for `vpn_ip_allocations` table
   - Device registration repository

2. **Backend Services**
   - Device registration service with WireGuard integration
   - Dynamic peer add/remove functionality
   - IP allocation management

3. **API Routes**
   - User VPN routes (`/api/v1/vpn/*`)
   - Admin VPN routes (`/api/v1/admin/vpn/*`)
   - Discovery endpoint updated with bootstrap PSK

4. **Infrastructure**
   - Bootstrap PSK generation in setup-wireguard.sh
   - Admin middleware (requireAdmin)
   - Route registration in main app

### 🔄 Pending

1. **Frontend Implementation**
   - VPN manager (JavaScript/Electron)
   - Client keypair generation
   - Device registration UI
   - VPN setup wizard

2. **Testing**
   - End-to-end device registration flow
   - WireGuard peer management
   - Bootstrap PSK connection

3. **Documentation**
   - API endpoint documentation
   - Client integration guide

---

## Files Created

### Database

**`src/migrations/add_user_devices_table.sql`**
- Creates `user_devices` table
- Creates `vpn_ip_allocations` table
- Adds indexes and triggers
- Manages VPN device tracking

### Repository Layer

**`src/repositories/user-devices.repository.js`**
- Device CRUD operations
- IP allocation management
- Statistics and queries

Functions:
- `registerDevice()` - Register new device
- `findByDeviceId()` - Find device by ID
- `getDevicesByUserId()` - Get user's devices
- `revokeDevice()` - Revoke device access
- `allocateIp()` - Allocate VPN IP
- `isIpAvailable()` - Check IP availability

### Service Layer

**`src/services/vpn/services/device-registration.service.js`**
- Business logic for device registration
- WireGuard peer management
- IP address allocation

Key Methods:
- `registerDevice()` - Complete registration flow
- `addWireGuardPeer()` - Add peer to WireGuard
- `removeWireGuardPeer()` - Remove peer from WireGuard
- `revokeDevice()` - Revoke device and cleanup
- `findAvailableIp()` - Find next available IP

### API Routes

**`src/services/vpn/routes/device-registration.routes.js`**

User endpoints:
- `POST /api/v1/vpn/register-device` - Register device
- `GET /api/v1/vpn/my-devices` - List user's devices
- `GET /api/v1/vpn/config?device_id=<id>` - Get VPN config
- `DELETE /api/v1/vpn/devices/:device_id` - Revoke device
- `POST /api/v1/vpn/heartbeat` - Update last seen

**`src/services/vpn/routes/admin-vpn.routes.js`**

Admin endpoints:
- `GET /api/v1/admin/vpn/devices` - List all org devices
- `DELETE /api/v1/admin/vpn/devices/:device_id` - Revoke any device
- `POST /api/v1/admin/vpn/regenerate-bootstrap-psk` - Regenerate PSK
- `GET /api/v1/admin/vpn/status` - Get VPN status
- `GET /api/v1/admin/vpn/discovery-config` - Get discovery config JSON

---

## Files Modified

### Main Application

**`src/index.js`**
- Added device registration routes import
- Added admin VPN routes import
- Mounted routes at `/api/v1/vpn` and `/api/v1/admin/vpn`

### Authentication Middleware

**`src/shared/middleware/auth.middleware.js`**
- Added user role fetching in authenticate()
- Added `org_id` and `role` to req.user
- Created `requireAdmin()` middleware

Changes:
```javascript
// Before
req.user = {
  id: decoded.userId,
  email: decoded.email,
  organizationId: decoded.organizationId,
  sessionId: sessionResult.rows[0].id,
};

// After
req.user = {
  id: decoded.userId,
  email: decoded.email,
  organizationId: decoded.organizationId || user.org_id,
  org_id: user.org_id,
  role: user.role,
  sessionId: sessionResult.rows[0].id,
};
```

### Discovery Endpoint

**`src/services/health/routes/health.routes.js`**
- Added bootstrap PSK to discovery response
- Added server public key to discovery response
- Reads PSK from `/usr/local/etc/wireguard/bootstrap.psk`
- Reads server key from `/usr/local/etc/wireguard/server_public.key`

Discovery response now includes:
```json
{
  "discovery": {
    "vpn": {
      "enabled": true,
      "type": "wireguard",
      "endpoint": "24.99.172.140:51820",
      "server_public_key": "...",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_networks": ["10.0.0.0/24"],
      "required_for_remote_access": true,
      "bootstrap_psk": "..."
    }
  }
}
```

### WireGuard Setup Script

**`scripts/setup-wireguard.sh`**
- Added `generate_bootstrap_psk()` function
- Generates PSK using `wg genpsk` or `openssl`
- Saves to `/usr/local/etc/wireguard/bootstrap.psk`
- Called in main() flow after server key generation

---

## API Endpoint Reference

### User Endpoints

#### Register Device
```
POST /api/v1/vpn/register-device
Authorization: Bearer <token>

Request:
{
  "public_key": "base64-encoded-key",
  "device_id": "unique-device-id",
  "device_name": "Michael's iPhone",
  "device_type": "ios",
  "requested_ip": "10.100.0.42"
}

Response:
{
  "success": true,
  "device": {
    "id": "uuid",
    "device_id": "unique-device-id",
    "device_name": "Michael's iPhone",
    "device_type": "ios",
    "assigned_ip": "10.100.0.42",
    "status": "active",
    "registered_at": "2025-12-11T..."
  },
  "message": "Device registered successfully..."
}
```

#### List My Devices
```
GET /api/v1/vpn/my-devices
Authorization: Bearer <token>

Response:
{
  "success": true,
  "devices": [...]
}
```

#### Get VPN Config
```
GET /api/v1/vpn/config?device_id=<device_id>
Authorization: Bearer <token>

Response:
{
  "success": true,
  "config": {
    "server": {
      "public_key": "...",
      "endpoint": "24.99.172.140:51820"
    },
    "client": {
      "assigned_ip": "10.100.0.42/32",
      "dns": ["10.100.0.1"],
      "allowed_ips": ["10.0.0.0/24", "10.100.0.0/24"]
    }
  }
}
```

#### Revoke Device
```
DELETE /api/v1/vpn/devices/:device_id
Authorization: Bearer <token>

Response:
{
  "success": true,
  "message": "Device revoked. VPN access has been removed."
}
```

### Admin Endpoints

#### List All Devices
```
GET /api/v1/admin/vpn/devices?include_revoked=false
Authorization: Bearer <admin-token>

Response:
{
  "success": true,
  "devices": [...],
  "total": 15,
  "ip_pool": {
    "total": 244,
    "used": 15,
    "available": 229
  }
}
```

#### Regenerate Bootstrap PSK
```
POST /api/v1/admin/vpn/regenerate-bootstrap-psk
Authorization: Bearer <admin-token>

Response:
{
  "success": true,
  "message": "Bootstrap PSK regenerated...",
  "bootstrap_psk": "new-psk-here",
  "note": "Update the hosted discovery service with this new PSK"
}
```

#### Get VPN Status
```
GET /api/v1/admin/vpn/status
Authorization: Bearer <admin-token>

Response:
{
  "success": true,
  "status": {
    "running": true,
    "interface": "utun4",
    "peer_count": 5,
    "has_bootstrap_psk": true,
    "bootstrap_psk": "..."
  }
}
```

#### Get Discovery Config
```
GET /api/v1/admin/vpn/discovery-config
Authorization: Bearer <admin-token>

Response:
{
  "success": true,
  "discovery_config": {
    "vpn": { ... }
  },
  "note": "Copy this configuration to the hosted discovery service..."
}
```

---

## Database Schema

### user_devices Table

```sql
CREATE TABLE user_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    org_id UUID NOT NULL REFERENCES organizations(id),

    -- Device info
    device_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(255),
    device_type VARCHAR(50),

    -- VPN config
    vpn_public_key TEXT NOT NULL,
    vpn_assigned_ip INET NOT NULL,

    -- Status
    status VARCHAR(20) DEFAULT 'active',
    last_seen_at TIMESTAMP,
    last_ip_address INET,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,

    -- Constraints
    UNIQUE(org_id, device_id),
    UNIQUE(org_id, vpn_assigned_ip),
    UNIQUE(org_id, vpn_public_key)
);
```

### vpn_ip_allocations Table

```sql
CREATE TABLE vpn_ip_allocations (
    id UUID PRIMARY KEY,
    org_id UUID NOT NULL REFERENCES organizations(id),
    ip_address INET NOT NULL,
    device_id UUID REFERENCES user_devices(id),
    status VARCHAR(20) DEFAULT 'available',
    allocated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(org_id, ip_address)
);
```

---

## Device Registration Flow

### 1. Discovery (No VPN)
```
Client → Hosted Discovery Service
GET /lana-ai/v1/discovery

Response includes:
- VPN endpoint
- Server public key
- Bootstrap PSK
- Subnet info
```

### 2. Client Generates Keys
```javascript
// Client-side (not implemented yet)
const { privateKey, publicKey } = generateWireGuardKeyPair();
const clientIp = generateClientIp(deviceId, subnet);
```

### 3. Initial VPN Connection
```
Client connects to VPN using bootstrap PSK
→ Can now reach 10.0.0.3:8080
```

### 4. Authentication & Registration
```
POST /api/v1/auth/login
→ Get auth token

POST /api/v1/vpn/register-device
Authorization: Bearer <token>
→ Device registered
→ Peer added to WireGuard
→ IP allocated
```

### 5. Subsequent Connections
```
Client connects without bootstrap PSK
→ Uses registered public key
→ Full VPN access
```

---

## WireGuard Integration

### Adding a Peer

```bash
# Executed by deviceRegistrationService.addWireGuardPeer()
sudo wg set <interface> peer <public_key> allowed-ips <assigned_ip>
```

### Removing a Peer

```bash
# Executed by deviceRegistrationService.removeWireGuardPeer()
sudo wg set <interface> peer <public_key> remove
```

### Saving Configuration

```bash
# Executed by deviceRegistrationService.saveWireGuardConfig()
sudo wg-quick save <interface>
```

---

## Configuration Files

### Bootstrap PSK
**Location:** `/usr/local/etc/wireguard/bootstrap.psk`
**Permissions:** 600
**Generated by:** `scripts/setup-wireguard.sh`
**Persistence:** ✅ Automatically reused across deployments if file exists

**Important:** The bootstrap PSK is **never regenerated** if it already exists. This ensures:
- Existing VPN configs continue to work
- No need to update hosted discovery service on redeployment
- Registered devices remain valid

### Server Keys
**Private:** `/usr/local/etc/wireguard/server_private.key` (600)
**Public:** `/usr/local/etc/wireguard/server_public.key` (644)
**Persistence:** ✅ Automatically reused across deployments if files exist

**Important:** Server keys are **never regenerated** if they already exist. This ensures:
- All registered devices continue to work
- No need to re-register devices on redeployment
- VPN configuration remains stable

### WireGuard Config
**Location:** `/usr/local/etc/wireguard/wg0.conf`
**Permissions:** 600

---

## Key Persistence & Redeployment

### Automatic Key Reuse

Both `deploy-prod-mac.sh` and `scripts/setup-wireguard.sh` are designed to **preserve existing VPN keys** across multiple deployments:

**First Deployment:**
```bash
./deploy-prod-mac.sh
# Generates:
# - Server private/public keys
# - Bootstrap PSK
# - WireGuard config
```

**Subsequent Deployments:**
```bash
./deploy-prod-mac.sh
# Reuses existing:
# - Server keys (devices still work!)
# - Bootstrap PSK (discovery unchanged!)
# - Just updates .env and restarts services
```

### Benefits

✅ **No Breaking Changes:** Existing VPN connections continue to work
✅ **No Re-registration:** Devices don't need to re-register
✅ **Stable Discovery:** Hosted discovery service config unchanged
✅ **Safe Updates:** Can redeploy without disrupting VPN users

### When Keys Are Regenerated

Keys are **only** regenerated if:
- Files are manually deleted
- You run regeneration endpoint: `POST /api/v1/admin/vpn/regenerate-bootstrap-psk`
- You manually run `wg genkey` commands

### Manually Regenerating Keys

**⚠️ Warning:** This will **break all existing VPN connections**

If you need to regenerate (e.g., security breach):

```bash
# 1. Stop WireGuard
sudo wg-quick down wg0

# 2. Delete existing keys
sudo rm /usr/local/etc/wireguard/server_private.key
sudo rm /usr/local/etc/wireguard/server_public.key
sudo rm /usr/local/etc/wireguard/bootstrap.psk

# 3. Regenerate
sudo ./scripts/setup-wireguard.sh

# 4. Update .env with new values
# (deploy-prod-mac.sh does this automatically)

# 5. Update hosted discovery service with new:
#    - server_public_key
#    - bootstrap_psk

# 6. Revoke ALL devices
curl -X DELETE -H "Authorization: Bearer <admin-token>" \
  http://10.0.0.3:8080/api/v1/admin/vpn/devices/<device_id>

# 7. Users must re-register devices with new configs
```

---

## Next Steps

### 1. Run Deployment Script

The VPN migration runs automatically when you enable VPN during deployment:

```bash
./deploy-prod-mac.sh
```

When prompted "Enable WireGuard? (y/n)", answer **yes** to:
- Set up WireGuard
- Generate bootstrap PSK
- **Run VPN database migration automatically**
- **Output VPN configuration for homebase**

If you answer **no**, the VPN migration is skipped.

#### Capturing VPN Configuration for Homebase

At the end of deployment, the script outputs VPN configuration between markers:

```
===VPN_CONFIG_START===
{
  "deployment_info": {
    "organization_id": "...",
    "organization_domain": "...",
    "static_ip": "...",
    "deployed_at": "2025-12-11T...",
    "deployment_type": "production"
  },
  "vpn_configuration": { ... },
  "discovery_payload": {
    "vpn": { ... }
  }
}
===VPN_CONFIG_END===
```

**For Installers:**
- Parse output between `===VPN_CONFIG_START===` and `===VPN_CONFIG_END===`
- Extract the JSON
- Send `discovery_payload.vpn` object to homebase hosted discovery service
- File is also saved to: `vpn-discovery-config.json`

**Manual Migration (if needed):**
If you want to run the migration separately:
```bash
psql -d lana_chef -f src/migrations/add_user_devices_table.sql
```

### 2. Restart Application

The deployment script handles this automatically via PM2. If running manually:

```bash
pm2 restart lana-api
```

### 3. Test Endpoints

```bash
# Get discovery config (admin)
curl -H "Authorization: Bearer <admin-token>" \
  http://10.0.0.3:8080/api/v1/admin/vpn/discovery-config

# Register device (user)
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "public_key": "test-key",
    "device_id": "test-device",
    "device_name": "Test Device",
    "device_type": "macos",
    "requested_ip": "10.100.0.42"
  }' \
  http://10.0.0.3:8080/api/v1/vpn/register-device

# List devices (user)
curl -H "Authorization: Bearer <token>" \
  http://10.0.0.3:8080/api/v1/vpn/my-devices
```

### 4. Frontend Integration

Implement VPN manager based on:
- `docs/VPN_CLIENT_REGISTRATION_FLOW.md` (lines 470-617 for JavaScript)
- `docs/VPN_CLIENT_REGISTRATION_FLOW.md` (lines 620-750 for iOS)

Key frontend tasks:
- Generate WireGuard keypairs
- Build WireGuard config
- Store keys securely
- Register device after auth
- Handle QR code generation (mobile)

---

## Security Considerations

### Bootstrap PSK Security
- PSK allows initial connections before registration
- Should be rotated periodically via admin endpoint
- Provides temporary access only
- Full access requires device registration

### Device Limits
- Default: 5 devices per user
- Configurable via `MAX_DEVICES_PER_USER` env var
- Admin can revoke any device
- Consider auto-revoking inactive devices

### Key Storage
- Private keys never stored on server
- Client responsible for secure storage
- If lost, user must revoke and re-register device

---

## Troubleshooting

### Device Registration Fails

**Error:** `DEVICE_LIMIT_REACHED`
- User has reached max devices (default: 5)
- Solution: Revoke old devices or increase limit

**Error:** `NO_AVAILABLE_IPS`
- VPN subnet exhausted
- Solution: Expand subnet or clean up revoked devices

### WireGuard Peer Not Added

**Error:** `WIREGUARD_PEER_ADD_FAILED`
- WireGuard not running
- Solution: `sudo wg-quick up wg0`

### Bootstrap PSK Not Found

- PSK file missing
- Solution: Run `./scripts/setup-wireguard.sh` or regenerate via admin endpoint

---

## Files Summary

### New Files
```
src/migrations/add_user_devices_table.sql
src/repositories/user-devices.repository.js
src/services/vpn/services/device-registration.service.js
src/services/vpn/routes/device-registration.routes.js
src/services/vpn/routes/admin-vpn.routes.js
```

### Modified Files
```
src/index.js
src/shared/middleware/auth.middleware.js
src/services/health/routes/health.routes.js
scripts/setup-wireguard.sh
```

---

## Version History

**v1.0.0** (2025-12-11)
- Initial implementation
- Backend API complete
- Database schema created
- WireGuard integration functional
- Bootstrap PSK generation
- Admin middleware added

---

## References

- Complete flow documentation: `docs/VPN_CLIENT_REGISTRATION_FLOW.md`
- Port forwarding guide: `docs/VPN_PORT_FORWARDING_GUIDE.md`
- VPN implementation guide: `docs/VPN/VPN_IMPLEMENTATION.md`
- VPN quickstart: `docs/VPN/VPN_QUICKSTART.md`
