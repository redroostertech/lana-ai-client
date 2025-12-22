#!/bin/bash
# ============================================================================
# LanaAINode Production Deployment Script for Mac Studio M3
# ============================================================================
# This script installs all backend dependencies for running LanaAINode
# on a Mac Studio M3 production machine.
#
# Prerequisites: This script should be bundled with the source code.
#
# Usage: ./scripts/deploy-prod-mac.sh [--skip-models]
#
# Options:
#   --skip-models    Skip downloading Ollama models (useful for testing)
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration - derive paths from script location (bundled with source)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR"  # Script is in the project root
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/LanaAI"

# Storage paths - will be set by external storage detection or fallback to internal
MINIO_DATA_DIR=""
POSTGRES_DATA_DIR=""
OLLAMA_MODELS_DIR=""
EXTERNAL_STORAGE_ENABLED=false
CACHE_IS_INTERNAL=true

# Parse arguments
SKIP_MODELS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-models)
            SKIP_MODELS=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================================${NC}"
}

print_step() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_command() {
    if command -v "$1" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

generate_secret() {
    openssl rand -hex 32
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

print_header "Pre-flight Checks"

# Check macOS version
MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
if [[ $MACOS_MAJOR -lt 13 ]]; then
    print_error "macOS 13 (Ventura) or later required. Found: $MACOS_VERSION"
    exit 1
fi
print_step "macOS version: $MACOS_VERSION"

# Check available disk space (need at least 50GB)
AVAILABLE_SPACE=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if [[ $AVAILABLE_SPACE -lt 50 ]]; then
    print_warning "Less than 50GB free disk space. Ollama models require ~15GB."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
print_step "Available disk space: ${AVAILABLE_SPACE}GB"

# Check if running on Apple Silicon
ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
    print_warning "This script is optimized for Apple Silicon (M1/M2/M3)."
    print_warning "Detected architecture: $ARCH"
fi
print_step "Architecture: $ARCH"

# Get system memory
MEMORY_GB=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)}')
print_step "System memory: ${MEMORY_GB}GB"

# ============================================================================
# Install Homebrew
# ============================================================================

print_header "Installing Homebrew"

if check_command brew; then
    print_step "Homebrew already installed"
    brew update
