# VPN Client Registration Flow

## Overview

This document describes the complete VPN setup and client registration flow for Lana AI deployments. The approach uses **client-side key generation** with **post-authentication device registration** on the local server.

## Architecture

```
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│   Lana Client   │       │  Hosted Discovery    │       │  Local Server   │
│ (Web/iOS/macOS) │       │ (redroostertec.com)  │       │  (10.0.0.3)     │
└────────┬────────┘       └──────────┬───────────┘       └────────┬────────┘
         │                           │                            │
         │  Provides:                │                            │
         │  - VPN endpoint           │                            │
         │  - Server public key      │                            │
         │  - Subnet info            │                            │
         │                           │                            │
         │                           │    Handles:                │
         │                           │    - Authentication        │
         │                           │    - Device registration   │
         │                           │    - WireGuard peer mgmt   │
         │                           │                            │
```

## Components

| Component | Role |
|-----------|------|
| **Hosted Discovery Service** | Provides org VPN configuration (endpoint, server public key, subnet) |
| **Client App** | Generates keypair, builds WireGuard config, connects VPN |
| **Local Server** | Authenticates users, registers device keys, manages WireGuard peers |
| **WireGuard Server** | Runs on local server, accepts registered peers |

---

## Complete Flow

### Phase 1: Discovery (No VPN Yet)

```
┌─────────────┐                    ┌──────────────────┐
│ Lana Client │                    │ Hosted Discovery │
└──────┬──────┘                    └────────┬─────────┘
       │                                    │
       │ POST /lana-ai/v1/discovery         │
       │ { org_id, domain }                 │
       │───────────────────────────────────►│
       │                                    │
       │ Response with VPN config           │
       │◄───────────────────────────────────│
       │                                    │
       │ {                                  │
       │   discovery: {                     │
       │     static_ip: "10.0.0.3",         │
       │     port: 8080,                    │
       │     vpn: {                         │
       │       enabled: true,               │
       │       endpoint: "24.99.172.140:51820",
       │       server_public_key: "...",    │
       │       subnet: "10.100.0.0/24",     │
       │       dns: ["10.100.0.1"],         │
       │       allowed_networks: ["10.0.0.0/24"],
       │       bootstrap_psk: "...",        │  ← For initial connection
       │     }                              │
       │   }                                │
       │ }                                  │
       │                                    │
```

### Phase 2: Client Generates VPN Config

The client app (Electron/iOS/Web) performs these steps locally:

```javascript
// 1. Generate WireGuard keypair on device
const { privateKey, publicKey } = generateWireGuardKeyPair();

// 2. Generate a client IP (deterministic from device ID or random)
const clientIp = generateClientIp(deviceId, vpnConfig.subnet);
// e.g., 10.100.0.42/32

// 3. Build WireGuard configuration
const config = `
[Interface]
PrivateKey = ${privateKey}
Address = ${clientIp}
DNS = ${vpnConfig.dns.join(', ')}

[Peer]
PublicKey = ${vpnConfig.server_public_key}
PresharedKey = ${vpnConfig.bootstrap_psk}
Endpoint = ${vpnConfig.endpoint}
AllowedIPs = ${vpnConfig.allowed_networks.join(', ')}, ${vpnConfig.subnet}
PersistentKeepalive = 25
`;

// 4. Store keypair securely (Keychain on iOS/macOS, secure storage on Electron)
await secureStorage.set('vpn_private_key', privateKey);
await secureStorage.set('vpn_public_key', publicKey);
await secureStorage.set('vpn_client_ip', clientIp);
```

### Phase 3: Initial VPN Connection (Bootstrap)

```
┌─────────────┐                              ┌─────────────────┐
│ Lana Client │                              │ WireGuard Server│
└──────┬──────┘                              └────────┬────────┘
       │                                              │
       │ Connect with bootstrap PSK                   │
       │ (PSK allows initial connection               │
       │  before device is registered)                │
       │─────────────────────────────────────────────►│
       │                                              │
       │ VPN tunnel established                       │
       │◄─────────────────────────────────────────────│
       │                                              │
       │ Can now reach 10.0.0.3:8080                  │
       │                                              │
```

