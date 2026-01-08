# Scripts Glossary

A comprehensive guide to all scripts in the LanaAI project, when to use them, and what they do.

---

## 📑 Table of Contents

- [Deployment Scripts](#deployment-scripts)
- [Application Management Scripts](#application-management-scripts)
- [Production Configuration Scripts](#production-configuration-scripts)
- [Onboarding Scripts](#onboarding-scripts)
- [Service Management Scripts](#service-management-scripts)
- [Network Configuration Scripts](#network-configuration-scripts)
- [Maintenance Scripts](#maintenance-scripts)
- [Quick Reference](#quick-reference)

---

## Deployment Scripts

### `deploy-prod-mac.sh`
**Location:** `/deploy-prod-mac.sh` (root)
**Purpose:** Main production deployment script for Mac Mini/Studio

**When to run:**
- ✅ Fresh installation on a new Mac
- ✅ Complete system rebuild
- ✅ After OS reinstall

**When NOT to run:**
- ❌ For application updates (use `git pull` + `npm install` + `./run.sh restart`)
- ❌ To start/restart the application (use `./run.sh`)
- ❌ For configuration changes only

**What it does:**
1. Installs Homebrew
2. Installs PostgreSQL 17 with pgvector
3. Installs Node.js 20 LTS
4. Installs PM2 process manager
5. Installs MinIO object storage
6. Installs Ollama LLM service
7. Installs Python 3.11 + Unstructured.io
8. Detects and configures external storage
9. Creates database and schema
10. Generates production `.env` file
11. Creates LaunchAgents for auto-start services
12. Calls `configure-production-settings.sh`
13. **Does NOT start the application** (use `./run.sh`)

**Usage:**
```bash
# Standard deployment
./deploy-prod-mac.sh

# Skip Ollama model downloads (faster, for testing)
./deploy-prod-mac.sh --skip-models
```

**Prerequisites:**
- macOS 13+ (Ventura or later)
- Apple Silicon recommended (M1/M2/M3)
- 50GB+ free disk space
- Administrator/sudo access

**Time:** 30-60 minutes (depends on internet speed and model downloads)

---

## Application Management Scripts

### `run.sh`
**Location:** `/run.sh` (root)
**Purpose:** Start, stop, and manage the LanaAI application

**When to run:**
- ✅ After deployment to start the application for the first time
- ✅ To start the application after reboot
- ✅ To restart after code changes
- ✅ To check application status
- ✅ To view logs

**When NOT to run:**
- ❌ During initial deployment (deployment script will tell you when to run it)
- ❌ If application is already running (unless you want to restart)

**What it does:**
1. Checks PM2 is installed
2. Checks required services are running (PostgreSQL, MinIO, Ollama, Unstructured)
3. Offers to start missing services
4. Checks thin client configuration
5. Starts/restarts/stops the application with PM2
6. Saves PM2 process list

**Usage:**
```bash
# Start the application
./run.sh
# or
./run.sh start

# Stop the application
./run.sh stop

# Restart the application
./run.sh restart

# View application logs
./run.sh logs

# Check application status
./run.sh status

# Open PM2 monitoring dashboard
./run.sh monitor

# Show VPN configuration and status
./run.sh vpn

# Check if public IP changed (dynamic IPs)
./run.sh check-ip
```

**Interactive Features:**
- Prompts to start missing services
- Thin client setup wizard
- Application restart/replace options

---

## Production Configuration Scripts

### `scripts/configure-production-settings.sh`
**Location:** `/scripts/configure-production-settings.sh`
**Purpose:** Configure macOS system settings for 24/7 production server operation

**When to run:**
- ✅ Automatically called by `deploy-prod-mac.sh`
- ✅ On existing systems to add production settings
- ✅ After OS updates that may reset settings
- ✅ To verify/re-apply production settings

**When NOT to run:**
- ❌ On development/desktop Macs (disables sleep and changes system behavior)
- ❌ Without sudo/administrator access

**What it does:**
1. Disables system sleep
2. Disables disk sleep
3. Enables auto-restart on power failure
4. Enables auto-restart on system freeze
5. Configures kernel panic auto-restart
6. Checks FileVault compatibility (warns if enabled)
7. Optimizes Spotlight indexing (disables for data directories)
8. Enables SSH remote access
9. Disables automatic software updates
10. Enables network time synchronization
11. Increases file descriptor limits
12. Configures Gatekeeper securely
13. Disables Time Machine prompts

**Usage:**
```bash
# Interactive mode (prompts for decisions)
sudo ./scripts/configure-production-settings.sh

# Non-interactive mode (automated, used by deploy script)
sudo ./scripts/configure-production-settings.sh --non-interactive

# With specific data directory paths
sudo ./scripts/configure-production-settings.sh \
  --non-interactive \
  --minio-data /path/to/minio \
  --postgres-data /path/to/postgres \
  --ollama-models /path/to/ollama/models
```

**Prerequisites:**
- Requires sudo/administrator access
- Should only be run on dedicated server Macs

**Time:** 2-3 minutes

**⚠️ Important:** This script significantly changes system behavior. Use only on dedicated servers, not development machines.

---

### `scripts/reset-to-factory-settings.sh`
**Location:** `/scripts/reset-to-factory-settings.sh`
**Purpose:** Revert all production server settings back to standard macOS defaults

**When to run:**
- ✅ Decommissioning a production server
- ✅ Converting server Mac back to desktop use
- ✅ Troubleshooting production settings issues
- ✅ Testing deployment scripts

**When NOT to run:**
- ❌ On active production servers
- ❌ If you want to keep 24/7 server operation

**What it does:**
1. Stops all LanaAI services (PM2, LaunchAgents)
2. Re-enables system sleep
3. Disables auto-restart features
4. Re-enables automatic software updates
5. Re-enables screen saver
6. Re-enables Time Machine
7. Restores default file descriptor limits
8. Optionally removes LaunchAgent files
9. Optionally removes PM2 startup configuration
10. Optionally disables SSH

**Usage:**
```bash
sudo ./scripts/reset-to-factory-settings.sh
```

**Interactive:** Yes - prompts before making destructive changes

**Time:** 3-5 minutes

**⚠️ Important:** This stops all services but does NOT uninstall software or delete data.

---

## Onboarding Scripts

### `scripts/onboarding/import_excel_onboarding.py`
**Location:** `/scripts/onboarding/import_excel_onboarding.py`
**Purpose:** Import customer onboarding data from Excel to PostgreSQL

**When to run:**
- ✅ Initial customer setup
- ✅ Bulk import of organization data
- ✅ After modifying onboarding Excel file

**What it does:**
1. Reads `config/onboarding/onboarding.xlsx`
2. Validates data structure
3. Imports organization information to database
4. Creates initial customer configuration

**Usage:**
```bash
python scripts/onboarding/import_excel_onboarding.py
```

**Prerequisites:**
- PostgreSQL running
- Correct database credentials in `.env`
- Valid Excel file at `config/onboarding/onboarding.xlsx`

**Time:** < 1 minute

---

### `onboard_customer.sh`
**Location:** `/onboard_customer.sh` (root)
**Purpose:** Interactive customer onboarding wizard

**When to run:**
- ✅ Setting up a new customer
- ✅ Guided onboarding process

**What it does:**
1. Guides through customer information collection
2. Creates organization records
3. Sets up initial configuration
4. Generates activation codes

**Usage:**
```bash
./onboard_customer.sh
```

**Interactive:** Yes - wizard-style prompts

**Time:** 5-10 minutes

---

## Service Management Scripts

### `scripts/start_minio.sh`
**Location:** `/scripts/start_minio.sh`
**Purpose:** Start MinIO object storage service

**When to run:**
- ✅ Rarely needed (LaunchAgent auto-starts)
- ✅ Manual troubleshooting
- ✅ After stopping MinIO manually

**What it does:**
- Starts MinIO server with configured data directory
- Can run in foreground or background mode

**Usage:**
```bash
./scripts/start_minio.sh --background
```

**Time:** Instant

---

### `scripts/start_unstructured_api.sh`
**Location:** `/scripts/start_unstructured_api.sh`
**Purpose:** Start Unstructured.io document parsing API

**When to run:**
- ✅ Rarely needed (LaunchAgent auto-starts)
- ✅ Manual troubleshooting
- ✅ After stopping Unstructured manually

**What it does:**
- Starts Unstructured API server
- Required for document parsing functionality

**Usage:**
```bash
./scripts/start_unstructured_api.sh --background
```

**Time:** Instant

---

## Network Configuration Scripts

### `scripts/setup-network.sh`
**Location:** `/scripts/setup-network.sh`
**Purpose:** Configure VPN and network settings

**When to run:**
- ✅ Setting up VPN for remote access
- ✅ Configuring network security
- ✅ Multi-location deployments

**What it does:**
1. Configures WireGuard VPN
2. Sets up network routing
3. Configures firewall rules
4. Tests connectivity

**Usage:**
```bash
sudo ./scripts/setup-network.sh
```

**Prerequisites:**
- Requires sudo access
- VPN configuration details

**Documentation:** See `docs/VPN_IMPLEMENTATION.md`

**Time:** 5-10 minutes

---

### `scripts/setup-wireguard.sh`
**Location:** `/scripts/setup-wireguard.sh`
**Purpose:** Set up WireGuard VPN server on macOS

**When to run:**
- ✅ First-time VPN setup
- ✅ Regenerating WireGuard server keys
- ✅ After VPN configuration was deleted

**When NOT to run:**
- ❌ If WireGuard is already configured (will skip key generation)
- ❌ Without sudo access

**What it does:**
1. Checks WireGuard installation (via Homebrew)
2. Generates server private/public keys (if not exist)
3. Creates `/usr/local/etc/wireguard/wg0.conf`
4. Configures IP forwarding
5. Updates `.env` with VPN configuration
6. Displays server public key for client configs

**Usage:**
```bash
sudo ./scripts/setup-wireguard.sh
```

**Interactive:** Yes - prompts for IP forwarding configuration

**Prerequisites:**
- WireGuard tools installed (`brew install wireguard-tools`)
- Sudo access
- `.env` file exists

**Time:** 2-3 minutes

**Output:**
- Server keys at `/usr/local/etc/wireguard/server_*.key`
- Config file at `/usr/local/etc/wireguard/wg0.conf`
- Updated `.env` with VPN settings

**Next Steps:**
```bash
# Start WireGuard
sudo wg-quick up wg0

# Verify running
sudo wg show

# Start application
./run.sh
```

---

### `scripts/check-ip-change.sh`
**Location:** `/scripts/check-ip-change.sh`
**Purpose:** Monitor public IP address and alert when it changes

**When to run:**
- ✅ Manually: Check if public IP changed
- ✅ Automatically: Via cron job (hourly monitoring)
- ✅ After router reboot
- ✅ After ISP maintenance

**When NOT to run:**
- ❌ If you have a static IP (no need to monitor)
- ❌ If using Dynamic DNS (DDNS handles updates)

**What it does:**
1. Fetches current public IP from multiple services
2. Compares with cached IP from last check
3. If changed:
   - Sends macOS notification
   - Logs change to file
   - Prompts to auto-update `.env`
   - Shows required manual steps
4. If unchanged:
   - Verifies `.env` matches current IP
   - Logs check result

**Usage:**
```bash
# Manual check
./scripts/check-ip-change.sh

# Set up automatic monitoring (hourly)
(crontab -l; echo "0 * * * * $(pwd)/scripts/check-ip-change.sh") | crontab -

# Check via run.sh
./run.sh check-ip
```

**Interactive:** Yes - prompts to auto-update `.env` if IP changed

**Prerequisites:**
- Internet connection
- `.env` file with `WIREGUARD_PUBLIC_ENDPOINT`

**Time:** < 10 seconds

**Output:**
- Log file: `~/Library/Logs/LanaAI/ip-change.log`
- IP cache: `/tmp/lana-vpn-ip.cache`
- macOS notification (if IP changed)

**What happens when IP changes:**
```
⚠️  IP CHANGED! Old: 24.99.172.140 → New: 24.99.172.150

REQUIRED ACTIONS:
1. Update .env file
2. Restart LANA-AI application
3. Update hosted discovery service
4. Regenerate VPN configs for all users
```

**Cron Setup Example:**
```bash
# Check every hour
0 * * * * /Users/redroostertechnologies/Desktop/LANA-AI/scripts/check-ip-change.sh

# Check every 30 minutes
*/30 * * * * /Users/redroostertechnologies/Desktop/LANA-AI/scripts/check-ip-change.sh

# Check once daily at 3am
0 3 * * * /Users/redroostertechnologies/Desktop/LANA-AI/scripts/check-ip-change.sh
```

**⚠️ Important:** Only needed if you have a dynamic IP. Get a static IP or use DDNS for production.

---

### `scripts/cleanup-vpn.sh`
**Location:** `/scripts/cleanup-vpn.sh`
**Purpose:** Remove VPN configuration

**When to run:**
- ✅ Removing VPN setup
- ✅ Troubleshooting VPN issues
- ✅ Changing VPN configuration

**What it does:**
- Removes WireGuard interfaces
- Cleans up routing rules
- Removes firewall rules

**Usage:**
```bash
sudo ./scripts/cleanup-vpn.sh
```

**Time:** < 1 minute

---

### `scripts/external-storage.sh`
**Location:** `/scripts/external-storage.sh`
**Purpose:** Detect and configure external storage drives

**When to run:**
- ✅ Automatically called by `deploy-prod-mac.sh`
- ✅ Adding external storage after initial deployment
- ✅ Reconfiguring storage

**What it does:**
1. Detects external drives
2. Identifies suitable drives for data storage
3. Configures mount points
4. Creates `.storage-configured` file
5. Sets up directories for MinIO, PostgreSQL, Ollama

**Usage:**
```bash
sudo ./scripts/external-storage.sh configure
```

**Time:** 2-3 minutes

---

### `scripts/setup/setup-thin-client.sh`
**Location:** `/scripts/setup/setup-thin-client.sh`
**Purpose:** Configure thin client (Electron app) auto-discovery

**When to run:**
- ✅ Setting up organization identity for thin clients
- ✅ Enabling Bonjour/mDNS discovery
- ✅ Configuring update policies

**What it does:**
1. Creates organization identity in database
2. Configures Bonjour/mDNS advertising
3. Sets up update policies
4. Tests thin client connectivity

**Usage:**
```bash
./scripts/setup/setup-thin-client.sh --org-id "company-name" --org-name "Company Name"

# With static IP
./scripts/setup/setup-thin-client.sh --org-id "company-name" --org-name "Company Name" --static-ip "192.168.1.100"
```

**Interactive Alternative:** Run `./run.sh` and it will prompt if thin client is not configured

**Time:** 2-3 minutes

---

## Maintenance Scripts

### Database Migrations
**Location:** `/src/migrations/*.sql`
**Purpose:** Database schema updates

**When to run:**
- ✅ After pulling code changes that include migrations
- ✅ Upgrading database schema

**Usage:**
```bash
psql -d lana_chef -f src/migrations/migration_name.sql
```

---

## Quick Reference

### Fresh Mac Setup (Complete)
```bash
# 1. Deploy (installs everything, configures system)
./deploy-prod-mac.sh

# 2. Start the application
./run.sh
```

**Time:** 30-60 minutes + application startup

---

### Daily Operations

```bash
# Start application
./run.sh

# Check status
./run.sh status
pm2 status

# View logs
./run.sh logs
pm2 logs lana-api

# Restart after code changes
git pull
npm install
./run.sh restart
```

---

### VPN Testing & Management

```bash
# Set up WireGuard VPN (first time)
sudo ./scripts/setup-wireguard.sh

# Start WireGuard interface
sudo wg-quick up wg0

# Check VPN status
sudo wg show
./run.sh vpn

# Check if public IP changed
./run.sh check-ip
curl ifconfig.me

# Monitor IP automatically (hourly)
(crontab -l; echo "0 * * * * $(pwd)/scripts/check-ip-change.sh") | crontab -

# Test VPN locally (on-site)
# 1. From Mac
curl http://10.0.0.3:8080/api/health/discovery

# 2. From phone/laptop on same WiFi
# Visit: http://10.0.0.3:8080/login.html

# Test VPN remotely (requires port forwarding)
# 1. Download VPN config (while on-site)
# Visit: http://10.0.0.3:8080/vpn-setup.html

# 2. Import to WireGuard app on mobile device

# 3. Connect VPN from mobile data

# 4. Access via VPN
# Visit: http://10.0.0.3:8080/login.html

# Stop WireGuard
sudo wg-quick down wg0
```

**Time:** 5-10 minutes for initial setup

**⚠️ Port Forwarding Required for Remote Access:**
- NOT needed for on-site testing
- REQUIRED for remote VPN connections
- Configure in router admin panel (see `./run.sh vpn` for details)

---

### After Code Updates

```bash
# 1. Pull latest code
git pull

# 2. Install new dependencies
npm install

# 3. Run any new migrations
psql -d lana_chef -f src/migrations/new_migration.sql

# 4. Restart application
./run.sh restart
```

**Time:** 2-5 minutes

---

### Service Troubleshooting

```bash
# Check all services
./run.sh status
pm2 status
brew services list

# Check specific service ports
lsof -i :5432    # PostgreSQL
lsof -i :9000    # MinIO
lsof -i :11434   # Ollama
lsof -i :8000    # Unstructured
lsof -i :8080    # LanaAI App

# Restart background services
launchctl unload ~/Library/LaunchAgents/com.lana.*.plist
launchctl load ~/Library/LaunchAgents/com.lana.*.plist

# Restart application
./run.sh restart
```

---

### Production Server Maintenance

```bash
# Re-apply production settings
sudo ./scripts/configure-production-settings.sh --non-interactive

# Check power management
pmset -g

# Check auto-restart settings
systemsetup -getrestartpowerfailure
pmset -g | grep autorestart

# Check FileVault status
sudo fdesetup status

# Check SSH status
systemsetup -getremotelogin
```

---

## Decision Tree

### "Should I run deploy-prod-mac.sh?"

```
Is this a brand new Mac or fresh OS install?
├─ YES → Run deploy-prod-mac.sh
└─ NO → Continue...

Did you just rebuild/wipe the Mac?
├─ YES → Run deploy-prod-mac.sh
└─ NO → Continue...

Do you just want to update code?
├─ YES → git pull + npm install + ./run.sh restart
└─ NO → Continue...

Do you just want to start the app?
├─ YES → ./run.sh
└─ NO → Continue...

Do you want to add production settings?
├─ YES → sudo ./scripts/configure-production-settings.sh
└─ NO → You probably don't need to run any deployment scripts
```

---

### "Which script starts the application?"

```
Is the application already running?
├─ YES → ./run.sh restart (to restart)
└─ NO → ./run.sh (to start)

NOT deploy-prod-mac.sh!
```

---

### "I need to configure production settings"

```
Is this during initial deployment?
├─ YES → deploy-prod-mac.sh calls it automatically
└─ NO → Continue...

Is this an existing system?
├─ YES → sudo ./scripts/configure-production-settings.sh
└─ NO → See above

Want to revert to desktop mode?
└─ YES → sudo ./scripts/reset-to-factory-settings.sh
```

---

## Script Execution Order (Fresh Deployment)

1. **deploy-prod-mac.sh** *(30-60 min)*
   - Installs all dependencies
   - Calls **external-storage.sh** *(if external drives present)*
   - Calls **configure-production-settings.sh** *(automatic)*
   - Creates database and .env

2. **run.sh** *(manual, 1 min)*
   - May call **setup-thin-client.sh** *(optional, interactive)*
   - Starts application with PM2

3. **onboard_customer.sh** or **import_excel_onboarding.py** *(optional, 5-10 min)*
   - Set up first customer

---

## Common Mistakes

### ❌ Running deploy-prod-mac.sh to start the app
**Correct:** Use `./run.sh` to start the application

### ❌ Running configure-production-settings.sh without sudo
**Correct:** `sudo ./scripts/configure-production-settings.sh`

### ❌ Running production settings on development Mac
**Correct:** Only run on dedicated production servers

### ❌ Expecting deploy-prod-mac.sh to start the app
**Correct:** Deployment configures, `./run.sh` starts

### ❌ Forgetting to run ./run.sh after deployment
**Correct:** Always run `./run.sh` after `deploy-prod-mac.sh`

---

## Script Dependencies

| Script | Requires |
|--------|----------|
| deploy-prod-mac.sh | sudo, internet, 50GB+ disk |
| run.sh | PM2, PostgreSQL, MinIO, Ollama, Unstructured |
| configure-production-settings.sh | sudo |
| reset-to-factory-settings.sh | sudo |
| external-storage.sh | sudo, external drives |
| setup-network.sh | sudo, VPN config |
| setup-thin-client.sh | PostgreSQL, .env |
| import_excel_onboarding.py | PostgreSQL, Excel file |

---

## Troubleshooting

### "deploy-prod-mac.sh failed partway through"
- Script is designed to be re-runnable
- It will skip already-installed components
- Safe to run again

### "Application won't start"
```bash
# Check services
./run.sh status

# Check PM2
pm2 list

# Check logs
./run.sh logs
pm2 logs lana-api

# Check dependencies
lsof -i :5432  # PostgreSQL
lsof -i :9000  # MinIO
lsof -i :11434 # Ollama
```

### "Services don't auto-start after reboot"
```bash
# Check LaunchAgents
launchctl list | grep com.lana

# Reload LaunchAgents
launchctl unload ~/Library/LaunchAgents/com.lana.*.plist
launchctl load ~/Library/LaunchAgents/com.lana.*.plist

# Check PM2 startup
pm2 startup
pm2 save
```

### "System is sleeping despite production settings"
```bash
# Re-apply settings
sudo ./scripts/configure-production-settings.sh --non-interactive

# Check current settings
pmset -g

# Check for processes preventing wake
pmset -g assertions
```

---

## Documentation Cross-Reference

- **Production Settings:** `docs/PRODUCTION_SETTINGS.md`
- **Architecture Changes:** `docs/ARCHITECTURE_CHANGES.md`
- **Production Settings Summary:** `docs/PRODUCTION_SETTINGS_SUMMARY.md`
- **VPN Implementation:** `docs/VPN_IMPLEMENTATION.md`
- **VPN Quick Start:** `docs/VPN_QUICKSTART.md`
- **VPN Mobile & Deployment:** `docs/VPN_MOBILE_SETUP_AND_DEPLOYMENT.md`
- **VPN Port Forwarding Guide:** `docs/VPN_PORT_FORWARDING_GUIDE.md` *(When is port forwarding needed?)*
- **Scripts Overview:** `scripts/README.md`
- **Changelog:** `CHANGELOG.md`

---

**Last Updated:** 2024-12-10
**Maintained By:** LanaAI Team
**Questions?** Check the documentation links above or review individual script comments.