else
    print_step "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for Apple Silicon
    if [[ "$ARCH" == "arm64" ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
fi

# ============================================================================
# Install Core Dependencies
# ============================================================================

print_header "Installing Core Dependencies"

# Install jq for JSON parsing (needed for storage config)
if check_command jq; then
    print_step "jq already installed"
else
    print_step "Installing jq..."
    brew install jq
fi

# Install coreutils for GNU timeout (needed for external-storage.sh)
if check_command gtimeout || check_command timeout; then
    print_step "coreutils already installed"
else
    print_step "Installing coreutils..."
    brew install coreutils
fi

# ============================================================================
# External Storage Detection
# ============================================================================

print_header "External Storage Detection"

EXTERNAL_STORAGE_SCRIPT="${INSTALL_DIR}/scripts/external-storage.sh"
STORAGE_CONFIG="${INSTALL_DIR}/.storage-configured"

if [[ -f "$EXTERNAL_STORAGE_SCRIPT" ]]; then
    print_step "Running external storage detection..."
    
    # Make sure the script is executable
    chmod +x "$EXTERNAL_STORAGE_SCRIPT"
    
    # Run external storage configuration (requires sudo)
    if sudo "$EXTERNAL_STORAGE_SCRIPT" configure; then
        print_step "External storage configured successfully"
        
        # Read storage configuration if available
        if [[ -f "$STORAGE_CONFIG" ]]; then
            EXTERNAL_STORAGE_ENABLED=true
            
            # Parse storage paths from config
            PRIMARY_MOUNT=$(jq -r '.primary.mount_point // ""' "$STORAGE_CONFIG" 2>/dev/null)
            CACHE_TYPE=$(jq -r '.cache.type // "internal"' "$STORAGE_CONFIG" 2>/dev/null)
            CACHE_MOUNT=$(jq -r '.cache.mount_point // ""' "$STORAGE_CONFIG" 2>/dev/null)
            
            if [[ -n "$PRIMARY_MOUNT" ]] && [[ -d "$PRIMARY_MOUNT" ]]; then
                MINIO_DATA_DIR="${PRIMARY_MOUNT}/minio"
                POSTGRES_DATA_DIR="${PRIMARY_MOUNT}/postgres/data"
                OLLAMA_MODELS_DIR="${PRIMARY_MOUNT}/models"
                
                print_step "External storage paths configured:"
                echo "    MinIO:      $MINIO_DATA_DIR"
                echo "    PostgreSQL: $POSTGRES_DATA_DIR"
                echo "    Ollama:     $OLLAMA_MODELS_DIR"
                
                if [[ "$CACHE_TYPE" == "internal" ]]; then
                    CACHE_IS_INTERNAL=true
                    print_step "Cache tier: Internal storage at $CACHE_MOUNT"
                else
                    CACHE_IS_INTERNAL=false
                    print_step "Cache tier: External SSD at $CACHE_MOUNT"
                fi
            else
                print_warning "External storage mount not available, falling back to internal storage"
                EXTERNAL_STORAGE_ENABLED=false
            fi
        fi
    else
        print_warning "External storage configuration failed or no external drives found"
    fi
else
    print_warning "External storage script not found: $EXTERNAL_STORAGE_SCRIPT"
fi

# Fallback to internal storage if external not available
if [[ -z "$MINIO_DATA_DIR" ]]; then
    MINIO_DATA_DIR="${HOME}/minio-data"
    print_step "Using internal storage for MinIO: $MINIO_DATA_DIR"
fi

if [[ -z "$POSTGRES_DATA_DIR" ]]; then
    # Use Homebrew's default PostgreSQL data directory
    POSTGRES_DATA_DIR="/opt/homebrew/var/postgresql@17"
    print_step "Using default PostgreSQL data directory"
fi

if [[ -z "$OLLAMA_MODELS_DIR" ]]; then
    OLLAMA_MODELS_DIR="${HOME}/.ollama/models"
    print_step "Using default Ollama models directory: $OLLAMA_MODELS_DIR"
fi

# Create storage directories
print_step "Creating storage directories..."
mkdir -p "$MINIO_DATA_DIR"
mkdir -p "$OLLAMA_MODELS_DIR"

# ============================================================================
# Install PostgreSQL 17
# ============================================================================

print_header "Installing PostgreSQL 17"

if check_command psql; then
    PSQL_VERSION=$(psql --version | grep -oE '[0-9]+\.[0-9]+' | head -1)
    print_step "PostgreSQL already installed: $PSQL_VERSION"
else
    print_step "Installing PostgreSQL 17..."
    brew install postgresql@17
fi

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zprofile

# Install pgvector extension
print_step "Installing pgvector extension..."
brew install pgvector || true

# Configure PostgreSQL data directory
if [[ "$EXTERNAL_STORAGE_ENABLED" == true ]] && [[ "$POSTGRES_DATA_DIR" == /Volumes/* ]]; then
    print_step "Configuring PostgreSQL with external storage..."
    
    # Check if we need to initialize a new data directory
    if [[ ! -f "${POSTGRES_DATA_DIR}/PG_VERSION" ]]; then
        print_step "Initializing PostgreSQL data directory on external storage..."
        
        # Stop any existing PostgreSQL service
        brew services stop postgresql@17 2>/dev/null || true
        sleep 2
        
        # Create the data directory (initdb requires it to be empty)
        mkdir -p "$POSTGRES_DATA_DIR"
        
        # Remove any .gitkeep or other files that would make initdb fail
        rm -f "${POSTGRES_DATA_DIR}/.gitkeep" 2>/dev/null || true
        rm -f "${POSTGRES_DATA_DIR}/.DS_Store" 2>/dev/null || true
        
        # Initialize the database cluster on external storage
        initdb -D "$POSTGRES_DATA_DIR" --encoding=UTF8 --locale=en_US.UTF-8
        
        print_step "PostgreSQL data directory initialized: $POSTGRES_DATA_DIR"
    else
        print_step "PostgreSQL data directory already initialized on external storage"
    fi
    
    # Create a custom LaunchAgent for PostgreSQL with external storage
    print_step "Creating PostgreSQL LaunchAgent for external storage..."
    cat > "${LAUNCH_AGENTS_DIR}/com.lana.postgresql.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lana.postgresql</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/opt/postgresql@17/bin/postgres</string>
        <string>-D</string>
        <string>${POSTGRES_DATA_DIR}</string>
        <string>-c</string>
        <string>listen_addresses=127.0.0.1</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/postgresql.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/postgresql.error.log</string>
    <key>WorkingDirectory</key>
    <string>${POSTGRES_DATA_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>LC_ALL</key>
        <string>en_US.UTF-8</string>
        <key>LANG</key>
        <string>en_US.UTF-8</string>
    </dict>
</dict>
</plist>
EOF
    
    # Unload brew's PostgreSQL service and load our custom one
    brew services stop postgresql@17 2>/dev/null || true
    launchctl unload "${HOME}/Library/LaunchAgents/homebrew.mxcl.postgresql@17.plist" 2>/dev/null || true
    launchctl load "${LAUNCH_AGENTS_DIR}/com.lana.postgresql.plist" 2>/dev/null || true
    
    print_step "PostgreSQL configured with external storage"
else
    # Use Homebrew's default PostgreSQL service
    print_step "Starting PostgreSQL with default storage..."
    brew services start postgresql@17 || true
fi

sleep 3  # Wait for PostgreSQL to start

# Create database and enable pgvector
print_step "Creating database 'lana_chef'..."
createdb lana_chef 2>/dev/null || print_warning "Database 'lana_chef' may already exist"

print_step "Enabling pgvector extension..."
psql -d lana_chef -c "CREATE EXTENSION IF NOT EXISTS vector;" || true

# Install database schema
print_step "Installing database schema..."
SCHEMA_FILE="${INSTALL_DIR}/deploy_schema.sql"
if [[ -f "$SCHEMA_FILE" ]]; then
    psql -d lana_chef -f "$SCHEMA_FILE" 2>&1 | head -20 || print_warning "Some schema objects may already exist"
    print_step "Database schema installed"
else
    print_warning "Schema file not found: $SCHEMA_FILE"
    print_warning "You may need to run migrations manually"
fi

# Run database migrations
print_step "Running database migrations..."
MIGRATIONS_DIR="${INSTALL_DIR}/src/migrations"
if [[ -d "$MIGRATIONS_DIR" ]]; then
    MIGRATION_COUNT=0
    for migration in "$MIGRATIONS_DIR"/*.sql; do
        if [[ -f "$migration" ]]; then
            MIGRATION_NAME=$(basename "$migration")

            # Skip VPN-specific migrations - they run conditionally after VPN setup
            if [[ "$MIGRATION_NAME" == "add_user_devices_table.sql" ]]; then
                print_step "Skipping VPN migration (runs conditionally after VPN setup)"
                continue
            fi

            print_step "Applying migration: $MIGRATION_NAME"
            if psql -d lana_chef -f "$migration" 2>&1 | grep -q "ERROR"; then
                print_warning "Migration $MIGRATION_NAME had errors (may already be applied)"
            fi
            ((MIGRATION_COUNT++))
        fi
    done

    if [[ $MIGRATION_COUNT -gt 0 ]]; then
        print_step "Applied $MIGRATION_COUNT migration(s)"
    else
        print_step "No migrations found in $MIGRATIONS_DIR"
    fi
else
    print_warning "Migrations directory not found: $MIGRATIONS_DIR"
fi

# ============================================================================
# Install Node.js 20 LTS
# ============================================================================

print_header "Installing Node.js 20 LTS"

if check_command node; then
    NODE_VERSION=$(node --version)
    print_step "Node.js already installed: $NODE_VERSION"
else
    print_step "Installing Node.js 20..."
    brew install node@20
fi

# Add Node to PATH
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zprofile

# ============================================================================
# Install PM2
# ============================================================================

print_header "Installing PM2"

if check_command pm2; then
    print_step "PM2 already installed"
else
    print_step "Installing PM2 globally..."
    npm install -g pm2
fi

# ============================================================================
# Install MinIO
# ============================================================================

print_header "Installing MinIO"

if check_command minio; then
    print_step "MinIO already installed"
else
    print_step "Installing MinIO..."
    brew install minio/stable/minio
fi

# Create MinIO data directory
print_step "Creating MinIO data directory..."
mkdir -p "$MINIO_DATA_DIR"

# ============================================================================
# Install Ollama
# ============================================================================

# print_header "Installing Ollama"

# if check_command ollama; then
#     print_step "Ollama already installed"
# else
#     print_step "Installing Ollama..."
#     curl -fsSL https://ollama.com/install.sh | sh
# fi

# Start Ollama service
print_step "Starting Ollama service..."
ollama serve &>/dev/null &
sleep 5  # Wait for Ollama to start

# Pull required models
if [[ "$SKIP_MODELS" == "false" ]]; then
    print_step "Pulling Ollama models (this may take a while)..."

    print_step "Pulling llama3.1:8b (~4.7GB)..."
    ollama pull llama3.1:8b

    # Expand context window to 24K (no additional download required)
    print_step "Expanding llama3.1:8b context window to 24K..."
    TMP_MODELFILE=$(mktemp)
    ollama show llama3.1:8b --modelfile > "$TMP_MODELFILE"

    # Add or update num_ctx parameter to 24K
    if grep -q "^PARAMETER num_ctx" "$TMP_MODELFILE"; then
        sed -i '' 's/^PARAMETER num_ctx.*/PARAMETER num_ctx 24576/' "$TMP_MODELFILE"
    else
        echo "" >> "$TMP_MODELFILE"
        echo "# Expanded context window for better performance" >> "$TMP_MODELFILE"
        echo "PARAMETER num_ctx 24576" >> "$TMP_MODELFILE"
    fi

    ollama create llama3.1:8b-32k -f "$TMP_MODELFILE"
    rm "$TMP_MODELFILE"

    # Remove original 8K variant to save disk space (~4.7GB)
    print_step "Removing 8K variant to save disk space..."
    ollama rm llama3.1:8b
    print_step "Using llama3.1:8b-32k (24K context window for unified model routing)"

    print_step "Pulling mxbai-embed-large (~670MB)..."
    ollama pull mxbai-embed-large

    print_step "Pulling qwen3-vl (~5GB)..."
    ollama pull qwen3-vl
else
    print_warning "Skipping Ollama model downloads (--skip-models flag set)"
fi

# ============================================================================
# Install Python 3.11 and Unstructured.io
# ============================================================================

print_header "Installing Python 3.11 and Unstructured.io"

if check_command python3.11; then
    print_step "Python 3.11 already installed"
else
    print_step "Installing Python 3.11..."
    brew install python@3.11
fi

# Install poppler for PDF processing (required by Unstructured.io)
if check_command pdfinfo; then
    print_step "Poppler already installed"
else
    print_step "Installing Poppler (PDF rendering library)..."
    brew install poppler
fi

# Install Tesseract OCR for text extraction from images/scanned PDFs
if check_command tesseract; then
    print_step "Tesseract OCR already installed"
else
    print_step "Installing Tesseract OCR..."
    brew install tesseract
fi

# Clone unstructured-api repository (contains prepline_general module)
UNSTRUCTURED_API_DIR="${INSTALL_DIR}/unstructured-api"
if [[ -d "$UNSTRUCTURED_API_DIR" ]]; then
    print_step "Unstructured API already cloned, pulling latest..."
    cd "$UNSTRUCTURED_API_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
    cd "$INSTALL_DIR"
else
    print_step "Cloning unstructured-api repository..."
    git clone https://github.com/Unstructured-IO/unstructured-api.git "$UNSTRUCTURED_API_DIR"
fi

# Create virtual environment for Unstructured
print_step "Creating Python virtual environment..."
VENV_DIR="${HOME}/.venv/unstructured"
python3.11 -m venv "$VENV_DIR"

print_step "Installing Unstructured.io dependencies..."
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install "unstructured[all-docs]" uvicorn fastapi

# Clone unstructured-api repository for prepline_general module
UNSTRUCTURED_API_DIR="${INSTALL_DIR}/unstructured-api"
if [[ ! -d "$UNSTRUCTURED_API_DIR" ]]; then
    print_step "Cloning unstructured-api repository..."
    git clone https://github.com/Unstructured-IO/unstructured-api.git "$UNSTRUCTURED_API_DIR"
else
    print_step "unstructured-api repository already exists, updating..."
    cd "$UNSTRUCTURED_API_DIR" && git pull && cd "$INSTALL_DIR"
fi

# Install unstructured-api requirements if they exist
if [[ -f "$UNSTRUCTURED_API_DIR/requirements/base.txt" ]]; then
    print_step "Installing unstructured-api requirements..."
    "$VENV_DIR/bin/pip" install -r "$UNSTRUCTURED_API_DIR/requirements/base.txt" 2>/dev/null || true
fi

# Create Unstructured API wrapper script
print_step "Creating Unstructured API server script..."
mkdir -p "${HOME}/bin"
cat > "${HOME}/bin/unstructured-server" << EOF
#!/bin/bash
# Unstructured.io API Server
# Uses the unstructured-api project with prepline_general module

UNSTRUCTURED_API_DIR="${INSTALL_DIR}/unstructured-api"
VENV_DIR="${HOME}/.venv/unstructured"

# Use absolute path to activate
source "\${VENV_DIR}/bin/activate"

# Add the unstructured-api to Python path
export PYTHONPATH="\${UNSTRUCTURED_API_DIR}:\${PYTHONPATH}"

cd "\${UNSTRUCTURED_API_DIR}"

# Run the API server using absolute path to uvicorn
exec "\${VENV_DIR}/bin/uvicorn" prepline_general.api.app:app --host 127.0.0.1 --port 8000
EOF
chmod +x "${HOME}/bin/unstructured-server"

# ============================================================================
# Install WireGuard (Legacy - Not Recommended)
# ============================================================================

VPN_ENABLED=false
WIREGUARD_ENABLED=false
WIREGUARD_PUBLIC_ENDPOINT=""
WIREGUARD_SERVER_PUBLIC_KEY=""
WIREGUARD_BOOTSTRAP_PSK=""

# WireGuard setup is legacy and complex - Tailscale is recommended instead
# Uncomment below if you specifically need WireGuard instead of Tailscale
: <<'WIREGUARD_LEGACY'

print_header "WireGuard VPN Setup (Legacy)"

echo "⚠️  WireGuard is complex and requires:"
echo "  - Manual port forwarding on router"
echo "  - Public IP address management"
echo "  - QR code generation for clients"
echo "  - Manual peer configuration"
echo ""
echo "Tailscale (configured above) is MUCH simpler!"
echo ""
read -p "Still enable WireGuard? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_step "Setting up WireGuard..."

    WIREGUARD_SETUP_SCRIPT="${INSTALL_DIR}/scripts/setup-wireguard.sh"
    if [[ -f "$WIREGUARD_SETUP_SCRIPT" ]]; then
        chmod +x "$WIREGUARD_SETUP_SCRIPT"

        # First, install WireGuard via Homebrew (as regular user)
        if ! command -v wg &> /dev/null; then
            print_step "Installing WireGuard via Homebrew..."
            brew install wireguard-tools
        fi

        # Then run the setup script with sudo for config file creation
        sudo "$WIREGUARD_SETUP_SCRIPT"

        # Auto-detect public IP
        echo ""
        print_step "Detecting public IP address..."
        DETECTED_IP=$(curl -s -4 https://api.ipify.org 2>/dev/null || curl -s -4 ifconfig.me 2>/dev/null || echo "")

        if [[ -n "$DETECTED_IP" ]]; then
            print_step "Detected public IP: $DETECTED_IP"
            echo ""
            echo "Use this IP for VPN endpoint? (Press Enter to use, or type a different IP/domain)"
            read -p "Public endpoint [$DETECTED_IP]: " PUBLIC_IP
            PUBLIC_IP=${PUBLIC_IP:-$DETECTED_IP}  # Use detected IP if user presses Enter
        else
            print_warning "Could not auto-detect public IP"
            echo ""
            echo "Enter your public IP or domain for VPN access:"
            read -p "Public endpoint (e.g., 203.0.113.42): " PUBLIC_IP
        fi

        if [[ -n "$PUBLIC_IP" ]]; then
            VPN_ENABLED=true
            WIREGUARD_ENABLED=true
            WIREGUARD_PUBLIC_ENDPOINT="${PUBLIC_IP}:51820"
            print_step "WireGuard configured with endpoint: $WIREGUARD_PUBLIC_ENDPOINT"

            # Get the server's public key for hosted discovery
            print_step "Retrieving WireGuard server public key..."
            SERVER_PUBLIC_KEY_FILE="/usr/local/etc/wireguard/server_public.key"
            if [[ -f "$SERVER_PUBLIC_KEY_FILE" ]]; then
                WIREGUARD_SERVER_PUBLIC_KEY=$(sudo cat "$SERVER_PUBLIC_KEY_FILE" 2>/dev/null)
                if [[ -n "$WIREGUARD_SERVER_PUBLIC_KEY" ]]; then
                    print_step "Server public key loaded from $SERVER_PUBLIC_KEY_FILE"
                    print_step "Existing server key preserved - all registered devices remain valid"
                else
                    print_warning "Could not read server public key from $SERVER_PUBLIC_KEY_FILE"
                fi
            else
                print_warning "Server public key file not found at $SERVER_PUBLIC_KEY_FILE"
                print_warning "WireGuard setup may not have completed successfully"
            fi

            # Get or generate bootstrap PSK for initial client connections
            BOOTSTRAP_PSK_FILE="/usr/local/etc/wireguard/bootstrap.psk"
            if [[ -f "$BOOTSTRAP_PSK_FILE" ]]; then
                # Reuse existing bootstrap PSK
                print_step "Found existing bootstrap PSK - reusing to maintain compatibility"
                WIREGUARD_BOOTSTRAP_PSK=$(sudo cat "$BOOTSTRAP_PSK_FILE" 2>/dev/null)
                if [[ -n "$WIREGUARD_BOOTSTRAP_PSK" ]]; then
                    print_step "Bootstrap PSK loaded from $BOOTSTRAP_PSK_FILE"
                else
                    print_warning "Could not read existing bootstrap PSK, generating new one"
                    WIREGUARD_BOOTSTRAP_PSK=$(wg genpsk 2>/dev/null)
                    if [[ -n "$WIREGUARD_BOOTSTRAP_PSK" ]]; then
                        echo "$WIREGUARD_BOOTSTRAP_PSK" | sudo tee "$BOOTSTRAP_PSK_FILE" > /dev/null
                        sudo chmod 600 "$BOOTSTRAP_PSK_FILE"
                        print_step "New bootstrap PSK saved to $BOOTSTRAP_PSK_FILE"
                    fi
                fi
            else
                # Generate new bootstrap PSK
                print_step "Generating new bootstrap pre-shared key..."
                WIREGUARD_BOOTSTRAP_PSK=$(wg genpsk 2>/dev/null)
                if [[ -n "$WIREGUARD_BOOTSTRAP_PSK" ]]; then
                    print_step "Bootstrap PSK generated successfully"
                    echo "$WIREGUARD_BOOTSTRAP_PSK" | sudo tee "$BOOTSTRAP_PSK_FILE" > /dev/null
                    sudo chmod 600 "$BOOTSTRAP_PSK_FILE"
                    print_step "Bootstrap PSK saved to $BOOTSTRAP_PSK_FILE"
                else
                    print_warning "Could not generate bootstrap PSK"
                fi
            fi

            # Display WireGuard keys for reference
            if [[ -n "$WIREGUARD_SERVER_PUBLIC_KEY" ]] && [[ -n "$WIREGUARD_BOOTSTRAP_PSK" ]]; then
                echo ""
                echo "========================================"
                echo "  WireGuard VPN Configuration"
                echo "========================================"
                echo "Server Public Key:"
                echo "  $WIREGUARD_SERVER_PUBLIC_KEY"
                echo ""
                echo "Bootstrap Pre-Shared Key:"
                echo "  $WIREGUARD_BOOTSTRAP_PSK"
                echo ""
                echo "Public Endpoint:"
                echo "  $WIREGUARD_PUBLIC_ENDPOINT"
                echo "========================================"
                echo ""
            fi
        else
            print_warning "No public endpoint provided. VPN will be disabled."
            VPN_ENABLED=false
            WIREGUARD_ENABLED=false
        fi
    else
        print_error "WireGuard setup script not found: $WIREGUARD_SETUP_SCRIPT"
        print_warning "Continuing without VPN..."
        VPN_ENABLED=false
        WIREGUARD_ENABLED=false
    fi
else
    print_step "Skipping WireGuard setup"
    VPN_ENABLED=false
    WIREGUARD_ENABLED=false
fi

WIREGUARD_LEGACY
# End of WireGuard legacy section - commented out by default

# ============================================================================
# Install Tailscale (Recommended Alternative to WireGuard)
# ============================================================================

print_header "Tailscale VPN Setup (Recommended)"

TAILSCALE_ENABLED=false
TAILSCALE_IP=""
TAILSCALE_HOSTNAME=""

echo "Tailscale provides zero-configuration private networking:"
echo "  ✓ No port forwarding required"
echo "  ✓ No manual IP management"
echo "  ✓ Works through firewalls and NAT"
echo "  ✓ Simple mobile apps (iOS/Android)"
echo "  ✓ Free for personal use (up to 100 devices)"
echo ""
echo "This is MUCH simpler than WireGuard and recommended for most users."
echo ""
read -p "Enable Tailscale? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_step "Setting up Tailscale..."

    # Install Tailscale if not already installed
    if ! command -v tailscale &> /dev/null; then
        print_step "Installing Tailscale via Homebrew..."
        brew install tailscale
    else
        print_step "Tailscale already installed"
    fi

    # Check if tailscale service is running
    if tailscale status &>/dev/null; then
        print_step "Tailscale is already running"
        TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -1)
        TAILSCALE_HOSTNAME=$(tailscale status --json 2>/dev/null | grep -o '"HostName":"[^"]*"' | cut -d'"' -f4 | head -1)
    else
        print_step "Starting Tailscale daemon..."

        # Create LaunchDaemon for auto-start
        TAILSCALE_PLIST="/Library/LaunchDaemons/com.tailscale.tailscaled.plist"
        if [[ ! -f "$TAILSCALE_PLIST" ]]; then
            print_step "Creating Tailscale LaunchDaemon..."
            sudo tee "$TAILSCALE_PLIST" > /dev/null <<'TAILSCALE_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tailscale.tailscaled</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/opt/tailscale/bin/tailscaled</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/tailscaled.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/tailscaled.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
TAILSCALE_EOF
            sudo chown root:wheel "$TAILSCALE_PLIST"
            sudo chmod 644 "$TAILSCALE_PLIST"
        fi

        # Load LaunchDaemon
        print_step "Loading Tailscale daemon..."
        sudo launchctl load "$TAILSCALE_PLIST" 2>/dev/null || sudo launchctl start com.tailscale.tailscaled 2>/dev/null
        sleep 2

        # Authenticate if not already authenticated
        if ! tailscale status &>/dev/null 2>&1; then
            echo ""
            echo "========================================"
            echo "  Tailscale Authentication Required"
            echo "========================================"
            echo ""
            echo "Please run the following command to authenticate:"
            echo "  sudo tailscale up"
            echo ""
            echo "This will provide a URL to visit in your browser."
            echo "After authenticating, re-run this script to continue."
            echo ""
            print_warning "Tailscale setup incomplete - authentication required"
            TAILSCALE_ENABLED=false
        else
            TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -1)
            TAILSCALE_HOSTNAME=$(tailscale status --json 2>/dev/null | grep -o '"HostName":"[^"]*"' | cut -d'"' -f4 | head -1)
            TAILSCALE_ENABLED=true
        fi
    fi

    if [[ -n "$TAILSCALE_IP" ]]; then
        TAILSCALE_ENABLED=true

        # Get full DNS name for certificate (use jq for reliable JSON parsing)
        if command -v jq &>/dev/null; then
            TAILSCALE_DNS_NAME=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName' | sed 's/\.$//')
        else
            # Fallback to grep if jq not available
            TAILSCALE_DNS_NAME=$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | cut -d'"' -f4 | sed 's/\.$//')
        fi

        # Provision SSL certificate if MagicDNS is enabled
        SSL_ENABLED=false
        SSL_CERT_PATH=""
        SSL_KEY_PATH=""

        if [[ -n "$TAILSCALE_DNS_NAME" ]]; then
            print_step "Provisioning Tailscale HTTPS certificate..."

            CERT_DIR="${INSTALL_DIR}/certs"
            mkdir -p "$CERT_DIR"

            # Provision certificate with maximum validity (Let's Encrypt max is 90 days, but Tailscale auto-renews)
            # Using --min-validity to ensure certificate is always valid for at least 60 days
            if tailscale cert "$TAILSCALE_DNS_NAME" --cert-file "$CERT_DIR/${TAILSCALE_DNS_NAME}.crt" --key-file "$CERT_DIR/${TAILSCALE_DNS_NAME}.key" --min-validity 1440h 2>&1; then
                SSL_ENABLED=true
                SSL_CERT_PATH="$CERT_DIR/${TAILSCALE_DNS_NAME}.crt"
                SSL_KEY_PATH="$CERT_DIR/${TAILSCALE_DNS_NAME}.key"
                print_step "HTTPS certificate provisioned successfully"
                print_step "Note: Tailscale will auto-renew this certificate before it expires"
            else
                print_warning "Failed to provision HTTPS certificate. Make sure MagicDNS and HTTPS are enabled in Tailscale admin console."
                print_warning "Visit: https://login.tailscale.com/admin/dns"
                SSL_ENABLED=false
            fi
        fi

        echo ""
        echo "========================================"
        echo "  Tailscale Configuration"
        echo "========================================"
        echo "Tailscale IP:       $TAILSCALE_IP"
        echo "Hostname:           ${TAILSCALE_HOSTNAME:-lana-ai-chef}"
        echo "DNS Name:           ${TAILSCALE_DNS_NAME:-Not configured}"
        echo "HTTPS Enabled:      ${SSL_ENABLED}"
        if [[ "$SSL_ENABLED" == "true" ]]; then
            echo "Certificate:        $SSL_CERT_PATH"
        fi
        echo "Network:            100.x.x.x (Tailscale CGNAT)"
        echo "========================================"
        echo ""
    fi
else
    print_step "Skipping Tailscale setup"
    TAILSCALE_ENABLED=false
fi

# ============================================================================
# Run VPN-specific Database Migrations (if VPN enabled)
# ============================================================================

if [[ "$VPN_ENABLED" == true ]]; then
    print_header "Running VPN Database Migrations"

    VPN_MIGRATION="${INSTALL_DIR}/src/migrations/add_user_devices_table.sql"
    if [[ -f "$VPN_MIGRATION" ]]; then
        print_step "Applying VPN migration: add_user_devices_table.sql"
        if psql -d lana_chef -f "$VPN_MIGRATION" 2>&1 | grep -q "ERROR"; then
            print_warning "VPN migration had errors (may already be applied)"
        else
            print_step "VPN migration applied successfully"
        fi
    else
        print_warning "VPN migration not found: $VPN_MIGRATION"
    fi
else
    print_step "VPN disabled - skipping VPN database migrations"
fi

# ============================================================================
# Install npm Dependencies
# ============================================================================

print_header "Installing npm Dependencies"

print_step "Project directory: $INSTALL_DIR"
cd "$INSTALL_DIR"
print_step "Installing npm dependencies..."
npm install

# ============================================================================
# Generate Production .env
# ============================================================================

print_header "Generating Production .env"

ENV_FILE="${INSTALL_DIR}/.env"

# Generate or reuse secure secrets
if [[ -f "$ENV_FILE" ]]; then
    # Reuse existing secrets if .env exists
    EXISTING_JWT=$(grep "^JWT_SECRET=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)
    EXISTING_MINIO=$(grep "^MINIO_SECRET_KEY=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2)

    JWT_SECRET=${EXISTING_JWT:-$(generate_secret)}
    MINIO_SECRET=${EXISTING_MINIO:-$(generate_secret)}

    if [[ -n "$EXISTING_JWT" ]] && [[ -n "$EXISTING_MINIO" ]]; then
        print_step "Reusing existing secrets from .env file"
    else
        print_step "Generating new secrets for first-time setup"
    fi
else
    # Generate new secrets for first-time setup
    JWT_SECRET=$(generate_secret)
    MINIO_SECRET=$(generate_secret)
    print_step "Generating new secrets for first-time setup"
fi

# Determine cache path for .env
if [[ "$CACHE_IS_INTERNAL" == true ]]; then
    ENV_CACHE_PATH="${HOME}/.lananode/cache"
else
    ENV_CACHE_PATH="$CACHE_MOUNT"
fi

cat > "$ENV_FILE" << EOF
# ============================================================================
# LanaAINode Production Configuration
# Generated: $(date)
# Machine: Mac Studio M3
# ============================================================================

PORT=8080
HOST=0.0.0.0
NODE_ENV=production

# Database - Local PostgreSQL
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=lana_chef
POSTGRES_USER=$(whoami)
POSTGRES_PASSWORD=
POSTGRES_SSL=false
POSTGRES_MAX_CONNECTIONS=20

# MinIO - Local Object Storage
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=${MINIO_SECRET}

# pg-boss Job Queue
PGBOSS_SCHEMA=pgboss
PGBOSS_DELETE_AFTER_DAYS=7

# Memory & Concurrency (Mac Studio M3 - optimized for high RAM)
PG_BOSS_TEAM_SIZE=4
PG_BOSS_TEAM_CONCURRENCY=2

# JWT Authentication
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h

# Logging
LOG_LEVEL=info

# Unstructured.io (Local)
UNSTRUCTURED_API_URL=http://127.0.0.1:8000

# Ollama (Local LLM)
OLLAMA_URL=http://127.0.0.1:11434

# Keep models loaded in VRAM to avoid slow cold starts
# -1 = keep loaded indefinitely
# 30m = 30 minutes (default is 5m)
OLLAMA_KEEP_ALIVE=-1

# Model Routing Strategy:
# UNIFIED STRATEGY: Use Llama 3.1 for ALL text operations (agentic, RAG, general chat)
# - AGENTIC_MODEL: Llama 3.1 (24k context) - Tool calling, multi-step reasoning, general chat
# - RAG_MODEL: Llama 3.1 (24k context) - Document analysis, search, complex reasoning
# - LLM_MODEL: Llama 3.1 (24k context) - All other text operations
# - WORKER_MODEL: Llama 3.1 (24k context) - Parallel worker agents for chunk extraction (can use lighter model)
# - EMBEDDING_MODEL: mxbai-embed-large - Vector embeddings
# - VISION_MODEL: Qwen 3 VL - Image/OCR processing (llama3.1 cannot do vision)
AGENTIC_MODEL=llama3.1:8b-32k
RAG_MODEL=llama3.1:8b-32k
LLM_MODEL=llama3.1:8b-32k
WORKER_MODEL=llama3.1:8b-32k
EMBEDDING_MODEL=mxbai-embed-large
VISION_MODEL=qwen3-vl
EMBEDDING_BATCH_SIZE=20

# Context Window Configuration
AGENTIC_CONTEXT_WINDOW=24576
RAG_CONTEXT_WINDOW=24576

# EXPERIMENTAL: AI-based intent classification
# Compares AI intent detection (using RAG_MODEL) with heuristic ModelRouter
# Logs comparison results for evaluation - does not affect model selection yet
ENABLE_AI_INTENT=false

# Debug (disable in production)
DEBUG_API=false

# =============================================================================
# PERFORMANCE OPTIMIZATION
# =============================================================================
# Phase 1.5: Disable AI intent classifier (use context-based logic instead)
# Saves 5-20 seconds per query by using frontend context instead of AI classification
DISABLE_INTENT_CLASSIFIER=true

# =============================================================================
# STORAGE CONFIGURATION
# =============================================================================
# External storage: ${EXTERNAL_STORAGE_ENABLED}

# External storage enabled flag
EXTERNAL_STORAGE_ENABLED=${EXTERNAL_STORAGE_ENABLED}

# Cache tier location (true = internal, false = external SSD)
CACHE_IS_INTERNAL=${CACHE_IS_INTERNAL}

# Storage paths
MINIO_STORAGE_PATH=${MINIO_DATA_DIR}
POSTGRES_DATA_PATH=${POSTGRES_DATA_DIR}
OLLAMA_MODELS_PATH=${OLLAMA_MODELS_DIR}

# Cache/Speed tier paths
EXTERNAL_STORAGE_CACHE=${ENV_CACHE_PATH}
POSTGRES_CACHE_PATH=${ENV_CACHE_PATH}/cache/postgres
APP_TEMP_PATH=${ENV_CACHE_PATH}/temp/app
APP_LOGS_PATH=${ENV_CACHE_PATH}/logs

# =============================================================================
# VPN CONFIGURATION
# =============================================================================
# Tailscale (Recommended): ${TAILSCALE_ENABLED}
# WireGuard (Legacy): ${VPN_ENABLED}

# Tailscale Configuration
TAILSCALE_ENABLED=${TAILSCALE_ENABLED}
TAILSCALE_IP=${TAILSCALE_IP}
TAILSCALE_HOSTNAME=${TAILSCALE_HOSTNAME}
TAILSCALE_DNS_NAME=${TAILSCALE_DNS_NAME}

# SSL/HTTPS Configuration (via Tailscale)
SSL_ENABLED=${SSL_ENABLED}
SSL_CERT_PATH=${SSL_CERT_PATH}
SSL_KEY_PATH=${SSL_KEY_PATH}

# WireGuard Configuration (Legacy)
VPN_ENABLED=${VPN_ENABLED}
WIREGUARD_ENABLED=${WIREGUARD_ENABLED}
WIREGUARD_INTERFACE=wg0
WIREGUARD_PORT=51820
WIREGUARD_SERVER_ADDRESS=10.100.0.1/24
WIREGUARD_SUBNET=10.100.0.0/24
WIREGUARD_DNS=10.100.0.1
WIREGUARD_PUBLIC_ENDPOINT=${WIREGUARD_PUBLIC_ENDPOINT}
WIREGUARD_SERVER_PRIVATE_KEY_PATH=/usr/local/etc/wireguard/server_private.key
WIREGUARD_SERVER_PUBLIC_KEY_PATH=/usr/local/etc/wireguard/server_public.key
WIREGUARD_CONFIG_PATH=/usr/local/etc/wireguard/wg0.conf
WIREGUARD_CLIENT_CONFIG_DIR=/usr/local/etc/wireguard/clients
WIREGUARD_CLIENT_IP_START=10.100.0.10
WIREGUARD_CLIENT_IP_END=10.100.0.254
WIREGUARD_ALLOWED_LOCAL_NETWORKS=10.0.0.0/24
WIREGUARD_KEEPALIVE=25
WIREGUARD_BOOTSTRAP_PSK=${WIREGUARD_BOOTSTRAP_PSK}
VPN_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Feature Flags
FEATURE_TAILSCALE_AVAILABLE=${TAILSCALE_ENABLED}
FEATURE_VPN_AVAILABLE=${VPN_ENABLED}
FEATURE_WIREGUARD_AVAILABLE=${WIREGUARD_ENABLED}

# =============================================================================
# ASSISTANT IDENTITY CONFIGURATION
# =============================================================================
# Customize the AI assistant's identity and role
# Defaults to legal/law industry if not set

# Assistant name (default: "Lana")
ASSISTANT_NAME=Lana

# Assistant role/title (default: "legal AI assistant")
ASSISTANT_ROLE=legal AI assistant

# Industry/domain (default: "legal")
ASSISTANT_INDUSTRY=legal

# Short description of capabilities
ASSISTANT_DESCRIPTION=I help legal professionals with document analysis, research, case management, and general legal questions.

# Optional: Organization/firm name to include in context
ORGANIZATION_NAME=
EOF

print_step "Production .env created at $ENV_FILE"

# ============================================================================
# Create LaunchAgents for Auto-Start
# ============================================================================

print_header "Creating LaunchAgents for Auto-Start"

mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$LOG_DIR"

# PostgreSQL LaunchAgent (managed by brew services, skip)
print_step "PostgreSQL managed by brew services"

# MinIO LaunchAgent
print_step "Creating MinIO LaunchAgent..."
cat > "${LAUNCH_AGENTS_DIR}/com.lana.minio.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lana.minio</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/minio</string>
        <string>server</string>
        <string>${MINIO_DATA_DIR}</string>
        <string>--console-address</string>
        <string>:9001</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MINIO_ROOT_USER</key>
        <string>minioadmin</string>
        <key>MINIO_ROOT_PASSWORD</key>
        <string>${MINIO_SECRET}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/minio.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/minio.error.log</string>
</dict>
</plist>
EOF

# Restart MinIO to pick up credential changes
print_step "Restarting MinIO service..."
launchctl unload "${LAUNCH_AGENTS_DIR}/com.lana.minio.plist" 2>/dev/null || true
sleep 2
launchctl load "${LAUNCH_AGENTS_DIR}/com.lana.minio.plist"
sleep 3

# Ollama LaunchAgent (with external storage support for models)
print_step "Creating Ollama LaunchAgent..."

# Determine Ollama binary path (could be /usr/local/bin or /opt/homebrew/bin)
OLLAMA_BIN="/usr/local/bin/ollama"
if [[ ! -f "$OLLAMA_BIN" ]]; then
    OLLAMA_BIN="/opt/homebrew/bin/ollama"
fi

cat > "${LAUNCH_AGENTS_DIR}/com.lana.ollama.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lana.ollama</string>
    <key>ProgramArguments</key>
    <array>
        <string>${OLLAMA_BIN}</string>
        <string>serve</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OLLAMA_MODELS</key>
        <string>${OLLAMA_MODELS_DIR}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/ollama.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/ollama.error.log</string>
</dict>
</plist>
EOF

if [[ "$EXTERNAL_STORAGE_ENABLED" == true ]] && [[ "$OLLAMA_MODELS_DIR" == /Volumes/* ]]; then
    print_step "Ollama configured to store models on external storage: $OLLAMA_MODELS_DIR"
fi

# Unstructured LaunchAgent
print_step "Creating Unstructured LaunchAgent..."
cat > "${LAUNCH_AGENTS_DIR}/com.lana.unstructured.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lana.unstructured</string>
    <key>ProgramArguments</key>
    <array>
        <string>${HOME}/bin/unstructured-server</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/unstructured.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/unstructured.error.log</string>
</dict>
</plist>
EOF

# Load LaunchAgents
print_step "Loading LaunchAgents..."
launchctl load "${LAUNCH_AGENTS_DIR}/com.lana.minio.plist" 2>/dev/null || true
launchctl load "${LAUNCH_AGENTS_DIR}/com.lana.ollama.plist" 2>/dev/null || true
launchctl load "${LAUNCH_AGENTS_DIR}/com.lana.unstructured.plist" 2>/dev/null || true

# ============================================================================
# PM2 Configuration (for manual startup)
# ============================================================================

print_header "Configuring PM2 for Application Management"

cd "$INSTALL_DIR"

# Setup PM2 startup script (auto-start on boot) - but don't start the app yet
print_step "Configuring PM2 startup hooks..."
pm2 startup launchd -u "$(whoami)" --hp "$HOME" 2>/dev/null || print_warning "PM2 startup may need manual configuration"

print_step "PM2 configured - use './run.sh' to start the application"

# ============================================================================
# Production System Configuration (24/7 Server Settings)
# ============================================================================

print_header "Configuring macOS for 24/7 Production Use"

# Call the production settings configuration script
PRODUCTION_SETTINGS_SCRIPT="${INSTALL_DIR}/scripts/configure-production-settings.sh"

if [[ -f "$PRODUCTION_SETTINGS_SCRIPT" ]]; then
    print_step "Running production settings configuration script..."

    # Make sure the script is executable
    chmod +x "$PRODUCTION_SETTINGS_SCRIPT"

    # Run in non-interactive mode with sudo, passing data directory paths
    if sudo "$PRODUCTION_SETTINGS_SCRIPT" \
        --non-interactive \
        --minio-data "$MINIO_DATA_DIR" \
        --postgres-data "$POSTGRES_DATA_DIR" \
        --ollama-models "$OLLAMA_MODELS_DIR"; then
        print_step "✓ Production settings configured successfully"
    else
        print_warning "Production settings script encountered errors, but continuing..."
    fi
else
    print_warning "Production settings script not found: $PRODUCTION_SETTINGS_SCRIPT"
    print_warning "Skipping advanced production configurations"
    echo ""
    echo "Basic settings will still be applied:"

    # Fallback: Apply minimal critical settings if script is missing
    print_step "Applying minimal production settings..."
    sudo pmset -a sleep 0 disksleep 0 displaysleep 10 2>/dev/null || true
    sudo pmset -a autorestart 1 2>/dev/null || true
    sudo systemsetup -setrestartpowerfailure on 2>/dev/null || true
    sudo systemsetup -setremotelogin on 2>/dev/null || true
    print_step "✓ Minimal production settings applied"
fi

echo ""

# ============================================================================
# Final Status
# ============================================================================

print_header "Deployment Complete!"

echo ""
echo -e "${GREEN}All dependencies have been installed and configured.${NC}"
echo ""
echo -e "${BLUE}⚡ Next Step: Start the Application${NC}"
echo ""
echo -e "  ${GREEN}./run.sh${NC}          # Start the LanaAI application"
echo ""
echo "Or use these PM2 commands directly:"
echo "  pm2 start src/index.js --name lana-api"
echo "  pm2 save"
echo ""
echo "Service URLs (after starting):"
echo "  - LanaAI App:      http://localhost:8080"
echo "  - MinIO Console:   http://localhost:9001"
echo "  - MinIO API:       http://localhost:9000"
echo "  - Ollama:          http://localhost:11434"
echo "  - Unstructured:    http://localhost:8000"
echo "  - PostgreSQL:      localhost:5432"
echo ""
echo "Configuration:"
echo "  - App Directory:   $INSTALL_DIR"
echo "  - .env File:       $ENV_FILE"
echo "  - Logs:            $LOG_DIR"
echo ""
echo -e "${BLUE}Storage Configuration:${NC}"
if [[ "$EXTERNAL_STORAGE_ENABLED" == true ]]; then
    echo -e "  - External Storage: ${GREEN}ENABLED${NC}"
    echo "  - MinIO Data:       $MINIO_DATA_DIR"
    echo "  - PostgreSQL Data:  $POSTGRES_DATA_DIR"
    echo "  - Ollama Models:    $OLLAMA_MODELS_DIR"
    if [[ "$CACHE_IS_INTERNAL" == true ]]; then
        echo "  - Cache Tier:       Internal (${ENV_CACHE_PATH})"
    else
        echo "  - Cache Tier:       External ($CACHE_MOUNT)"
    fi
else
    echo -e "  - External Storage: ${YELLOW}DISABLED (using internal storage)${NC}"
    echo "  - MinIO Data:       $MINIO_DATA_DIR"
    echo "  - PostgreSQL Data:  Default Homebrew location"
    echo "  - Ollama Models:    $OLLAMA_MODELS_DIR"
fi
echo ""
echo "Application Management:"
echo "  - Start:           ./run.sh"
echo "  - Stop:            ./run.sh stop"
echo "  - Restart:         ./run.sh restart"
echo "  - Logs:            ./run.sh logs"
echo "  - Status:          ./run.sh status"
echo ""
echo "PM2 Commands (after starting):"
echo "  - Status:          pm2 status"
echo "  - Logs:            pm2 logs lana-api"
echo "  - Restart:         pm2 restart lana-api"
echo "  - Stop:            pm2 stop lana-api"
echo "  - Monitor:         pm2 monit"
echo ""
echo "Background Services (LaunchAgents - auto-started):"
echo "  - MinIO, Ollama, Unstructured, PostgreSQL"
echo "  - Manage:          launchctl load/unload ~/Library/LaunchAgents/com.lana.*.plist"
echo ""
echo "View Logs:"
echo "  - App logs:        ./run.sh logs  (or: pm2 logs lana-api)"
echo "  - MinIO logs:      tail -f $LOG_DIR/minio.log"
echo "  - Ollama logs:     tail -f $LOG_DIR/ollama.log"
echo "  - Unstructured:    tail -f $LOG_DIR/unstructured.log"
echo ""
echo -e "${YELLOW}Note: Background services (MinIO, Ollama, etc.) will auto-start on reboot.${NC}"
echo -e "${YELLOW}      The LanaAI app must be started manually with ./run.sh${NC}"
echo ""

# ============================================================================
# VPN Configuration for Hosted Discovery Service
# ============================================================================

if [[ "$VPN_ENABLED" == true ]] && [[ -n "$WIREGUARD_SERVER_PUBLIC_KEY" ]]; then
    print_header "VPN Configuration for Hosted Discovery Service"
    echo ""
    echo -e "${BLUE}┌─────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│  IMPORTANT: Send this configuration to homebase for discovery service  │${NC}"
    echo -e "${BLUE}└─────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo -e "${GREEN}VPN Endpoint:${NC}"
    echo "  $WIREGUARD_PUBLIC_ENDPOINT"
    echo ""
    echo -e "${GREEN}Server Public Key:${NC}"
    echo "  $WIREGUARD_SERVER_PUBLIC_KEY"
    echo ""
    echo -e "${GREEN}Bootstrap PSK:${NC}"
    echo "  $WIREGUARD_BOOTSTRAP_PSK"
    echo ""
    echo -e "${GREEN}Subnet:${NC}"
    echo "  10.100.0.0/24"
    echo ""
    echo -e "${GREEN}DNS:${NC}"
    echo "  10.100.0.1"
    echo ""
    echo -e "${BLUE}JSON for Hosted Discovery (redroostertec.com):${NC}"
    echo ""
    cat << VPNJSON
{
  "vpn": {
    "enabled": true,
    "type": "wireguard",
    "endpoint": "$WIREGUARD_PUBLIC_ENDPOINT",
    "server_public_key": "$WIREGUARD_SERVER_PUBLIC_KEY",
    "subnet": "10.100.0.0/24",
    "dns": ["10.100.0.1"],
    "allowed_networks": ["10.0.0.0/24"],
    "required_for_remote_access": true,
    "bootstrap_psk": "$WIREGUARD_BOOTSTRAP_PSK"
  }
}
VPNJSON
    echo ""
    echo -e "${YELLOW}This configuration has been saved and should be sent to homebase.${NC}"
    echo ""

    # Save VPN config to a file for easy reference and installer capture
    VPN_CONFIG_FILE="${INSTALL_DIR}/vpn-discovery-config.json"

    # Get additional metadata
    STATIC_IP=$(grep "^STATIC_IP=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "")
    ORG_ID=$(grep "^ORGANIZATION_ID=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "")
    ORG_DOMAIN=$(grep "^ORGANIZATION_DOMAIN=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "")

    cat > "$VPN_CONFIG_FILE" << VPNFILE
{
  "deployment_info": {
    "organization_id": "$ORG_ID",
    "organization_domain": "$ORG_DOMAIN",
    "static_ip": "$STATIC_IP",
    "deployed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "deployment_type": "production"
  },
  "vpn_configuration": {
    "enabled": true,
    "type": "wireguard",
    "endpoint": "$WIREGUARD_PUBLIC_ENDPOINT",
    "server_public_key": "$WIREGUARD_SERVER_PUBLIC_KEY",
    "subnet": "10.100.0.0/24",
    "dns": ["10.100.0.1"],
    "allowed_networks": ["10.0.0.0/24"],
    "required_for_remote_access": true,
    "bootstrap_psk": "$WIREGUARD_BOOTSTRAP_PSK"
  },
  "discovery_payload": {
    "vpn": {
      "enabled": true,
      "type": "wireguard",
      "endpoint": "$WIREGUARD_PUBLIC_ENDPOINT",
      "server_public_key": "$WIREGUARD_SERVER_PUBLIC_KEY",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_networks": ["10.0.0.0/24"],
      "required_for_remote_access": true,
      "bootstrap_psk": "$WIREGUARD_BOOTSTRAP_PSK"
    }
  }
}
VPNFILE
    print_step "VPN configuration saved to: $VPN_CONFIG_FILE"
    echo ""

    # Output machine-readable marker for installer to capture
    echo ""
    echo "===VPN_CONFIG_START==="
    cat "$VPN_CONFIG_FILE"
    echo "===VPN_CONFIG_END==="
    echo ""
fi

# Verify background services are running
print_header "Checking Background Service Status"

check_service() {
    local name=$1
    local port=$2
    if nc -z localhost "$port" 2>/dev/null; then
        echo -e "  ${GREEN}[RUNNING]${NC} $name (port $port)"
    else
        echo -e "  ${YELLOW}[STOPPED]${NC} $name (port $port)"
    fi
}

check_service "PostgreSQL" 5432
check_service "MinIO" 9000
check_service "Ollama" 11434
check_service "Unstructured" 8000

echo ""
echo -e "${BLUE}LanaAI Application:${NC} ${YELLOW}[NOT STARTED]${NC} - Run ${GREEN}./run.sh${NC} to start"
echo ""
print_step "Deployment script complete!"
echo ""
echo -e "${GREEN}✅ Ready to start the application!${NC}"
echo -e "   Run: ${GREEN}./run.sh${NC}"
echo ""