**Bootstrap PSK Configuration:**

The WireGuard server has a special "bootstrap" peer that accepts connections using a pre-shared key. This allows initial connections before the client's public key is registered.

```ini
# /etc/wireguard/wg0.conf (on local server)

[Interface]
PrivateKey = SERVER_PRIVATE_KEY
Address = 10.100.0.1/24
ListenPort = 51820

# Bootstrap peer - accepts initial connections with PSK
# Uses a wide IP range, limited by PSK requirement
[Peer]
# Placeholder public key (or use a known bootstrap key)
PublicKey = BOOTSTRAP_PUBLIC_KEY
PresharedKey = BOOTSTRAP_PSK
AllowedIPs = 10.100.0.0/24

# Registered devices get added here dynamically
# [Peer]
# PublicKey = CLIENT_PUBLIC_KEY
# AllowedIPs = 10.100.0.42/32
```

### Phase 4: Authentication & Device Registration

```
┌─────────────┐                              ┌─────────────────┐
│ Lana Client │                              │  Local Server   │
│ (via VPN)   │                              │  (10.0.0.3)     │
└──────┬──────┘                              └────────┬────────┘
       │                                              │
       │ POST /api/v1/auth/login                      │
       │ { email, password }                          │
       │─────────────────────────────────────────────►│
       │                                              │
       │ { token, user }                              │
       │◄─────────────────────────────────────────────│
       │                                              │
       │ POST /api/v1/vpn/register-device             │
       │ Authorization: Bearer {token}                │
       │ {                                            │
       │   public_key: "CLIENT_PUBLIC_KEY",           │
       │   device_id: "unique-device-id",             │
       │   device_name: "Michael's iPhone",           │
       │   device_type: "ios",                        │
       │   requested_ip: "10.100.0.42"                │
       │ }                                            │
       │─────────────────────────────────────────────►│
       │                                              │
       │                    ┌─────────────────────────┤
       │                    │ 1. Validate IP available│
       │                    │ 2. Add peer to WireGuard│
       │                    │ 3. Store in database    │
       │                    └─────────────────────────┤
       │                                              │
       │ {                                            │
       │   success: true,                             │
       │   device_id: "...",                          │
       │   assigned_ip: "10.100.0.42/32",             │
       │   registered: true                           │
       │ }                                            │
       │◄─────────────────────────────────────────────│
       │                                              │
```

### Phase 5: Subsequent Connections

After device registration, the client no longer needs the bootstrap PSK:

```ini
# Updated client config (stored on device)

[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.100.0.42/32
DNS = 10.100.0.1

[Peer]
PublicKey = SERVER_PUBLIC_KEY
# No PresharedKey needed after registration
Endpoint = 24.99.172.140:51820
AllowedIPs = 10.0.0.0/24, 10.100.0.0/24
PersistentKeepalive = 25
```

---

## API Specifications

### Local Server Endpoints

#### `POST /api/v1/vpn/register-device`

Registers a new device's WireGuard public key.

**Request:**
```json
{
  "public_key": "base64-encoded-wireguard-public-key",
  "device_id": "unique-device-identifier",
  "device_name": "Michael's iPhone",
  "device_type": "ios",
  "requested_ip": "10.100.0.42"
}
```

**Response (Success):**
```json
{
  "success": true,
  "device": {
    "id": "uuid",
    "device_id": "unique-device-identifier",
    "device_name": "Michael's iPhone",
    "device_type": "ios",
    "assigned_ip": "10.100.0.42/32",
    "registered_at": "2025-12-11T04:00:00.000Z"
  },
  "message": "Device registered successfully. You can now connect without the bootstrap PSK."
}
```

**Response (IP Conflict):**
```json
{
  "success": true,
  "device": {
    "assigned_ip": "10.100.0.43/32"
  },
  "message": "Requested IP was unavailable. Assigned alternate IP."
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "DEVICE_LIMIT_REACHED",
  "message": "Maximum devices (5) already registered for this user."
}
```

