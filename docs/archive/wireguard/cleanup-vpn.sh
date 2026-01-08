#!/bin/bash

# LANA-AI VPN Cleanup Script
# Removes WireGuard VPN configuration for debugging/testing
# Safe to run - will not affect other services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WG_INTERFACE="wg0"
WG_CONFIG_DIR="/usr/local/etc/wireguard"
ENV_FILE="/Users/redroostertechnologies/Desktop/LANA-AI/.env"

# Helper functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================================${NC}"
}

# Main cleanup function
main() {
    print_header "LANA-AI VPN Cleanup"

    echo ""
    echo "This script will:"
    echo "  1. Stop WireGuard interface (if running)"
    echo "  2. Disable VPN in .env configuration"
    echo "  3. Optionally remove WireGuard config files"
    echo "  4. Restart Chef server to reload configuration"
    echo ""
    echo "This is safe and reversible. You can re-enable VPN anytime."
    echo ""
    read -p "Continue? (y/n) " -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_warn "Cancelled by user"
        exit 0
    fi

    # Step 1: Stop WireGuard interface
    print_header "Step 1: Stopping WireGuard"

    if sudo wg show "$WG_INTERFACE" &>/dev/null 2>&1; then
        print_info "Stopping WireGuard interface $WG_INTERFACE..."
        sudo wg-quick down "$WG_INTERFACE" 2>/dev/null || true
        print_info "WireGuard interface stopped"
    else
        print_info "WireGuard interface not running"
    fi

    # Step 2: Disable VPN in .env
    print_header "Step 2: Updating .env Configuration"

    if [[ -f "$ENV_FILE" ]]; then
        # Backup .env
        cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        print_info "Created backup of .env"

        # Disable VPN flags
        if grep -q "^VPN_ENABLED=" "$ENV_FILE"; then
            sed -i '' 's/^VPN_ENABLED=.*/VPN_ENABLED=false/' "$ENV_FILE"
            print_info "Set VPN_ENABLED=false"
        fi

        if grep -q "^WIREGUARD_ENABLED=" "$ENV_FILE"; then
            sed -i '' 's/^WIREGUARD_ENABLED=.*/WIREGUARD_ENABLED=false/' "$ENV_FILE"
            print_info "Set WIREGUARD_ENABLED=false"
        fi

        if grep -q "^FEATURE_VPN_AVAILABLE=" "$ENV_FILE"; then
            sed -i '' 's/^FEATURE_VPN_AVAILABLE=.*/FEATURE_VPN_AVAILABLE=false/' "$ENV_FILE"
            print_info "Set FEATURE_VPN_AVAILABLE=false"
        fi

        if grep -q "^FEATURE_WIREGUARD_AVAILABLE=" "$ENV_FILE"; then
            sed -i '' 's/^FEATURE_WIREGUARD_AVAILABLE=.*/FEATURE_WIREGUARD_AVAILABLE=false/' "$ENV_FILE"
            print_info "Set FEATURE_WIREGUARD_AVAILABLE=false"
        fi

        print_info ".env configuration updated"
    else
        print_warn ".env file not found at $ENV_FILE"
    fi

    # Step 3: Optionally remove WireGuard config files
    print_header "Step 3: WireGuard Configuration Files"

    if [[ -d "$WG_CONFIG_DIR" ]]; then
        echo ""
        echo "Remove WireGuard configuration files?"
        echo "  - This will delete server keys and all client configs"
        echo "  - You'll need to run setup-wireguard.sh again to re-enable VPN"
        echo "  - If you're just testing, choose 'n' to keep configs"
        echo ""
        read -p "Remove WireGuard configs? (y/n) " -r remove_configs
        echo

        if [[ $remove_configs =~ ^[Yy]$ ]]; then
            print_info "Removing WireGuard configuration directory..."
            sudo rm -rf "$WG_CONFIG_DIR"
            print_info "WireGuard configs removed"
        else
            print_info "Keeping WireGuard configs (can re-enable later)"
        fi
    else
        print_info "No WireGuard configs found"
    fi

    # Step 4: Restart Chef server
    print_header "Step 4: Restarting Chef Server"

    echo ""
    echo "Restart the Chef server to reload configuration?"
    echo "  - Required for VPN changes to take effect"
    echo "  - Will briefly interrupt service (~2 seconds)"
    echo ""
    read -p "Restart Chef server? (y/n) " -r restart_chef
    echo

    if [[ $restart_chef =~ ^[Yy]$ ]]; then
        if command -v pm2 &> /dev/null; then
            if pm2 describe lana-api &>/dev/null; then
                print_info "Restarting Chef server..."
                pm2 restart lana-api
                print_info "Chef server restarted"
            else
                print_warn "Chef server not found in PM2"
            fi
        else
            print_warn "PM2 not found - restart Chef manually"
        fi
    else
        print_warn "Skipped restart - changes won't take effect until you restart"
    fi

    # Summary
    print_header "VPN Cleanup Complete!"

    echo ""
    echo -e "${GREEN}VPN has been disabled${NC}"
    echo ""
    echo "What happened:"
    echo "  ✓ WireGuard interface stopped"
    echo "  ✓ VPN disabled in .env"
    if [[ $remove_configs =~ ^[Yy]$ ]]; then
        echo "  ✓ WireGuard configs removed"
    else
        echo "  - WireGuard configs preserved"
    fi
    if [[ $restart_chef =~ ^[Yy]$ ]]; then
        echo "  ✓ Chef server restarted"
    else
        echo "  - Chef server restart pending"
    fi
    echo ""
    echo "Current Status:"
    echo "  - Discovery endpoint will NOT advertise VPN"
    echo "  - Thin clients will connect directly to static IP only"
    echo "  - Existing VPN clients will fail to connect"
    echo ""
    echo "To re-enable VPN:"
    echo "  1. Run: sudo ./scripts/setup-wireguard.sh"
    echo "  2. Update .env with VPN_ENABLED=true"
    echo "  3. Restart Chef: pm2 restart lana-api"
    echo ""
    echo "To verify VPN is disabled:"
    echo "  curl http://localhost:8080/api/health/discovery | jq .discovery.vpn"
    echo "  (should return null or not be present)"
    echo ""
}

# Run main function
main
