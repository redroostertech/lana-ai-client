#!/bin/bash
# ============================================================================
# Lana AI Client CLI Installer
# ============================================================================
# Installs the lana-client CLI globally on this machine.
#
#   ./install.sh
#
# What it does:
#   - Verifies Node.js 18+, npm, git, gh
#   - Creates ~/.lana-client/credentials skeleton (chmod 600) if missing
#   - Installs the CLI globally:        npm install -g ./cli
#   - Verifies the binary is on PATH
#
# What it does NOT do:
#   - Fill in your credentials (edit ~/.lana-client/credentials yourself)
#   - Build or release anything
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/cli"
CREDS_DIR="${HOME}/.lana-client"
CREDS_PATH="${CREDS_DIR}/credentials"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}=================================================${NC}"
    echo -e "${BLUE}  Lana AI Client CLI Installer${NC}"
    echo -e "${BLUE}=================================================${NC}"
    echo ""
}

print_step() { echo -e "${GREEN}[+]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
print_err()  { echo -e "${RED}[ERROR]${NC} $1" >&2; }

check_node() {
    if ! command -v node >/dev/null 2>&1; then
        print_err "node is not installed (required: 18+)"
        exit 1
    fi
    local major
    major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "${major}" -lt 18 ]; then
        print_err "node ${major} found; 18+ required"
        exit 1
    fi
    print_step "node $(node -v)"
}

check_npm() {
    if ! command -v npm >/dev/null 2>&1; then
        print_err "npm is not installed"
        exit 1
    fi
    print_step "npm $(npm -v)"
}

check_git() {
    if ! command -v git >/dev/null 2>&1; then
        print_err "git is not installed"
        exit 1
    fi
    print_step "git $(git --version | awk '{print $3}')"
}

check_gh() {
    if command -v gh >/dev/null 2>&1; then
        print_step "gh $(gh --version | head -1 | awk '{print $3}')"
    else
        print_warn "gh CLI not installed — required for 'generate builds --publish' (install: brew install gh)"
    fi
}

ensure_credentials() {
    if [ ! -d "${CREDS_DIR}" ]; then
        mkdir -p "${CREDS_DIR}"
        chmod 700 "${CREDS_DIR}"
    fi
    if [ ! -f "${CREDS_PATH}" ]; then
        cat > "${CREDS_PATH}" <<'EOF'
# lana-client credentials — chmod 600
# Apple Developer (required for mac signing/notarization)
APPLE_TEAM_ID=
APPLE_ID=
APPLE_APP_SPECIFIC_PASSWORD=

# GitHub (optional — falls back to gh auth)
GITHUB_TOKEN=

# Release email To: line (optional, may be left blank)
RELEASE_EMAIL_TO=
EOF
        chmod 600 "${CREDS_PATH}"
        print_step "Created ${CREDS_PATH} (fill in before running 'generate builds')"
    else
        chmod 600 "${CREDS_PATH}"
        print_step "Using existing ${CREDS_PATH}"
    fi
}

install_cli() {
    print_step "Installing CLI globally from ${CLI_DIR}…"
    cd "${CLI_DIR}"
    if [ ! -d node_modules ]; then
        npm install
    fi
    if npm install -g . >/dev/null 2>&1; then
        :
    else
        print_warn "npm install -g . failed without sudo; retrying with sudo"
        sudo npm install -g .
    fi
    cd "${SCRIPT_DIR}"
}

verify_install() {
    if command -v lana-client >/dev/null 2>&1; then
        print_step "Installed: lana-client $(lana-client --version)"
    else
        print_err "lana-client not found on PATH after install"
        print_err "Check that npm's global bin is on your PATH: $(npm config get prefix)/bin"
        exit 1
    fi
}

print_next_steps() {
    echo ""
    echo "Done. Next:"
    echo "  1. Edit ${CREDS_PATH} and fill in your Apple credentials"
    echo "  2. Try: lana-client --help"
    echo "  3. Run dev:           lana-client run dev"
    echo "  4. Cut a release:     lana-client prepare release"
    echo "                        lana-client generate builds --publish"
    echo "                        lana-client finish release"
    echo ""
}

main() {
    print_header
    check_node
    check_npm
    check_git
    check_gh
    ensure_credentials
    install_cli
    verify_install
    print_next_steps
}

main "$@"
