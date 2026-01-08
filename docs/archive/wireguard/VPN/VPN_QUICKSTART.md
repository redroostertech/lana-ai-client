# LANA-AI VPN Quick Start Guide

## 🚀 Enable VPN in 5 Minutes

This guide will help you quickly enable optional WireGuard VPN for remote access to your LANA-AI deployment.

---

## Prerequisites Checklist

- [ ] Mac Studio/Mini with LANA-AI Chef installed
- [ ] Know your public IP address (e.g., `203.0.113.42`)
- [ ] Firewall/router can forward UDP port 51820
- [ ] `sudo` access on the Mac

---

## Step 1: Install WireGuard (2 minutes)

```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI
sudo ./scripts/setup-wireguard.sh
```

**What this does:**
- Installs WireGuard via Homebrew
- Generates server encryption keys
- Creates default configuration
- Updates your `.env` file

**Output you'll see:**
```
[INFO] WireGuard installed successfully
[INFO] Server keys generated
[INFO] Server Public Key: AbCdEf1234...
```

**Copy the Server Public Key** - you'll need it!

---

## Step 2: Configure Your Public Endpoint (1 minute)

Edit `.env` and add your public IP:

```bash
nano .env
```

Find the VPN section and update:

```bash
# Change this line:
WIREGUARD_PUBLIC_ENDPOINT=

# To your public IP:
WIREGUARD_PUBLIC_ENDPOINT=203.0.113.42:51820
```

**Don't know your public IP?**
```bash
curl ifconfig.me
```

---

## Step 3: Enable VPN (30 seconds)

Still in `.env`, change these two lines:

```bash
VPN_ENABLED=true
WIREGUARD_ENABLED=true
```

Save and close (Ctrl+X, then Y, then Enter)

---

## Step 4: Run Database Migration (30 seconds)

```bash
psql -d lana_chef -f src/migrations/add_vpn_configuration.sql
```

**Expected output:**
```
CREATE FUNCTION
CREATE FUNCTION
UPDATE 1
CREATE INDEX
```

---

## Step 5: Start WireGuard (1 minute)

```bash
# Start the WireGuard interface
sudo wg-quick up wg0

# Verify it's running
sudo wg show wg0
```

**Expected output:**
```
interface: wg0
  public key: AbCdEf1234...
  private key: (hidden)
  listening port: 51820
```

---

## Step 5b: Enable IP Forwarding (30 seconds)

**⚠️ CRITICAL**: IP forwarding is required for VPN to route traffic between clients and your local network.

```bash
# Check if already enabled
sysctl net.inet.ip.forwarding

# Enable it (if not already set to 1)
sudo sysctl -w net.inet.ip.forwarding=1
```

**Expected output:**
```
net.inet.ip.forwarding: 0 -> 1
```

### Make IP Forwarding Permanent (Survives Reboots)

The command above is **temporary** and will reset on reboot. To make it permanent:

```bash
# Create sysctl configuration file
sudo tee /etc/sysctl.conf > /dev/null <<EOF
# Enable IP forwarding for WireGuard VPN
net.inet.ip.forwarding=1
EOF

# Verify it was created
cat /etc/sysctl.conf
```

Now IP forwarding will be enabled automatically on every boot.

**Why is this needed?**
Without IP forwarding, VPN clients can connect but cannot access your LANA-AI server or any network resources. IP forwarding allows the Mac to route packets between the VPN subnet (10.100.0.0/24) and your local network (192.168.100.0/24).

---

## Step 6: Configure Firewall (1 minute)

### If using macOS built-in firewall:

```bash
sudo pfctl -e
echo "pass in proto udp from any to any port 51820" | sudo tee -a /etc/pf.conf
sudo pfctl -f /etc/pf.conf
```

### If using router/external firewall:

Forward **UDP port 51820** to your Mac's internal IP

---

## Step 7: Restart LANA-AI (30 seconds)

```bash
pm2 restart lana-chef
```

---

## ✅ Verify Installation

Test the discovery endpoint:

```bash
curl http://localhost:8080/api/health/discovery | jq .discovery.vpn
```

**Expected output:**
```json
{
  "enabled": true,
  "required_for_remote_access": true,
  "public_endpoint": "203.0.113.42:51820",
  "server_public_key": "AbCdEf1234...",
  "config_url": "/api/v1/vpn/client-config"
}
```

If you see this, **VPN is enabled!** 🎉

---

## 📱 User Setup (What Users Need to Do)

When remote users try to connect:

1. **Thin client automatically detects** they're off-network
2. **Redirects to VPN setup page** with instructions
3. User downloads WireGuard for their OS
4. User **logs in to download their personal VPN config**
5. User imports config into WireGuard
6. User clicks "Activate" in WireGuard
7. **Done!** They can now access LANA-AI

---

## 🔧 Common Issues

### "VPN not showing in discovery"

Check `.env` has both flags set to `true`:
```bash
grep VPN_ENABLED .env
grep WIREGUARD_ENABLED .env
```

Restart Chef after changing:
```bash
pm2 restart lana-chef
```

---

### "Clients can't connect to VPN"

Verify firewall allows UDP 51820:
```bash
# Test from outside your network
nc -u -v YOUR_PUBLIC_IP 51820
```

---

### "VPN connects but can't access Chef"

**Most common cause**: IP forwarding is disabled.

Check IP forwarding is enabled:
```bash
sysctl net.inet.ip.forwarding
# Should return: net.inet.ip.forwarding: 1
```

If not enabled (returns 0):
```bash
# Enable temporarily
sudo sysctl -w net.inet.ip.forwarding=1

# Make permanent (survives reboot)
sudo tee /etc/sysctl.conf > /dev/null <<EOF
net.inet.ip.forwarding=1
EOF
```

**Why this happens**:
- IP forwarding is disabled by default on macOS for security
- The `sudo sysctl -w` command is temporary and resets on reboot
- Creating /etc/sysctl.conf makes it permanent
- Without IP forwarding, VPN clients can connect but packets won't route to your network

**Test it works**:
```bash
# From VPN client, ping the VPN gateway
ping 10.100.0.1

# Then ping your Chef server's local IP
ping 192.168.100.50  # Replace with your actual static IP
```

---

## 🔐 Security Notes

### Private Keys
- Each user gets a **unique private key**
- Keys are **encrypted** in the database
- Users download configs via **authenticated endpoint**

### Access Control
- Admins can revoke access: `/api/v1/vpn/revoke`
- View all VPN users: `/api/v1/vpn/peers`

### Network Isolation
- VPN uses **split-tunnel** (only routes LANA network)
- Users' general internet traffic **NOT routed through VPN**
- Customize allowed networks in `.env`

---

## 📚 Next Steps

- Read full documentation: `docs/VPN_IMPLEMENTATION.md`
- Test from remote location
- Update hosted discovery service (separate project)
- Train users on VPN setup

---

## 🗑️ Uninstall VPN (Quick Disable/Remove)

### Option 1: Quick Disable (1 minute)

Use the cleanup script to disable VPN:

```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI
sudo ./scripts/cleanup-vpn.sh
```

**What this does:**
- Stops WireGuard interface
- Disables VPN in `.env`
- Optionally removes config files
- Restarts Chef server

### Option 2: Manual Quick Disable (2 minutes)

```bash
# 1. Stop WireGuard
sudo wg-quick down wg0

# 2. Disable in .env
nano .env
# Change: VPN_ENABLED=false
# Change: WIREGUARD_ENABLED=false

# 3. Restart Chef
pm2 restart lana-chef

# 4. Verify disabled
curl http://localhost:8080/api/health/discovery | jq .discovery.vpn
# Should return: null
```

### Remove Mobile VPN

**iOS:**
1. Open WireGuard app
2. Swipe left on LANA-AI config
3. Tap **Delete**

**Android:**
1. Open WireGuard app
2. Long-press LANA-AI tunnel
3. Tap **Delete**

### Complete Uninstall

To completely remove WireGuard:

```bash
# Uninstall WireGuard
brew uninstall wireguard-tools

# Remove all configs
sudo rm -rf /usr/local/etc/wireguard/

# Clean database
psql -d lana_chef -c "DELETE FROM vpn_peers; DELETE FROM vpn_peer_activation_codes;"

# Disable IP forwarding
sudo sysctl -w net.inet.ip.forwarding=0
sudo rm /etc/sysctl.conf
```

**For complete uninstall documentation:** See [VPN_IMPLEMENTATION.md](VPN_IMPLEMENTATION.md#uninstallation-and-cleanup)

---

## 🆘 Need Help?

Check logs:
```bash
# LANA-AI logs
pm2 logs lana-chef

# WireGuard status
sudo wg show wg0

# System logs
log show --predicate 'process == "wg-quick"' --last 5m
```

---

**Quick Start Version:** 1.1.0
**Last Updated:** 2025-12-10
**For Full Documentation:** See `docs/VPN_IMPLEMENTATION.md`