#### `GET /api/v1/vpn/my-devices`

Lists all registered devices for the authenticated user.

**Response:**
```json
{
  "devices": [
    {
      "id": "uuid",
      "device_id": "unique-device-identifier",
      "device_name": "Michael's iPhone",
      "device_type": "ios",
      "assigned_ip": "10.100.0.42/32",
      "last_seen": "2025-12-11T03:45:00.000Z",
      "registered_at": "2025-12-10T10:00:00.000Z"
    },
    {
      "id": "uuid2",
      "device_id": "another-device-id",
      "device_name": "Work MacBook",
      "device_type": "macos",
      "assigned_ip": "10.100.0.43/32",
      "last_seen": "2025-12-11T02:30:00.000Z",
      "registered_at": "2025-12-09T14:00:00.000Z"
    }
  ]
}
```

#### `DELETE /api/v1/vpn/devices/{device_id}`

Revokes a device's VPN access.

**Response:**
```json
{
  "success": true,
  "message": "Device revoked. VPN access has been removed."
}
```

#### `GET /api/v1/vpn/config`

Returns the current user's VPN configuration (for re-download).

**Response:**
```json
{
  "server": {
    "public_key": "SERVER_PUBLIC_KEY",
    "endpoint": "24.99.172.140:51820"
  },
  "client": {
    "assigned_ip": "10.100.0.42/32",
    "dns": ["10.100.0.1"],
    "allowed_ips": ["10.0.0.0/24", "10.100.0.0/24"]
  },
  "note": "Private key is stored on your device. If lost, revoke this device and register again."
}
```

### Admin Endpoints

#### `GET /api/v1/admin/vpn/devices`

Lists all registered VPN devices (admin only).

**Response:**
```json
{
  "devices": [
    {
      "id": "uuid",
      "user_id": "user-uuid",
      "user_email": "michael@example.com",
      "device_name": "Michael's iPhone",
      "device_type": "ios",
      "assigned_ip": "10.100.0.42/32",
      "public_key": "CLIENT_PUBLIC_KEY",
      "status": "active",
      "last_seen": "2025-12-11T03:45:00.000Z",
      "registered_at": "2025-12-10T10:00:00.000Z"
    }
  ],
  "total": 15,
  "ip_pool": {
    "total": 244,
    "used": 15,
    "available": 229
  }
}
```

#### `DELETE /api/v1/admin/vpn/devices/{device_id}`

Admin revokes any device's VPN access.

#### `POST /api/v1/admin/vpn/regenerate-bootstrap-psk`

Regenerates the bootstrap PSK (invalidates all pending connections).

---

## Database Schema

### `user_devices` table

```sql
CREATE TABLE user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id),

    -- Device identification
    device_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(255),
    device_type VARCHAR(50),  -- ios, macos, windows, android, web, electron

    -- VPN configuration
    vpn_public_key TEXT NOT NULL,
    vpn_assigned_ip INET NOT NULL,

    -- Status tracking
    status VARCHAR(20) DEFAULT 'active',  -- active, revoked
    last_seen_at TIMESTAMP,
    last_ip_address INET,  -- Public IP they connected from

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,

    -- Constraints
    UNIQUE(org_id, device_id),
    UNIQUE(org_id, vpn_assigned_ip),
    UNIQUE(org_id, vpn_public_key)
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX idx_user_devices_org_id ON user_devices(org_id);
CREATE INDEX idx_user_devices_status ON user_devices(status);
```

### `vpn_ip_allocations` table (optional, for IP management)

```sql
CREATE TABLE vpn_ip_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    ip_address INET NOT NULL,
    device_id UUID REFERENCES user_devices(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'available',  -- available, allocated, reserved
    allocated_at TIMESTAMP,

    UNIQUE(org_id, ip_address)
);
```

---

## WireGuard Server Configuration

### Initial Setup (`/etc/wireguard/wg0.conf`)

