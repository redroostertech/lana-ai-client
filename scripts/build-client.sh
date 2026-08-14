#!/bin/bash

###############################################################################
# Lana AI Desktop Client - Build Script
#
# This script packages the Lana AI web application as a desktop executable
# for Windows, macOS, and Linux using Electron and electron-builder.
#
# IMPORTANT: This script updates public_html/js/config.js based on build mode:
#   - Auto-discovery mode (default): Leaves API_BASE_URL empty for Electron discovery
#   - Traditional mode (--ip): Sets API_BASE_URL to hardcoded server IP
#   - Demo mode (--demo): Sets API_BASE_URL empty and enables demo mode
#
# Usage:
#   ./scripts/build-client.sh [OPTIONS]
#
# Options:
#   --ip [ip:port]                       Backend server IP (for traditional mode)
#                                        If no IP provided, reads STATIC_IP from .env
#                                        (set by setup-thin-client.sh)
#   --platform <mac|windows|linux|all>   Target platform (default: all)
#   --arch <x64|arm64|all>               Target architecture (default: all)
#   --skip-install                       Skip npm install
#   --clean                              Clean build directories before building
#   --dev                                Build in development mode
#   --demo                               Enable demo mode (no server required)
#   --auto-discovery                     Enable auto-discovery mode (default, no IP needed)
#   --help                               Show this help message
#
# Examples:
#   # Auto-discovery mode (recommended - no IP needed)
#   ./scripts/build-client.sh --auto-discovery --platform mac
#
#   # Traditional mode - uses STATIC_IP from .env (set by setup-thin-client.sh)
#   ./scripts/build-client.sh --ip --platform mac
#
#   # Traditional mode - explicit IP
#   ./scripts/build-client.sh --ip 192.168.1.100:8080
#   ./scripts/build-client.sh --ip 100.64.0.26:8080 --platform mac --arch arm64
#
#   # Demo mode
#   ./scripts/build-client.sh --demo --platform mac
#
###############################################################################

set -e  # Exit on error

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
BACKEND_IP=""
PLATFORM="all"
ARCH="all"
SKIP_INSTALL=false
CLEAN=true  # Always clean for fresh builds
DEV_MODE=false
DEMO_MODE=false
AUTO_DISCOVERY_MODE=true  # Default to auto-discovery mode
PORT="8080"  # Default port
PUBLISH_RELEASE=false  # Whether to create GitHub release

# Config file path (in public_html directory)
CONFIG_FILE="$PROJECT_ROOT/public_html/js/config.js"
CONFIG_BACKUP="$PROJECT_ROOT/public_html/js/config.js.backup"
ENV_FILE="$PROJECT_ROOT/.env"

# Get version from package.json
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")

###############################################################################
# Load IP from .env (set by setup-thin-client.sh)
###############################################################################

