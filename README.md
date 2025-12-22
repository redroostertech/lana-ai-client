# LanaAI Chef

**Backend API service for LanaAI** - A legal practice management AI assistant with document processing, embeddings, and intelligent automation.

## Table of Contents

- [Overview](#overview)
- [System Requirements](#system-requirements)
- [Quick Start](#quick-start)
- [Fresh System Deployment](#fresh-system-deployment)
- [Desktop Client Build](#desktop-client-build)
- [Customer Onboarding](#customer-onboarding)
- [Scripts Reference](#scripts-reference)
- [Service Architecture](#service-architecture)
- [External Storage Setup](#external-storage-setup)
- [Network Configuration](#network-configuration)
- [Managing the Application](#managing-the-application)
- [Troubleshooting](#troubleshooting)

---

## Overview

LanaAI Chef is a Node.js backend service that provides:

- **Document Processing** - Parse and extract content from legal documents (PDF, DOCX, etc.)
- **Vector Embeddings** - pgvector-powered semantic search with Ollama
- **MinIO Storage** - S3-compatible object storage for documents
- **AI Integration** - Local LLM inference via Ollama
- **Workflow Automation** - pg-boss job queue for background processing

---

## System Requirements

### Hardware (Recommended)
- **CPU**: Apple Silicon (M1/M2/M3) or Intel with 8+ cores
- **RAM**: 32GB minimum, 64GB+ recommended for AI models
- **Storage**: 500GB+ SSD (external NVMe SSDs recommended for production)

### Software
- **macOS**: 13.0 (Ventura) or later
- **Xcode Command Line Tools**: Required for Homebrew
- **Node.js**: 20 LTS or later
- **Python**: 3.11 (for Unstructured.io)

---

## Quick Start

If you have an existing deployment and just need to start the app:

```bash
cd ~/Documents/Lana-AI-Chef
./run.sh
```

---

## Fresh System Deployment

### Deployment Order

Follow these steps **in order** for a fresh macOS system:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PRODUCTION DEPLOYMENT ORDER (Run on Mac Studio)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. ./deploy-prod-mac.sh                                                │
│     └── Installs PostgreSQL 17, MinIO, Ollama, Node.js, Python, etc.   │
│     └── Configures external storage (if available)                      │
│     └── Creates database schemas and .env file                          │
│                                                                         │
│  2. ./onboard_customer.sh                                               │
│     └── Seeds database with organization, users, and roles              │
│     └── Reads from config/onboarding/onboarding.xlsx                    │
│                                                                         │
│  3. ./run.sh                                                            │
│     └── Starts all services (auto-starts missing ones)                  │
│     └── Launches Node.js app with PM2                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│  THIN CLIENT BUILD (Can run on ANY Mac - local or remote)               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  The thin client (Electron app) can be built from any macOS machine     │
│  with access to the repository. This enables remote team members to     │
│  generate and distribute client builds without access to the server.    │
│                                                                         │
│  ./scripts/build-client.sh --ip <server-static-ip>                      │
│     └── Builds the Electron desktop client                              │
│     └── Server IP is baked into the client during build                 │
│     └── Output: dist/LanaAI-*.dmg                                       │
│                                                                         │
│  Examples:                                                              │
│     # Build with explicit IP                                            │
│     ./scripts/build-client.sh --ip 100.64.0.26                          │
│                                                                         │
│     # Build using IP from .env (if available)                           │
│     ./scripts/build-client.sh --ip                                      │
│                                                                         │
│  Requirements for remote builds:                                        │
│     - macOS with Node.js installed                                      │
│     - Clone of the repository                                           │
│     - Know the server's static IP address                               │
│                                                                         │
│  The built .dmg can then be distributed to end users via:               │
│     - Direct file sharing                                               │
│     - GitHub Releases                                                   │
│     - Internal distribution server                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Optional setup scripts** (can be run before or after):
- `scripts/setup/setup-prod-ssh.sh` - Enable SSH access for remote management
- `scripts/setup-network.sh` - Configure static IP for thin client access (recommended)
- `scripts/setup/set-static-ip-mac.sh` - Legacy static IP script (use setup-network.sh instead)

---

### Step 1: Clone the Repository

```bash
cd ~/Documents
git clone <repository-url> Lana-AI-Chef
cd Lana-AI-Chef
```

### Step 2: Run the Deployment Script

This is the main installation script that sets up everything:

```bash
./deploy-prod-mac.sh
```

**What it installs:**
- Homebrew (if not present)
- PostgreSQL 17 with pgvector extension
- MinIO (S3-compatible object storage)
- Ollama (local LLM inference)
- Node.js 20 LTS
- PM2 (process manager)
- Python 3.11 + Unstructured.io
- All npm dependencies

**What it configures:**
- External storage (if available via `scripts/external-storage.sh`)
- Database schemas
- LaunchAgents for auto-start
- Production `.env` file

⏱️ **Duration**: 15-30 minutes (depending on AI model downloads)

### Step 3: Onboard Customer Data

Seed the database with your organization, users, and roles:

```bash
./onboard_customer.sh
```

**Prerequisites:**
- Place your Excel onboarding file at `config/onboarding/onboarding.xlsx`
- See [Customer Onboarding](#customer-onboarding) for details

⏱️ **Duration**: 1-2 minutes

### Step 4: Start the Application

```bash
./run.sh
```

The `run.sh` script will:
- Check if all services are running (PostgreSQL, MinIO, Ollama, Unstructured)
- Offer to start any missing services automatically
- Start the Node.js app with PM2

### Step 5: Verify All Services

```bash
# Check service status
./run.sh status

# Or manually check ports
lsof -i :5432   # PostgreSQL
lsof -i :8080   # LanaAI App
lsof -i :9000   # MinIO
lsof -i :11434  # Ollama
lsof -i :8000   # Unstructured
```

---

## Desktop Client Build

LanaAI includes an Electron-based **thin client** that can be distributed to end users. The client is a lightweight desktop application that connects to the LanaAI backend server.

### What is the Thin Client?

The thin client is a desktop wrapper around the web frontend. It:
- **Includes**: HTML, JavaScript, CSS (the web UI)
- **Excludes**: All backend code, Node.js modules, database connections
- **Connects to**: Your LanaAI backend server via HTTP

### Server Discovery

The client uses a **hosted discovery service** to find the backend server:
- Client queries `https://www.redroostertec.com/lana-ai/v1/discovery` on startup
- Server is registered with the discovery service during deployment
- Zero configuration for end users - just install and log in
- Works across networks without local network discovery requirements

### Prerequisites

Ensure dependencies are installed:

```bash
cd ~/Documents/Lana-AI-Chef
npm install
```

### Building the Client

Use the build script to create installers:

```bash
# Build for ALL platforms (Mac, Windows, Linux)
./scripts/build-client.sh

# Build for specific platform
./scripts/build-client.sh --platform mac
```

### Build Script Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ip <ip:port>` | Backend server IP and port (required) | - |
| `--platform <platform>` | Target: `mac`, `win`, `linux`, `all` | `all` |
| `--arch <arch>` | Architecture: `x64`, `arm64`, `all` | `all` |
| `--clean` | Clean build directories first | false |
| `--skip-install` | Skip npm install | false |
| `--demo` | Build demo mode (no backend) | false |

### Build Examples

```bash
# Build for all platforms
./scripts/build-client.sh --ip 192.168.1.100:8080

# Build only for macOS (Apple Silicon)
./scripts/build-client.sh --ip 192.168.1.100:8080 --platform mac --arch arm64

# Build only for Windows
./scripts/build-client.sh --ip 192.168.1.100:8080 --platform win

# Build only for Linux
./scripts/build-client.sh --ip 192.168.1.100:8080 --platform linux

# Clean build (remove previous builds first)
./scripts/build-client.sh --ip 192.168.1.100:8080 --clean

# Build demo version (for trade shows, no server needed)
./scripts/build-client.sh --demo
```

### Output Structure

After building, installers are organized by platform in the `dist/` directory:

```
dist/
├── macos-arm64/                    # Apple Silicon Macs (M1/M2/M3)
│   ├── LanaAI--genesis--01-arm64.dmg
│   └── LanaAI--genesis--01-arm64.zip
│
├── macos-x64/                      # Intel Macs
│   ├── LanaAI--genesis--01-x64.dmg
│   └── LanaAI--genesis--01-x64.zip
│
├── windows/                        # Windows PCs
│   ├── LanaAI--genesis--01-setup.exe
│   └── LanaAI--genesis--01.zip
│
└── linux/                          # Linux PCs
    ├── LanaAI--genesis--01.AppImage
    ├── LanaAI--genesis--01.deb
    └── LanaAI--genesis--01.rpm
```

### Distribution Guide

| User's Computer | Send This File |
|-----------------|----------------|
| Mac (M1/M2/M3 Apple Silicon) | `dist/macos-arm64/LanaAI--genesis--01-arm64.dmg` |
| Mac (Intel) | `dist/macos-x64/LanaAI--genesis--01-x64.dmg` |
| Windows | `dist/windows/LanaAI--genesis--01-setup.exe` |
| Linux (Ubuntu/Debian) | `dist/linux/LanaAI--genesis--01.deb` |
| Linux (Fedora/RHEL) | `dist/linux/LanaAI--genesis--01.rpm` |
| Linux (Universal) | `dist/linux/LanaAI--genesis--01.AppImage` |

### How It Works

1. **Build time**: The script updates `public_html/js/config.js` with the backend IP
2. **Package**: Electron bundles the HTML/JS frontend into a native app
3. **Distribution**: Users install the app on their machines
4. **Runtime**: App connects to your backend server at the configured IP

### Development Mode

Run the Electron app locally with Chrome DevTools enabled for debugging:

```bash
# First time setup (rebuilds native modules for Electron)
npm install && npm run electron:rebuild

# Run with DevTools open
npm run electron:dev
```

This launches the app with:
- Chrome DevTools automatically opened
- Debug logging enabled
- Hot reload for frontend changes (if configured)

**Note:** The backend server must be running for the client to connect. The Electron client is a thin client that connects to a remote LanaAI server.

#### CommonJS Compatibility

Several dependencies are pinned to specific versions to maintain CommonJS compatibility with Electron:

| Package | Version | Reason |
|---------|---------|--------|
| `pg-boss` | ^9.0.3 | v10+ is ESM-only |
| `uuid` | ^9.0.1 | v10+ is ESM-only |
| `dotenv` | ^16.4.5 | v17+ is ESM-only |
| `zod` | ^3.23.8 | v4+ is ESM-only |

Do not upgrade these packages beyond the specified major versions without testing Electron compatibility.

### Important Notes

- ⚠️ **Backend must be running**: Users need network access to the backend server
- 🔒 **No code signing**: Builds are unsigned; users may see security warnings on first launch
- 📦 **App size**: ~100-150MB (includes Chromium runtime)
- 🌐 **Network required**: The thin client requires connectivity to the backend

### Cross-Platform Building Notes

Building for all platforms from a single machine has limitations:

| Host Machine | Can Build |
|--------------|-----------|
| macOS (ARM64) | ✅ Mac ARM64, ✅ Mac x64*, ✅ Windows, ✅ Linux |
| macOS (Intel) | ✅ Mac x64, ⚠️ Mac ARM64*, ✅ Windows, ✅ Linux |
| Windows | ❌ Mac, ✅ Windows, ✅ Linux |
| Linux | ❌ Mac, ✅ Windows, ✅ Linux |

*Cross-architecture Mac builds may have issues with native modules.

**Recommendation**: Build for your current architecture first, then build other platforms as needed.

```bash
# Build for current Mac architecture only
./scripts/build-client.sh --ip 100.64.0.26:8080 --platform mac --arch current
```

---

## Customer Onboarding

The onboarding system allows you to bulk-import organizations, users, roles, and configuration from an Excel file.

### Excel Template

Place your Excel onboarding file at:
```
config/onboarding/onboarding.xlsx
```

**Required Sheets:**

| Sheet | Purpose | Required Columns |
|-------|---------|------------------|
| Organization | Company info | Organization Name, Domain, Industry |
| Roles | Permission roles | Role Name, Display Name, Level, Permissions, Can Access All Matters |
| Administrators | Admin users | First Name, Last Name, Email, Role |
| Users | Regular users | First Name, Last Name, Email, Role |

**Optional Sheets:**

| Sheet | Purpose |
|-------|---------|
| Departments | Organizational departments |
| Matters | Pre-configured client matters |

### Running Customer Onboarding

```bash
# Generate SQL and seed database
./onboard_customer.sh

# Generate SQL only (don't seed)
./onboard_customer.sh --dry-run

# Use custom Excel file
./onboard_customer.sh --excel-path /path/to/custom.xlsx

# Custom database connection
./onboard_customer.sh --db-host localhost --db-port 5432 --db-name lana_chef
```

### Output Files

After running the onboarding script:

| File | Purpose |
|------|---------|
| `seed-{org-name}.sql` | Generated SQL seed file |
| `exports/activation-codes-*.csv` | User activation codes (CSV) |
| `exports/activation-codes-*.json` | User activation codes (JSON) |

### Activation Codes

Users are created with `pending` status and must activate their accounts using the generated activation codes.

**Activation code format:** `LANA-XXXX-XXXX-XXXX`

⚠️ **Important:** Activation codes expire in **7 days**. Distribute them to users promptly.

### What Gets Created

For each user imported:
- User account (pending status)
- Role assignment
- Activation code
- Default preferences (theme, language)
- Notification preferences

---

## Scripts Reference

### Main Scripts (Root Level)

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `deploy-prod-mac.sh` | Full system setup | Fresh install only |
| `run.sh` | Application management | Daily operations |
| `onboard_customer.sh` | Customer onboarding | New organization setup |

### Setup Scripts (`scripts/setup/`)

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `setup-prod-ssh.sh` | Enable SSH remote access | Server initial setup |
| `setup-thin-client.sh` | Configure Electron auto-discovery (loads defaults on re-run) | Thin client deployment |
| `setup-network.sh` | Configure/reset/verify static IP with interactive prompts | Network configuration for thin clients |
| `set-static-ip-mac.sh` | Legacy static IP script (use setup-network.sh instead) | Legacy deployments only |

### Utility Scripts (`scripts/`)

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `external-storage.sh` | External SSD setup | When adding external drives |
| `build-client.sh` | Build desktop client | Distributing to users |
| `start_minio.sh` | Start MinIO server | Manual service start |
| `start_unstructured_api.sh` | Start Unstructured API | Manual service start |

### Maintenance Scripts (`scripts/maintenance/`)

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `switch-postgres-to-external.sh` | Migrate PostgreSQL to external storage | Storage migration |

### Test Scripts (`scripts/test/`)

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `test-ollama-request.sh` | Test Ollama API | Debugging AI |
| `test-ota.sh` | Test OTA updates | Client update testing |
| `verify-fixes.sh` | Verify bug fixes | After patches |

### run.sh Commands

```bash
./run.sh              # Start the application
./run.sh start        # Start the application
./run.sh stop         # Stop the application
./run.sh restart      # Restart the application
./run.sh status       # Show application status
./run.sh logs         # View application logs
./run.sh monitor      # Open PM2 monitoring dashboard
```

### onboard_customer.sh Commands

```bash
./onboard_customer.sh                 # Run full onboarding (default Excel path)
./onboard_customer.sh --dry-run       # Generate SQL only, don't seed
./onboard_customer.sh --excel-path X  # Use custom Excel file
./onboard_customer.sh --force         # Force regeneration
./onboard_customer.sh --db-host X     # Custom PostgreSQL host
./onboard_customer.sh --db-port X     # Custom PostgreSQL port
./onboard_customer.sh --db-name X     # Custom database name
./onboard_customer.sh --db-user X     # Custom database user
```

### build-client.sh Commands

```bash
./scripts/build-client.sh --ip <ip:port>                    # Build for all platforms
./scripts/build-client.sh --ip <ip:port> --platform mac     # Build for macOS only
./scripts/build-client.sh --ip <ip:port> --platform win     # Build for Windows only
./scripts/build-client.sh --ip <ip:port> --platform linux   # Build for Linux only
./scripts/build-client.sh --ip <ip:port> --arch arm64       # Build for ARM64 only
./scripts/build-client.sh --ip <ip:port> --clean            # Clean build
./scripts/build-client.sh --demo                            # Build demo mode
./scripts/build-client.sh --help                            # Show all options
```

### external-storage.sh Commands

```bash
sudo ./scripts/external-storage.sh configure  # Configure external drives
sudo ./scripts/external-storage.sh status     # Show storage status
sudo ./scripts/external-storage.sh verify     # Verify configuration
```

---

## Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LanaAI Chef                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│   │   Node.js   │    │  PostgreSQL │    │    MinIO    │        │
│   │   (PM2)     │◄──►│  + pgvector │    │   Storage   │        │
│   │  Port 8080  │    │  Port 5432  │    │  Port 9000  │        │
│   └─────────────┘    └─────────────┘    └─────────────┘        │
│          │                  │                   │               │
│          ▼                  ▼                   ▼               │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│   │   Ollama    │    │ Unstructured│    │   pg-boss   │        │
│   │ (AI Models) │    │  (Doc Parse)│    │ (Job Queue) │        │
│   │ Port 11434  │    │  Port 8000  │    │  Internal   │        │
│   └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| LanaAI App | http://localhost:8080 | Main API |
| MinIO Console | http://localhost:9001 | Storage UI |
| MinIO API | http://localhost:9000 | S3 API |
| Ollama | http://localhost:11434 | LLM API |
| Unstructured | http://localhost:8000 | Document parsing |
| PostgreSQL | localhost:5432 | Database |

---

## External Storage Setup

For production deployments, external NVMe SSDs are recommended for:
- AI model storage (can be 50GB+)
- PostgreSQL data
- MinIO object storage

### Automatic Detection

The deployment script automatically detects and configures external SSDs:

- **Largest SSD** → `chef-primary` (CAPACITY tier)
  - AI models, MinIO data, PostgreSQL data
- **Second SSD** → `chef-cache` (SPEED tier)
  - Caches, temp files, logs

### Manual Configuration

```bash
# Configure external storage
sudo ./scripts/external-storage.sh configure

# Verify configuration
sudo ./scripts/external-storage.sh verify

# Check status
./scripts/external-storage.sh status
```

### Storage Layout

```
/Volumes/chef-primary/          # CAPACITY tier (largest SSD)
├── models/                     # Ollama AI models
├── minio/                      # MinIO object storage
└── postgres/
    └── data/                   # PostgreSQL database

/Volumes/chef-cache/            # SPEED tier (2nd SSD or internal)
├── cache/
│   └── postgres/               # PostgreSQL cache
├── temp/
│   └── app/                    # Application temp files
└── logs/                       # Application logs
```

---

## Network Configuration

For thin client deployments where users access the Mac server from laptops/desktops on the same network, you'll need to configure a static IP address. This ensures the server is always accessible at the same address.

### Setup Network Script

The `setup-network.sh` script provides a comprehensive solution for configuring, resetting, and verifying network settings.

**Location:** `scripts/setup-network.sh`

### Commands

#### Configure Static IP

Set up a static IP with interactive prompts:

```bash
# Auto-detect active interface and configure
sudo ./scripts/setup-network.sh configure

# Configure specific interface
sudo ./scripts/setup-network.sh configure "Wi-Fi"
sudo ./scripts/setup-network.sh configure "Ethernet"
```

**What it does:**
- Auto-detects active network interface (or uses specified one)
- Prompts for static IP, subnet mask, router, and DNS servers
- Validates IP address formats
- Shows confirmation before applying
- Displays server URLs for thin client access

**Example session:**
```
Enter static IP address (e.g., 10.0.0.3): 10.0.0.3
Enter subnet mask [255.255.255.0]:
Enter router/gateway (e.g., 10.0.0.1): 10.0.0.1
Enter DNS servers (space-separated) [8.8.8.8 1.1.1.1]:

Configuration to apply:
  Network Service: Wi-Fi
  IP Address: 10.0.0.3
  Subnet Mask: 255.255.255.0
  Router: 10.0.0.1
  DNS Servers: 8.8.8.8 1.1.1.1

Apply this configuration? (y/n): y
```

#### Reset to DHCP

Revert network interface to automatic DHCP configuration:

```bash
# Auto-detect active interface and reset
sudo ./scripts/setup-network.sh reset

# Reset specific interface
sudo ./scripts/setup-network.sh reset "Wi-Fi"
```

#### Verify Configuration

Check current network configuration and connectivity:

```bash
# Verify auto-detected interface
./scripts/setup-network.sh verify

# Verify specific interface
./scripts/setup-network.sh verify "Wi-Fi"
```

**What it checks:**
- ✅ Configuration type (Static IP vs DHCP)
- ✅ IP address assignment
- ✅ Router connectivity
- ✅ Internet connectivity
- ✅ DNS resolution
- ✅ LANA AI service status
- ✅ Server URLs for thin client access

**Example output:**
```
✓ Configuration Type: Static IP (Manual)
✓ IP Address: 10.0.0.3
✓ Router: 10.0.0.1
✓ Router is reachable
✓ Internet is reachable
✓ DNS is working
✓ LANA AI is running and accessible locally

Server URLs:
  - Local:    http://localhost:8080
  - Network:  http://10.0.0.3:8080
```

#### Help

Show all available commands and options:

```bash
./scripts/setup-network.sh help
```

### Thin Client Access

After configuring a static IP, thin clients (MacBook Pro, laptops, etc.) on the same network can access the server at:

```
http://[static-ip]:8080
```

**Example:** If you configured `10.0.0.3`, users access:
- **Web Interface:** `http://10.0.0.3:8080`
- **API Health:** `http://10.0.0.3:8080/api/health`

### Recommended Network Settings

For most deployments:

| Setting | Recommended Value | Notes |
|---------|------------------|-------|
| **IP Address** | `10.0.0.X` or `192.168.X.X` | Use your network's subnet |
| **Subnet Mask** | `255.255.255.0` | Standard /24 network |
| **Router** | Your network gateway | Usually `10.0.0.1` or `192.168.1.1` |
| **DNS Servers** | `8.8.8.8 1.1.1.1` | Google + Cloudflare DNS |

### Troubleshooting Network Issues

**Can't access server from thin client:**
1. Verify server network configuration:
   ```bash
   ./scripts/setup-network.sh verify
   ```

2. Ping the server from thin client:
   ```bash
   ping 10.0.0.3  # Replace with your server's IP
   ```

3. Check firewall settings on server (should allow port 8080)

4. Ensure both server and client are on the same network

**DHCP keeps overriding static IP:**
- Some routers may have DHCP reservations that conflict
- Configure DHCP reservation in router for the server's MAC address
- Or use the reset command and reconfigure: `sudo ./scripts/setup-network.sh reset`

---

## Managing the Application

### Daily Operations

```bash
# Start the app
./run.sh

# View logs in real-time
./run.sh logs

# Restart after code changes
./run.sh restart

# Stop the app
./run.sh stop
```

### PM2 Commands

```bash
pm2 list                    # List all processes
pm2 logs lana-api           # View logs
pm2 monit                   # Real-time monitoring
pm2 restart lana-api        # Restart
pm2 stop lana-api           # Stop
pm2 delete lana-api         # Remove from PM2
```

### Service Management (LaunchAgents)

```bash
# Start all services
launchctl load ~/Library/LaunchAgents/com.lana.*.plist

# Stop all services
launchctl unload ~/Library/LaunchAgents/com.lana.*.plist

# Individual services
launchctl load ~/Library/LaunchAgents/com.lana.minio.plist
launchctl load ~/Library/LaunchAgents/com.lana.ollama.plist
launchctl load ~/Library/LaunchAgents/com.lana.unstructured.plist
```

### Database Operations

```bash
# Connect to PostgreSQL
psql -d lana_chef

# Run migrations
npm run migrate

# Backup database
pg_dump lana_chef > backup.sql
```

---

## Troubleshooting

### App Won't Start

1. Check if services are running:
   ```bash
   ./run.sh status
   ```

2. Check logs:
   ```bash
   ./run.sh logs
   ```

3. Verify `.env` file exists:
   ```bash
   cat .env | head -20
   ```

### PM2 Permission Denied Error

If you see `EACCES: permission denied, open '.../pm2-lana.log'`:

```bash
# Fix log directory permissions
sudo chown -R $(whoami) ~/Library/Logs/LanaAI

# Delete the broken PM2 process and restart
pm2 delete lana-api
pm2 save --force
./run.sh
```

### PostgreSQL Connection Failed

```bash
# Check if PostgreSQL is running
lsof -i :5432

# Start PostgreSQL
brew services start postgresql@17

# Or with external storage
launchctl load ~/Library/LaunchAgents/com.lana.postgresql.plist
```

### MinIO Not Accessible

```bash
# Check if running
lsof -i :9000

# View logs
tail -f ~/Library/Logs/LanaAI/minio.log

# Restart
launchctl unload ~/Library/LaunchAgents/com.lana.minio.plist
launchctl load ~/Library/LaunchAgents/com.lana.minio.plist
```

### Ollama Models Missing

```bash
# List installed models
ollama list

# Pull required models
ollama pull llama3.1:8b
ollama pull mxbai-embed-large
ollama pull qwen3-vl
```

### Unstructured API Not Running

```bash
# Check status
lsof -i :8000

# View errors
tail -f ~/Library/Logs/LanaAI/unstructured.error.log

# Restart
launchctl unload ~/Library/LaunchAgents/com.lana.unstructured.plist
launchctl load ~/Library/LaunchAgents/com.lana.unstructured.plist
```

### External Storage Not Detected

```bash
# Check if drives are mounted
ls /Volumes/

# Re-run storage configuration
sudo ./scripts/external-storage.sh configure

# Check configuration
cat .storage-configured | jq .
```

---

## Environment Variables

Key environment variables in `.env`:

```bash
# Database
DATABASE_URL=postgresql://localhost:5432/lana_chef
POSTGRES_DATA_PATH=/Volumes/chef-primary/postgres/data

# Storage
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_STORAGE_PATH=/Volumes/chef-primary/minio

# AI
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODELS_PATH=/Volumes/chef-primary/models

# Application
NODE_ENV=production
PORT=8080
```

---

## Logs Location

| Service | Log Path |
|---------|----------|
| LanaAI App | `pm2 logs lana-api` |
| MinIO | `~/Library/Logs/LanaAI/minio.log` |
| Ollama | `~/Library/Logs/LanaAI/ollama.log` |
| Unstructured | `~/Library/Logs/LanaAI/unstructured.log` |
| PostgreSQL | `~/Library/Logs/LanaAI/postgresql.log` |

---

## License

Proprietary - All rights reserved.