```ini
[Interface]
PrivateKey = SERVER_PRIVATE_KEY_HERE
Address = 10.100.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o en0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o en0 -j MASQUERADE

# Bootstrap peer for initial connections
# Clients use this with PSK before registering their device
[Peer]
PublicKey = BOOTSTRAP_PEER_PUBLIC_KEY
PresharedKey = BOOTSTRAP_PSK_HERE
AllowedIPs = 10.100.0.2/32, 10.100.0.100/24

# Registered devices are added dynamically below
# They don't need PSK after registration
```

### Dynamic Peer Management

The local server manages WireGuard peers via the `wg` command:

```bash
# Add a new peer (after device registration)
sudo wg set wg0 peer CLIENT_PUBLIC_KEY allowed-ips 10.100.0.42/32

# Remove a peer (on device revocation)
sudo wg set wg0 peer CLIENT_PUBLIC_KEY remove

# Save configuration
sudo wg-quick save wg0
```

---

## Client Implementation

### Electron/Web

```javascript
// vpn-manager.js

class VPNManager {
  constructor() {
    this.storage = window.electronAPI ?
      new ElectronSecureStorage() :
      new BrowserSecureStorage();
  }

  /**
   * Generate WireGuard keypair
   * Uses libsodium or wg command
   */
  async generateKeyPair() {
    if (window.electronAPI) {
      // Electron: use native wg command
      return await window.electronAPI.generateWireGuardKeys();
    } else {
      // Browser: use libsodium-wrappers
      const sodium = await import('libsodium-wrappers');
      await sodium.ready;
      const keyPair = sodium.crypto_box_keypair();
      return {
        privateKey: sodium.to_base64(keyPair.privateKey),
        publicKey: sodium.to_base64(keyPair.publicKey)
      };
    }
  }

  /**
   * Generate a client IP from device ID
   * Deterministic so same device gets same IP request
   */
  generateClientIp(deviceId, subnet) {
    // Hash device ID to get consistent IP
    const hash = this.hashString(deviceId);
    const baseIp = subnet.split('/')[0].split('.');
    const lastOctet = 10 + (hash % 244); // 10-254 range
    return `${baseIp[0]}.${baseIp[1]}.${baseIp[2]}.${lastOctet}/32`;
  }

  /**
   * Build WireGuard configuration file
   */
  buildConfig(vpnInfo, privateKey, clientIp) {
    return `[Interface]
PrivateKey = ${privateKey}
Address = ${clientIp}
DNS = ${vpnInfo.dns.join(', ')}

[Peer]
PublicKey = ${vpnInfo.server_public_key}
${vpnInfo.bootstrap_psk ? `PresharedKey = ${vpnInfo.bootstrap_psk}` : ''}
Endpoint = ${vpnInfo.endpoint}
AllowedIPs = ${[...vpnInfo.allowed_networks, vpnInfo.subnet].join(', ')}
PersistentKeepalive = 25
`;
  }

  /**
   * Get or create VPN configuration for this device
   */
  async getOrCreateConfig(vpnInfo) {
    // Check if we already have keys stored
    let privateKey = await this.storage.get('vpn_private_key');
    let publicKey = await this.storage.get('vpn_public_key');
    let clientIp = await this.storage.get('vpn_client_ip');

    if (!privateKey || !publicKey) {
      // Generate new keypair
      const keyPair = await this.generateKeyPair();
      privateKey = keyPair.privateKey;
      publicKey = keyPair.publicKey;

      // Generate client IP
      const deviceId = await this.getDeviceId();
      clientIp = this.generateClientIp(deviceId, vpnInfo.subnet);

      // Store securely
      await this.storage.set('vpn_private_key', privateKey);
      await this.storage.set('vpn_public_key', publicKey);
      await this.storage.set('vpn_client_ip', clientIp);
    }

    return {
      privateKey,
      publicKey,
      clientIp,
      config: this.buildConfig(vpnInfo, privateKey, clientIp)
    };
  }

  /**
   * Register device with local server (call after authentication)
   */
  async registerDevice(api, deviceName, deviceType) {
    const publicKey = await this.storage.get('vpn_public_key');
    const clientIp = await this.storage.get('vpn_client_ip');
    const deviceId = await this.getDeviceId();

    const response = await api.post('/api/v1/vpn/register-device', {
      public_key: publicKey,
      device_id: deviceId,
      device_name: deviceName,
      device_type: deviceType,
      requested_ip: clientIp.replace('/32', '')
    });

    if (response.success) {
      // Update stored IP if server assigned a different one
      if (response.device.assigned_ip !== clientIp) {
        await this.storage.set('vpn_client_ip', response.device.assigned_ip);
      }

      // Mark as registered (can remove PSK from config)
      await this.storage.set('vpn_registered', 'true');
    }

    return response;
  }

  /**
   * Get unique device identifier
   */
  async getDeviceId() {
    let deviceId = await this.storage.get('device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      await this.storage.set('device_id', deviceId);
    }
    return deviceId;
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
```

