# Thin Client Setup Script Usage Guide

## Overview

The `setup-thin-client.sh` script configures your Mac Studio server for thin client deployments. It sets up Bonjour/mDNS service discovery, creates database tables, and configures the organization identity.

**Location:** `scripts/setup/setup-thin-client.sh`

---

## Basic Usage

```bash
./scripts/setup/setup-thin-client.sh --org-id "your-org-id" \
                                     --org-name "Your Organization Name" \
                                     --static-ip "192.168.1.100"
```

---

## Required Parameters

### `--org-id` (REQUIRED)

**Description**: Unique identifier for your organization. Used in database and service discovery.

**Format**: 
- Lowercase letters, numbers, and hyphens only
- 3-50 characters
- No spaces or special characters

**Examples**:
```bash
--org-id "norton-estate-planning"   ✅ Good
--org-id "smith-law-firm"           ✅ Good
--org-id "acme-corp"                ✅ Good

--org-id "Norton Estate Planning"   ❌ Bad (spaces, capitals)
--org-id "smith_law"                ❌ Bad (underscores not allowed)
--org-id "ab"                       ❌ Bad (too short)
```

---

### `--org-name` (REQUIRED)

**Description**: Human-readable organization name. Displayed to users during discovery.

**Format**:
- Any characters allowed
- 2-100 characters
- Can include spaces, punctuation, etc.

**Examples**:
```bash
--org-name "Norton Estate Planning"              ✅ Good
--org-name "Smith & Associates Legal Group"      ✅ Good
--org-name "ACME Corporation"                    ✅ Good
```

---

### `--static-ip` (STRONGLY RECOMMENDED)

**Description**: The IP address clients will use to connect to this server.

**Why is it important?**
- Auto-detection may pick the wrong interface on multi-homed systems
- VPN interfaces, Docker networks, etc. can confuse auto-detection
- Critical for proper client connectivity

**Format**: IPv4 address (xxx.xxx.xxx.xxx)

**How to find your IP**:

```bash
# Method 1: Check all interfaces
ifconfig | grep "inet " | grep -v "127.0.0.1"

# Method 2: Check specific interface
ipconfig getifaddr en0      # Usually WiFi
ipconfig getifaddr en1      # Usually Ethernet

# Method 3: Check VPN IP (if using VireGuard)
ipconfig getifaddr utun3    # VPN interface (number may vary)

# Method 4: If you set it up with set-static-ip-mac.sh
# Check that script's configuration
```

**Examples**:

```bash
# Customer has existing network
--static-ip "192.168.1.100"

# Using WireGuard VPN
--static-ip "10.100.0.1"

# Using Tailscale
--static-ip "100.64.0.26"

# Using customer's VPN
--static-ip "10.10.50.5"
```

---

## Optional Parameters

### `--force`

**Description**: Force reinstallation even if already configured.

**When to use**: 
- Changing organization details
- Fixing a broken installation
- Re-running after manual changes

**Example**:
```bash
./scripts/setup/setup-thin-client.sh --org-id "test-org" \
                       --org-name "Test Org" \
                       --static-ip "192.168.1.100" \
                       --force
```

---

## Complete Examples

### Example 1: New Installation (Recommended)

```bash
./scripts/setup/setup-thin-client.sh \
  --org-id "norton-estate-planning" \
  --org-name "Norton Estate Planning" \
  --static-ip "100.64.0.26"
```

**Output**:
```
============================================================================
  Thin Client Setup - Pre-flight Checks
============================================================================
[+] Organization ID: norton-estate-planning
[+] Organization Name: Norton Estate Planning
[+] Using provided static IP: 100.64.0.26
[✓] PostgreSQL connection verified
[✓] Node.js project found
...
```

---

### Example 2: Let Script Auto-Detect IP (Not Recommended)

```bash
./scripts/setup/setup-thin-client.sh \
  --org-id "test-org" \
  --org-name "Test Organization"
```

**Output**:
```
[!] No static IP provided, attempting auto-detection...
[!] Auto-detected IP: 192.168.1.50
[!] If this is incorrect, stop and re-run with --static-ip

Available network interfaces:
en0: inet 192.168.1.50 netmask 0xffffff00
en1: inet 10.0.0.5 netmask 0xffffff00

Is 192.168.1.50 the correct IP for clients to connect to? (y/n)
```

**What to do**: 
- If IP is correct, press `y`
- If IP is wrong, press `n` and re-run with correct `--static-ip`

---

### Example 3: Re-run with Force (Update Configuration)

```bash
# First run
./scripts/setup/setup-thin-client.sh --org-id "old-org" --org-name "Old Org" --static-ip "10.0.0.1"

# Later, update configuration
./scripts/setup/setup-thin-client.sh --org-id "new-org" --org-name "New Org" --static-ip "10.0.0.2" --force
```

---

## Common Scenarios

### Scenario 1: Customer Has Existing VPN

