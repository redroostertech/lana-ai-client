#!/bin/bash
# LANA-AI IP Change Detector
# Monitors public IP and alerts when it changes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
IP_CACHE="/tmp/lana-vpn-ip.cache"
LOG_FILE="$HOME/Library/Logs/LanaAI/ip-change.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get current public IP
get_public_ip() {
    # Try multiple services in case one is down
    curl -s --max-time 5 ifconfig.me 2>/dev/null || \
    curl -s --max-time 5 api.ipify.org 2>/dev/null || \
    curl -s --max-time 5 icanhazip.com 2>/dev/null || \
    echo "FAILED"
}

# Get stored IP from .env
get_stored_ip() {
    if [[ -f "$ENV_FILE" ]]; then
        grep "^WIREGUARD_PUBLIC_ENDPOINT=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | cut -d':' -f1
    else
        echo "NONE"
    fi
}

# Log message
log_message() {
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Send notification (macOS)
send_notification() {
    local title="$1"
    local message="$2"
    osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
}

# Main logic
main() {
    log_message "Checking public IP..."

    CURRENT_IP=$(get_public_ip)

    if [[ "$CURRENT_IP" == "FAILED" ]]; then
        log_message "ERROR: Could not detect public IP (network issue?)"
        exit 1
    fi

    log_message "Current public IP: $CURRENT_IP"

    # Get last known IP
    LAST_IP=""
    if [[ -f "$IP_CACHE" ]]; then
        LAST_IP=$(cat "$IP_CACHE" 2>/dev/null || echo "")
    fi

    # Get IP from .env
    ENV_IP=$(get_stored_ip)

    # First run - just store the IP
    if [[ -z "$LAST_IP" ]]; then
        echo "$CURRENT_IP" > "$IP_CACHE"
        log_message "First run - storing IP: $CURRENT_IP"
        exit 0
    fi

    # Check if IP changed
    if [[ "$CURRENT_IP" != "$LAST_IP" ]]; then
        log_message "⚠️  IP CHANGED! Old: $LAST_IP → New: $CURRENT_IP"

        # Update cache
        echo "$CURRENT_IP" > "$IP_CACHE"

        # Send desktop notification
        send_notification "LANA-AI VPN Alert" "Public IP changed from $LAST_IP to $CURRENT_IP. VPN configs need updating!"

        # Print to console
        echo -e "${RED}╔════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║  ⚠️  PUBLIC IP ADDRESS CHANGED                                 ║${NC}"
        echo -e "${RED}╚════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${YELLOW}Old IP:${NC} $LAST_IP"
        echo -e "${YELLOW}New IP:${NC} $CURRENT_IP"
        echo ""
        echo -e "${YELLOW}REQUIRED ACTIONS:${NC}"
        echo ""
        echo "1. Update .env file:"
        echo "   sed -i '' 's/WIREGUARD_PUBLIC_ENDPOINT=.*/WIREGUARD_PUBLIC_ENDPOINT=$CURRENT_IP:51820/' $ENV_FILE"
        echo ""
        echo "2. Restart LANA-AI application:"
        echo "   cd $PROJECT_DIR && ./run.sh restart"
        echo ""
        echo "3. Update hosted discovery service:"
        echo "   Contact redroostertec.com to update VPN endpoint to: $CURRENT_IP:51820"
        echo ""
        echo "4. Regenerate VPN configs for all users:"
        echo "   - Old configs will NOT work (they have old IP)"
        echo "   - Users must download new configs from vpn-setup.html"
        echo ""
        echo "5. (Optional) Auto-update .env now? (y/n)"
        read -p "> " -n 1 -r
        echo ""

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Backup .env
            cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

            # Update endpoint
            sed -i '' "s/WIREGUARD_PUBLIC_ENDPOINT=.*/WIREGUARD_PUBLIC_ENDPOINT=$CURRENT_IP:51820/" "$ENV_FILE"

            echo -e "${GREEN}✓ Updated WIREGUARD_PUBLIC_ENDPOINT in .env${NC}"
            echo ""
            echo "Still required:"
            echo "  - Restart app: ./run.sh restart"
            echo "  - Update hosted discovery service"
            echo "  - Notify users to download new VPN configs"
        else
            echo "Skipping auto-update. Remember to update manually!"
        fi

        exit 1  # Exit with error to indicate change detected
    else
        log_message "IP unchanged: $CURRENT_IP"

        # Check if .env matches current IP
        if [[ "$ENV_IP" != "$CURRENT_IP" ]]; then
            log_message "⚠️  WARNING: .env has different IP ($ENV_IP) than current ($CURRENT_IP)"
            echo -e "${YELLOW}Warning: .env WIREGUARD_PUBLIC_ENDPOINT does not match current public IP${NC}"
            echo "  Current IP:  $CURRENT_IP"
            echo "  .env IP:     $ENV_IP"
            echo ""
            echo "Update .env? (y/n)"
            read -p "> " -n 1 -r
            echo ""

            if [[ $REPLY =~ ^[Yy]$ ]]; then
                cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
                sed -i '' "s/WIREGUARD_PUBLIC_ENDPOINT=.*/WIREGUARD_PUBLIC_ENDPOINT=$CURRENT_IP:51820/" "$ENV_FILE"
                echo -e "${GREEN}✓ Updated .env${NC}"
            fi
        fi
    fi
}

main "$@"