### iOS App

```swift
// VPNManager.swift

import NetworkExtension
import CryptoKit

class VPNManager {
    static let shared = VPNManager()

    private let keychain = KeychainService()

    /// Generate WireGuard keypair using Curve25519
    func generateKeyPair() -> (privateKey: String, publicKey: String) {
        let privateKey = Curve25519.KeyAgreement.PrivateKey()
        let publicKey = privateKey.publicKey

        return (
            privateKey: privateKey.rawRepresentation.base64EncodedString(),
            publicKey: publicKey.rawRepresentation.base64EncodedString()
        )
    }

    /// Get or create VPN configuration
    func getOrCreateConfig(vpnInfo: VPNConfig) -> WireGuardConfig {
        // Check keychain for existing keys
        if let privateKey = keychain.get("vpn_private_key"),
           let publicKey = keychain.get("vpn_public_key"),
           let clientIp = keychain.get("vpn_client_ip") {
            return WireGuardConfig(
                privateKey: privateKey,
                publicKey: publicKey,
                clientIp: clientIp,
                vpnInfo: vpnInfo
            )
        }

        // Generate new keypair
        let keyPair = generateKeyPair()
        let deviceId = getDeviceId()
        let clientIp = generateClientIp(deviceId: deviceId, subnet: vpnInfo.subnet)

        // Store in keychain
        keychain.set("vpn_private_key", value: keyPair.privateKey)
        keychain.set("vpn_public_key", value: keyPair.publicKey)
        keychain.set("vpn_client_ip", value: clientIp)

        return WireGuardConfig(
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
            clientIp: clientIp,
            vpnInfo: vpnInfo
        )
    }

    /// Register device with local server
    func registerDevice(api: APIClient) async throws -> DeviceRegistration {
        guard let publicKey = keychain.get("vpn_public_key"),
              let clientIp = keychain.get("vpn_client_ip") else {
            throw VPNError.noKeysFound
        }

        let deviceId = getDeviceId()
        let deviceName = UIDevice.current.name

        let response = try await api.post("/api/v1/vpn/register-device", body: [
            "public_key": publicKey,
            "device_id": deviceId,
            "device_name": deviceName,
            "device_type": "ios",
            "requested_ip": clientIp.replacingOccurrences(of: "/32", with: "")
        ])

        // Update IP if server assigned different one
        if let assignedIp = response.device?.assignedIp, assignedIp != clientIp {
            keychain.set("vpn_client_ip", value: assignedIp)
        }

        keychain.set("vpn_registered", value: "true")

        return response
    }

    /// Generate config file content for WireGuard app
    func generateConfigFile(config: WireGuardConfig) -> String {
        var configString = """
        [Interface]
        PrivateKey = \(config.privateKey)
        Address = \(config.clientIp)
        DNS = \(config.vpnInfo.dns.joined(separator: ", "))

        [Peer]
        PublicKey = \(config.vpnInfo.serverPublicKey)
        """

        if let psk = config.vpnInfo.bootstrapPsk, !isRegistered() {
            configString += "\nPresharedKey = \(psk)"
        }

        configString += """

        Endpoint = \(config.vpnInfo.endpoint)
        AllowedIPs = \(config.vpnInfo.allowedNetworks.joined(separator: ", ")), \(config.vpnInfo.subnet)
        PersistentKeepalive = 25
        """

        return configString
    }

    /// Generate QR code for WireGuard app import
    func generateQRCode(config: WireGuardConfig) -> UIImage? {
        let configString = generateConfigFile(config: config)
        // Use CIFilter to generate QR code
        // ... implementation
    }

    private func getDeviceId() -> String {
        if let deviceId = keychain.get("device_id") {
            return deviceId
        }
        let deviceId = UUID().uuidString
        keychain.set("device_id", value: deviceId)
        return deviceId
    }

    private func isRegistered() -> Bool {
        return keychain.get("vpn_registered") == "true"
    }
}
```