load_ip_from_env() {
    if [ -f "$ENV_FILE" ]; then
        # Try to get STATIC_IP from .env
        local env_ip=$(grep "^STATIC_IP=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'")
        local env_port=$(grep "^PORT=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'")

        if [ -n "$env_ip" ]; then
            BACKEND_IP="${env_ip}:${env_port:-8080}"
            return 0
        fi
    fi
    return 1
}

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  Lana AI Desktop Client Builder${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▶${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✖${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

show_help() {
    cat << EOF
Usage: ./scripts/build-client.sh [OPTIONS]

Build the Lana AI desktop client application for Windows, macOS, and Linux.

OPTIONS:
    --ip [ip:port]                       Backend server IP address and port (for traditional mode)
                                         If no IP provided, reads STATIC_IP from .env
                                         (set by setup-thin-client.sh)
    --auto-discovery                     Enable auto-discovery mode (default, no IP needed)
    --platform <mac|windows|linux|all>   Target platform (default: all)
    --arch <x64|arm64|all>               Target architecture (default: all)
    --skip-install                       Skip npm install
    --clean                              Clean build directories before building
    --dev                                Build in development mode
    --demo                               Enable demo mode (no server connection)
    --publish                            Create GitHub release and upload artifacts
    --help                               Show this help message

EXAMPLES:
    Build using IP from .env (set by setup-thin-client.sh):
        ./scripts/build-client.sh --ip --platform mac

    Build with explicit IP:
        ./scripts/build-client.sh --ip 192.168.1.100:8080

    Build for macOS ARM64 (Apple Silicon):
        ./scripts/build-client.sh --ip --platform mac --arch arm64

    Build with auto-discovery (recommended):
        ./scripts/build-client.sh --auto-discovery --platform mac

    Build demo version (no backend required):
        ./scripts/build-client.sh --demo

    Clean build and rebuild:
        ./scripts/build-client.sh --ip --clean

OUTPUT:
    Built applications will be in: ./dist/

    Platform outputs:
      - macOS:   dist/macos-arm64/, dist/macos-x64/
      - Windows: dist/windows/
      - Linux:   dist/linux/

EOF
}

###############################################################################
# Parse Arguments
###############################################################################

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --ip)
                AUTO_DISCOVERY_MODE=false
                # Check if next argument exists and is not another flag
                if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
                    BACKEND_IP="$2"
                    shift 2
                else
                    # No IP provided, will try to load from .env
                    shift
                fi
                ;;
            --platform)
                PLATFORM="$2"
                shift 2
                ;;
            --arch)
                ARCH="$2"
                shift 2
                ;;
            --skip-install)
                SKIP_INSTALL=true
                shift
                ;;
            --clean)
                CLEAN=true
                shift
                ;;
            --dev)
                DEV_MODE=true
                shift
                ;;
            --demo)
                DEMO_MODE=true
                AUTO_DISCOVERY_MODE=false
                shift
                ;;
            --auto-discovery)
                AUTO_DISCOVERY_MODE=true
                DEMO_MODE=false
                shift
                ;;
            --publish)
                PUBLISH_RELEASE=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # If --ip was used without a value, try to load from .env
    if [ "$AUTO_DISCOVERY_MODE" = false ] && [ "$DEMO_MODE" = false ] && [ -z "$BACKEND_IP" ]; then
        if load_ip_from_env; then
            print_info "Loaded IP from .env (set by setup-thin-client.sh): $BACKEND_IP"
        else
            print_error "No IP provided and STATIC_IP not found in .env"
            echo ""
            echo "Either:"
            echo "  1. Provide an IP:        --ip <ip:port>"
            echo "  2. Run setup first:      ./scripts/setup/setup-thin-client.sh --static-ip <ip>"
            echo "  3. Use auto-discovery:   --auto-discovery"
            echo "  4. Use demo mode:        --demo"
            echo ""
            exit 1
        fi
    fi
}

###############################################################################
# Pre-flight Checks
###############################################################################

check_requirements() {
    print_step "Checking requirements..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current version: $(node -v)"
        exit 1
    fi

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi

    # Check public_html directory exists
    if [ ! -d "$PROJECT_ROOT/public_html" ]; then
        print_error "public_html directory not found. Make sure the frontend files are in place."
        exit 1
    fi

    # Check config file exists
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "Config file not found: $CONFIG_FILE"
        exit 1
    fi

    print_success "Requirements check passed"
    print_info "Node.js: $(node -v)"
    print_info "npm: $(npm -v)"
}

###############################################################################
# Config Management
###############################################################################

backup_config() {
    print_step "Backing up configuration..."
    cp "$CONFIG_FILE" "$CONFIG_BACKUP"
    print_success "Config backed up to $CONFIG_BACKUP"
}