```bash
# Customer tells you: "Our VPN assigns 10.50.x.x addresses"
# Mac Studio gets: 10.50.10.5

./scripts/setup/setup-thin-client.sh \
  --org-id "customer-law-firm" \
  --org-name "Customer Law Firm" \
  --static-ip "10.50.10.5"
```

---

### Scenario 2: Using WireGuard VPN (You Configured)

```bash
# You set up WireGuard with subnet 10.100.0.0/24
# Mac Studio is: 10.100.0.1

./scripts/setup/setup-thin-client.sh \
  --org-id "customer-attorneys" \
  --org-name "Customer Attorneys at Law" \
  --static-ip "10.100.0.1"
```

---

### Scenario 3: Local Network Only (Office)

```bash
# Mac Studio is on local network: 192.168.1.100
# No VPN needed, office only

./scripts/setup/setup-thin-client.sh \
  --org-id "local-practice" \
  --org-name "Local Practice" \
  --static-ip "192.168.1.100"
```

---

### Scenario 4: Tailscale VPN

```bash
# Tailscale assigns: 100.64.0.26

./scripts/setup/setup-thin-client.sh \
  --org-id "remote-firm" \
  --org-name "Remote Law Firm" \
  --static-ip "100.64.0.26"
```

---

## Verification After Setup

After running the script, verify everything works:

### 1. Check Database

```bash
psql -h 127.0.0.1 -U $(whoami) -d lana_chef -c \
  "SELECT * FROM organization_identity;"
```

**Expected output**:
```
 id |        org_id         |     org_name      |  static_ip   | ...
----+-----------------------+-------------------+--------------+-----
  1 | norton-estate-planning| Norton Estate...  | 100.64.0.26  | ...
```

---

### 2. Check Bonjour Service

```bash
dns-sd -B _lana._tcp
```

**Expected output**:
```
Browsing for _lana._tcp
Timestamp     A/R  Flags  if Domain  Service Type  Instance Name
...
ADD     ... _lana._tcp.  LANA AI - Norton Estate Planning
```

Press `Ctrl+C` to stop after seeing the service.

---

### 3. Check API Endpoints

```bash
# Health/Discovery endpoint
curl http://localhost:8080/api/health/discovery | jq

# Should return:
# {
#   "status": "healthy",
#   "server": {
#     "org_id": "norton-estate-planning",
#     "org_name": "Norton Estate Planning",
#     ...
#   }
# }

# Bonjour status
curl http://localhost:8080/api/bonjour/status | jq

# Update policy
curl http://localhost:8080/api/client/update-policy
```

---

## Troubleshooting

### "PostgreSQL connection failed"

**Cause**: PostgreSQL is not running or database doesn't exist.

**Fix**:
```bash
# Start PostgreSQL
brew services start postgresql@17

# Check if running
psql -h 127.0.0.1 -U $(whoami) -d lana_chef -c "SELECT 1;"
```

---

### "Invalid IP address format"

**Cause**: Provided IP doesn't match xxx.xxx.xxx.xxx format.

**Fix**: Provide a valid IPv4 address:
```bash
./scripts/setup/setup-thin-client.sh ... --static-ip "192.168.1.100"
```

---

### "Organization ID must contain only lowercase letters..."

**Cause**: org-id has invalid characters.

**Fix**: Use only lowercase letters, numbers, and hyphens:
```bash
# Wrong
--org-id "My_Org"

# Correct
--org-id "my-org"
```

---

### "Auto-detected wrong IP"

**Cause**: System has multiple network interfaces.

**Fix**: Provide the correct IP manually:
```bash
# Find all IPs
ifconfig | grep "inet "

# Use the correct one
./scripts/setup/setup-thin-client.sh ... --static-ip "10.0.0.5"
```

---

## Best Practices

1. **Always provide --static-ip**: Don't rely on auto-detection
2. **Use descriptive org-id**: Makes troubleshooting easier
3. **Document the IP**: Keep a record of which IP you used
4. **Verify after setup**: Run the verification commands above
5. **Test from client**: Build and test a client to ensure connectivity

---

## What This Script Does

1. ✅ Validates inputs (org-id format, IP format, lengths)
2. ✅ Checks prerequisites (PostgreSQL, Node.js)
3. ✅ Creates database tables (`client_update_policy`, `organization_identity`)
4. ✅ Installs Bonjour npm package
5. ✅ Creates Bonjour service module
6. ✅ Creates API endpoints
7. ✅ Integrates routes into server
8. ✅ Restarts PM2 service
9. ✅ Verifies installation

---

## After Setup: Building Clients

Once setup is complete, build clients:

### Option 1: Auto-Discovery Client (Recommended)

```bash
npm install bonjour electron-store axios
./scripts/build-client.sh --demo
```

Clients will automatically discover the server using Bonjour.

### Option 2: Hardcoded IP Client (Fallback)

```bash
./scripts/build-client.sh --ip 100.64.0.26:8080
```

Clients will connect directly to this IP (no discovery).

---

**Pro Tip**: Use Option 1 (auto-discovery) for most deployments. It's more flexible and handles IP changes gracefully.