---

## Security Considerations

### Bootstrap PSK

- The bootstrap PSK allows initial VPN connections before device registration
- Should be rotated periodically by admin
- Provides temporary access; full access requires device registration
- Consider rate limiting bootstrap connections

### Key Storage

| Platform | Storage Method |
|----------|---------------|
| iOS | Keychain with `kSecAttrAccessibleAfterFirstUnlock` |
| macOS | Keychain |
| Electron | electron-store with encryption or system keychain |
| Web | Not recommended (use Electron for desktop) |

### Device Limits

- Recommend limiting devices per user (e.g., 5)
- Admin can revoke devices
- Consider auto-revoking inactive devices (e.g., 90 days)

### IP Allocation

- Use deterministic IP generation to reduce conflicts
- Server is authoritative - can reassign if conflict
- Track allocations in database

---

## Hosted Discovery Service Requirements

The hosted service at `redroostertec.com` needs to provide these VPN fields in the discovery response:

### Required Fields in Discovery Response

```json
{
  "discovery": {
    "vpn": {
      "enabled": true,
      "type": "wireguard",
      "endpoint": "24.99.172.140:51820",
      "server_public_key": "BASE64_ENCODED_SERVER_PUBLIC_KEY",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_networks": ["10.0.0.0/24"],
      "required_for_remote_access": true,
      "bootstrap_psk": "BASE64_ENCODED_PRESHARED_KEY"
    }
  }
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether VPN is enabled for this org |
| `type` | string | VPN type (currently only "wireguard") |
| `endpoint` | string | Public IP:port for WireGuard server |
| `server_public_key` | string | Base64-encoded WireGuard server public key |
| `subnet` | string | VPN client subnet (CIDR notation) |
| `dns` | array | DNS servers for VPN clients |
| `allowed_networks` | array | Networks accessible through VPN |
| `required_for_remote_access` | boolean | Whether VPN is required when outside local network |
| `bootstrap_psk` | string | Pre-shared key for initial connections (before device registration) |

---

## Migration Path

### For Existing Users

1. Users will be prompted to set up VPN on next login attempt from outside network
2. Their device will generate keys and connect via bootstrap PSK
3. After login, device is registered
4. Subsequent connections use registered key

### For New Deployments

1. Admin configures WireGuard server
2. Admin adds VPN config to hosted discovery
3. Clients automatically handle VPN setup on first connection attempt

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Connection timeout" | Port 51820 not forwarded | Check router port forwarding |
| "Handshake failed" | Wrong server public key | Verify key in discovery matches server |
| "IP conflict" | Two devices requested same IP | Server assigns alternate IP |
| "Bootstrap PSK invalid" | PSK was rotated | Re-fetch discovery, get new PSK |
| "Device not registered" | Registration failed | Check auth token, retry registration |

### Debug Commands

```bash
# On server - show WireGuard status
sudo wg show

# On server - show registered peers
sudo wg show wg0 peers

# On server - check logs
journalctl -u wg-quick@wg0 -f

# On client - test connectivity
ping 10.100.0.1
curl http://10.0.0.3:8080/api/health
```