update_config() {
    print_step "Updating configuration..."

    # NOTE: These keys are rewritten with scripts/set-client-config.js, not sed.
    # A line-oriented sed cannot handle a key whose value spans several lines --
    # API_BASE_URL is an IIFE, and `s|API_BASE_URL:.*|...|` replaced only its
    # `(function () {` opener, orphaning the body and producing a config.js that
    # does not parse. The packaged app then booted with LanaConfig undefined.
    local CONFIG_ASSIGNMENTS=()

    if [ "$DEMO_MODE" = true ]; then
        print_info "Configuring for DEMO mode (no backend connection)"
        CONFIG_ASSIGNMENTS+=("API_BASE_URL=''" "DEMO_MODE=true")
    elif [ "$AUTO_DISCOVERY_MODE" = true ]; then
        print_info "Configuring for AUTO-DISCOVERY mode (Electron will discover server)"
        CONFIG_ASSIGNMENTS+=("API_BASE_URL=''" "DEMO_MODE=false")
    else
        print_info "Configuring for TRADITIONAL mode with backend URL: http://$BACKEND_IP/"
        CONFIG_ASSIGNMENTS+=("API_BASE_URL='http://$BACKEND_IP'" "DEMO_MODE=false")
    fi

    # Disable debug mode for production builds
    if [ "$DEV_MODE" = false ]; then
        CONFIG_ASSIGNMENTS+=("DEBUG_MODE=false")
    fi

    if ! node "$SCRIPT_DIR/set-client-config.js" "$CONFIG_FILE" "${CONFIG_ASSIGNMENTS[@]}"; then
        print_error "Failed to rewrite $CONFIG_FILE"
        exit 1
    fi

    # Guard: never package a config.js that does not parse. Without this the
    # build succeeds and ships a client that cannot boot.
    if ! node --check "$CONFIG_FILE" 2>&1; then
        print_error "config.js is not valid JavaScript after rewrite - aborting build"
        exit 1
    fi

    print_success "Config updated and validated"
}

restore_config() {
    if [ -f "$CONFIG_BACKUP" ]; then
        print_step "Restoring original configuration..."
        mv "$CONFIG_BACKUP" "$CONFIG_FILE"
        print_success "Config restored"
    fi
}

# Trap to restore config on error or exit
trap restore_config EXIT

###############################################################################
# Build Functions
###############################################################################

install_dependencies() {
    if [ "$SKIP_INSTALL" = true ]; then
        print_step "Skipping dependency installation (--skip-install flag)"
        return
    fi

    print_step "Installing dependencies..."
    cd "$PROJECT_ROOT"
    npm install
    print_success "Dependencies installed"
}

bundle_electron() {
    print_step "Bundling Electron files with current version..."
    cd "$PROJECT_ROOT"

    # Run the bundle script to regenerate electron-dist with current version from package.json
    node scripts/bundle-electron.js

    print_success "Electron files bundled (version: $VERSION)"
}

clean_build() {
    if [ "$CLEAN" = true ]; then
        print_step "Cleaning build directories and caches..."
        cd "$PROJECT_ROOT"

        # Clean build artifacts
        rm -rf dist/
        rm -rf node_modules/.cache/
        print_success "Build directories cleaned"

        # Clear Electron app cache (ensures fresh config is loaded)
        print_step "Clearing Electron app cache..."
        rm -rf ~/Library/Application\ Support/LanaAI 2>/dev/null || true
        rm -rf ~/Library/Caches/LanaAI 2>/dev/null || true
        rm -rf ~/Library/Application\ Support/Electron 2>/dev/null || true
        print_success "Electron cache cleared"
    fi
}

build_css() {
    print_step "Building Tailwind CSS..."
    cd "$PROJECT_ROOT"
    NODE_ENV=production npx postcss src/css/tailwind-input.css -o src/css/tailwind-output.css
    print_success "Tailwind CSS compiled"
}

build_app() {
    print_step "Building application for platform: $PLATFORM, arch: $ARCH..."
    cd "$PROJECT_ROOT"

    # Set NODE_ENV
    if [ "$DEV_MODE" = true ]; then
        export NODE_ENV=development
    else
        export NODE_ENV=production
    fi

    # Build based on platform
    case $PLATFORM in
        mac|darwin)
            if [ "$ARCH" = "arm64" ]; then
                print_info "Building for macOS ARM64 (Apple Silicon)..."
                npm run build:mac-arm64
            elif [ "$ARCH" = "x64" ]; then
                print_info "Building for macOS x64 (Intel)..."
                npm run build:mac-x64
            elif [ "$ARCH" = "all" ]; then
                print_info "Building for macOS (all architectures)..."
                npm run build:mac
            else
                # Detect current architecture
                if [[ $(uname -m) == "arm64" ]]; then
                    npm run build:mac-arm64
                else
                    npm run build:mac-x64
                fi
            fi
            ;;
        windows|win)
            print_info "Building for Windows x64..."
            npm run build:win
            ;;
        linux)
            print_info "Building for Linux (AppImage, deb, rpm)..."
            npm run build:linux
            ;;
        all)
            print_info "Building for ALL platforms (sequentially to avoid hdiutil conflicts)..."
            print_info "Step 1/4: Building macOS ARM64..."
            npm run build:mac-arm64
            print_info "Step 2/4: Building macOS x64..."
            npm run build:mac-x64
            print_info "Step 3/4: Building Windows..."
            npm run build:win
            print_info "Step 4/4: Building Linux..."
            npm run build:linux
            ;;
        current)
            print_info "Building for current platform..."
            npm run build:client
            ;;
        *)
            print_error "Unknown platform: $PLATFORM"
            exit 1
            ;;
    esac

    print_success "Build completed successfully!"
}

organize_output() {
    print_step "Organizing build outputs into platform directories..."
    
    DIST_DIR="$PROJECT_ROOT/dist"
    
    # Create platform directories
    mkdir -p "$DIST_DIR/macos-arm64"
    mkdir -p "$DIST_DIR/macos-x64"
    mkdir -p "$DIST_DIR/windows"
    mkdir -p "$DIST_DIR/linux"
    
    # Move macOS ARM64 files
    mv "$DIST_DIR/"*-arm64.dmg "$DIST_DIR/macos-arm64/" 2>/dev/null || true
    mv "$DIST_DIR/"*-arm64.zip "$DIST_DIR/macos-arm64/" 2>/dev/null || true
    
    # Move macOS x64 files
    mv "$DIST_DIR/"*-x64.dmg "$DIST_DIR/macos-x64/" 2>/dev/null || true
    mv "$DIST_DIR/"*-x64.zip "$DIST_DIR/macos-x64/" 2>/dev/null || true
    
    # Move Windows files
    mv "$DIST_DIR/"*.exe "$DIST_DIR/windows/" 2>/dev/null || true
    mv "$DIST_DIR/"*win*.zip "$DIST_DIR/windows/" 2>/dev/null || true
    
    # Move Linux files
    mv "$DIST_DIR/"*.AppImage "$DIST_DIR/linux/" 2>/dev/null || true
    mv "$DIST_DIR/"*.deb "$DIST_DIR/linux/" 2>/dev/null || true
    mv "$DIST_DIR/"*.rpm "$DIST_DIR/linux/" 2>/dev/null || true
    
    # Clean up empty directories
    rmdir "$DIST_DIR/macos-arm64" 2>/dev/null || true
    rmdir "$DIST_DIR/macos-x64" 2>/dev/null || true
    rmdir "$DIST_DIR/windows" 2>/dev/null || true
    rmdir "$DIST_DIR/linux" 2>/dev/null || true
    
    print_success "Outputs organized into platform directories"
}

show_output() {
    echo ""
    print_step "Build output location:"
    echo ""
    echo -e "  ${GREEN}Distribution files:${NC} $PROJECT_ROOT/dist/"
    echo ""

    if [ -d "$PROJECT_ROOT/dist" ]; then
        print_step "Generated files (organized by platform):"
        echo ""
        
        # List macOS ARM64 files (Apple Silicon)
        if [ -d "$PROJECT_ROOT/dist/macos-arm64" ] && [ "$(ls -A "$PROJECT_ROOT/dist/macos-arm64" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 macos-arm64/${NC} (Apple Silicon Macs)"
            for file in "$PROJECT_ROOT/dist/macos-arm64/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi
        
        # List macOS x64 files (Intel)
        if [ -d "$PROJECT_ROOT/dist/macos-x64" ] && [ "$(ls -A "$PROJECT_ROOT/dist/macos-x64" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 macos-x64/${NC} (Intel Macs)"
            for file in "$PROJECT_ROOT/dist/macos-x64/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi
        
        # List Windows files
        if [ -d "$PROJECT_ROOT/dist/windows" ] && [ "$(ls -A "$PROJECT_ROOT/dist/windows" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 windows/${NC} (Windows PCs)"
            for file in "$PROJECT_ROOT/dist/windows/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi
        
        # List Linux files
        if [ -d "$PROJECT_ROOT/dist/linux" ] && [ "$(ls -A "$PROJECT_ROOT/dist/linux" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 linux/${NC} (Linux PCs)"
            for file in "$PROJECT_ROOT/dist/linux/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi
    fi
}

show_summary() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  Build Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    
    if [ "$DEMO_MODE" = true ]; then
        echo -e "  ${CYAN}Mode:${NC}        Demo (offline)"
    elif [ "$AUTO_DISCOVERY_MODE" = true ]; then
        echo -e "  ${CYAN}Mode:${NC}        Auto-Discovery (Electron will discover server)"
    else
        echo -e "  ${CYAN}Mode:${NC}        Traditional (hardcoded IP)"
        echo -e "  ${CYAN}Backend:${NC}     http://$BACKEND_IP/"
    fi
    echo -e "  ${CYAN}Platform:${NC}    $PLATFORM"
    echo -e "  ${CYAN}Architecture:${NC} $ARCH"
    echo -e "  ${CYAN}Output:${NC}      $PROJECT_ROOT/dist/"
    echo ""
    
    print_success "Lana AI Client v${VERSION} build process completed!"
    echo ""
    echo -e "${BLUE}Distribution Instructions:${NC}"
    echo ""
    echo "  Each platform folder contains the files to send to users:"
    echo ""
    echo "  📁 dist/macos-arm64/  → For Apple Silicon Macs (M1/M2/M3)"
    echo "       Send: LanaAI--genesis--${VERSION}-arm64.dmg"
    echo ""
    echo "  📁 dist/macos-x64/    → For Intel Macs"
    echo "       Send: LanaAI--genesis--${VERSION}-x64.dmg"
    echo ""
    echo "  📁 dist/windows/      → For Windows PCs"
    echo "       Send: LanaAI--genesis--${VERSION}-setup.exe"
    echo ""
    echo "  📁 dist/linux/        → For Linux PCs"
    echo "       Send: LanaAI--genesis--${VERSION}.AppImage (universal)"
    echo "       Or:   LanaAI--genesis--${VERSION}.deb (Debian/Ubuntu)"
    echo "       Or:   LanaAI--genesis--${VERSION}.rpm (Fedora/RHEL)"
    echo ""
    if [ "$DEMO_MODE" = false ] && [ "$AUTO_DISCOVERY_MODE" = false ]; then
        echo -e "  ${YELLOW}Important:${NC} Users need network access to http://$BACKEND_IP/"
    elif [ "$AUTO_DISCOVERY_MODE" = true ]; then
        echo -e "  ${YELLOW}Important:${NC} Server must be configured with setup-thin-client.sh for auto-discovery"
    fi
    echo ""
}

###############################################################################
# GitHub Release
###############################################################################

create_github_release() {
    if [ "$PUBLISH_RELEASE" = false ]; then
        return
    fi

    print_step "Creating GitHub release v${VERSION}..."

    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
        print_error "GitHub CLI (gh) is not installed. Please install it first."
        print_info "Install with: brew install gh"
        return 1
    fi

    # Check if authenticated
    if ! gh auth status &> /dev/null; then
        print_error "GitHub CLI is not authenticated. Please run: gh auth login"
        return 1
    fi

    DIST_DIR="$PROJECT_ROOT/dist"
    RELEASE_TAG="v${VERSION}"

    # -------------------------------------------------------------------------
    # Step 1: Create and push git tag if it doesn't exist
    # -------------------------------------------------------------------------
    if git rev-parse "${RELEASE_TAG}" &>/dev/null; then
        print_info "Git tag ${RELEASE_TAG} already exists"
    else
        print_info "Creating git tag ${RELEASE_TAG}..."
        git tag "${RELEASE_TAG}"
    fi
    # Always ensure tag is pushed to remote (may exist locally but not on GitHub)
    git push origin "${RELEASE_TAG}" 2>/dev/null || true
    print_success "Git tag ${RELEASE_TAG} pushed to remote"

    # -------------------------------------------------------------------------
    # Step 2: Generate release notes from git history
    # -------------------------------------------------------------------------
    print_info "Generating release notes..."

    # Find the previous tag (most recent tag before the current one)
    PREV_TAG=$(git tag --sort=-v:refname | grep -v "^${RELEASE_TAG}$" | grep -v "pre-release" | head -1)

    RELEASE_NOTES="## LANA AI Client ${RELEASE_TAG} — Release Notes"$'\n\n'

    if [ -n "$PREV_TAG" ]; then
        print_info "Generating changelog from ${PREV_TAG} to ${RELEASE_TAG}..."
        COMMIT_RANGE="${PREV_TAG}..${RELEASE_TAG}"

        # Collect features
        FEATURES=$(git log "$COMMIT_RANGE" --pretty=format:"%s|%h" --no-merges | grep -i "^feat" | while IFS='|' read -r msg hash; do
            # Strip conventional commit prefix
            clean_msg=$(echo "$msg" | sed -E 's/^feat(\([^)]*\))?:\s*//')
            echo "- ${clean_msg} (\`${hash}\`)"
        done)

        # Collect bug fixes
        FIXES=$(git log "$COMMIT_RANGE" --pretty=format:"%s|%h" --no-merges | grep -i "^fix" | while IFS='|' read -r msg hash; do
            clean_msg=$(echo "$msg" | sed -E 's/^fix(\([^)]*\))?:\s*//')
            echo "- ${clean_msg} (\`${hash}\`)"
        done)

        # Collect other notable commits (exclude chore, debug, test, merge, and generic messages)
        OTHER=$(git log "$COMMIT_RANGE" --pretty=format:"%s|%h" --no-merges | grep -iv "^feat\|^fix\|^chore\|^debug\|^test\|^Bump\|^Commiting\|^Merge" | while IFS='|' read -r msg hash; do
            echo "- ${msg} (\`${hash}\`)"
        done)

        if [ -n "$FEATURES" ]; then
            RELEASE_NOTES+="### Features"$'\n\n'"${FEATURES}"$'\n\n'
        fi

        if [ -n "$FIXES" ]; then
            RELEASE_NOTES+="### Bug Fixes"$'\n\n'"${FIXES}"$'\n\n'
        fi

        if [ -n "$OTHER" ]; then
            RELEASE_NOTES+="### Other Changes"$'\n\n'"${OTHER}"$'\n\n'
        fi

        RELEASE_NOTES+="---"$'\n'"**Full Changelog**: ${PREV_TAG}...${RELEASE_TAG}"
    else
        print_warning "No previous tag found, using generic notes"
        RELEASE_NOTES+="Initial release."
    fi

    # -------------------------------------------------------------------------
    # Step 3: Create draft release with generated notes
    # -------------------------------------------------------------------------
    print_info "Creating draft release ${RELEASE_TAG}..."
    if gh release view "${RELEASE_TAG}" &>/dev/null; then
        print_info "Release ${RELEASE_TAG} already exists, updating notes..."
        echo "$RELEASE_NOTES" | gh release edit "${RELEASE_TAG}" --notes-file - 2>/dev/null || true
    else
        echo "$RELEASE_NOTES" | gh release create "${RELEASE_TAG}" \
            --title "${RELEASE_TAG}" \
            --notes-file - \
            --draft
        if [ $? -ne 0 ]; then
            print_error "Failed to create GitHub release ${RELEASE_TAG}"
            return 1
        fi
        print_success "Draft release ${RELEASE_TAG} created"
    fi

    # -------------------------------------------------------------------------
    # Step 4: Upload build artifacts
    # -------------------------------------------------------------------------
    print_step "Uploading build artifacts..."

    # Upload macOS ARM64 files
    if [ -d "$DIST_DIR/macos-arm64" ]; then
        for file in "$DIST_DIR/macos-arm64/"*.dmg "$DIST_DIR/macos-arm64/"*.zip; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload macOS x64 files
    if [ -d "$DIST_DIR/macos-x64" ]; then
        for file in "$DIST_DIR/macos-x64/"*.dmg "$DIST_DIR/macos-x64/"*.zip; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload Windows files
    if [ -d "$DIST_DIR/windows" ]; then
        for file in "$DIST_DIR/windows/"*.exe; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload Linux files
    if [ -d "$DIST_DIR/linux" ]; then
        for file in "$DIST_DIR/linux/"*.AppImage "$DIST_DIR/linux/"*.deb "$DIST_DIR/linux/"*.rpm; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload update manifests
    for file in "$DIST_DIR/"latest*.yml; do
        [ -f "$file" ] && {
            print_info "Uploading $(basename "$file")..."
            gh release upload "${RELEASE_TAG}" "$file" --clobber
        }
    done

    # -------------------------------------------------------------------------
    # Step 5: Publish the release (remove draft status)
    # -------------------------------------------------------------------------
    print_info "Publishing release ${RELEASE_TAG}..."
    gh release edit "${RELEASE_TAG}" --draft=false

    print_success "GitHub release ${RELEASE_TAG} published with release notes and artifacts!"
    echo ""
    echo -e "  ${GREEN}Release URL:${NC} https://github.com/redroostertech/lana-ai-client/releases/tag/${RELEASE_TAG}"
    echo ""
}

###############################################################################
# Main Execution
###############################################################################

main() {
    print_header

    # Parse command line arguments
    parse_args "$@"

    # Apple Developer credentials for signing and notarization
    # These can be set as environment variables or will be prompted interactively
    if [ -z "$APPLE_TEAM_ID" ]; then
        echo -e "${YELLOW}Apple Developer credentials required for signing/notarization${NC}"
        echo ""
        read -p "Enter APPLE_TEAM_ID (from developer.apple.com): " APPLE_TEAM_ID
        export APPLE_TEAM_ID
    fi

    if [ -z "$APPLE_ID" ]; then
        read -p "Enter APPLE_ID (your Apple ID email): " APPLE_ID
        export APPLE_ID
    fi

    if [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
        echo "Enter APPLE_APP_SPECIFIC_PASSWORD (generate at appleid.apple.com > App-Specific Passwords):"
        read -s APPLE_APP_SPECIFIC_PASSWORD
        echo ""
        export APPLE_APP_SPECIFIC_PASSWORD
    fi

    print_success "Apple credentials configured"

    # Display configuration
    echo -e "${CYAN}Configuration:${NC}"
    if [ "$DEMO_MODE" = true ]; then
        echo -e "  Backend: ${YELLOW}Demo Mode (no server)${NC}"
    elif [ "$AUTO_DISCOVERY_MODE" = true ]; then
        echo -e "  Backend: ${GREEN}Auto-Discovery (Electron will discover server)${NC}"
    else
        echo -e "  Backend: ${GREEN}http://$BACKEND_IP/${NC}"
    fi
    echo -e "  Platform: $PLATFORM"
    echo -e "  Architecture: $ARCH"
    echo ""

    # Run build steps
    check_requirements
    backup_config
    update_config
    clean_build
    install_dependencies
    build_css
    bundle_electron
    build_app
    organize_output

    # Don't restore config automatically - let trap handle it
    # restore_config

    show_output
    show_summary
    create_github_release
}

# Run main function
main "$@"

