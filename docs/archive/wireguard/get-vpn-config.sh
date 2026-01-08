#!/bin/bash
# LANA-AI VPN Configuration Retriever
# Gets the server public key and bootstrap PSK for hosted discovery service

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}LANA-AI VPN Configuration for Hosted Discovery Service${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check if files exist
SERVER_PUBLIC_KEY_FILE="/usr/local/etc/wireguard/server_public.key"
BOOTSTRAP_PSK_FILE="/usr/local/etc/wireguard/bootstrap.psk"

if [[ ! -f "$SERVER_PUBLIC_KEY_FILE" ]]; then
    echo -e "${YELLOW}Error: Server public key not found at $SERVER_PUBLIC_KEY_FILE${NC}"
    echo "Please run: ./deploy-prod-mac.sh and enable VPN when prompted"
    exit 1
fi

if [[ ! -f "$BOOTSTRAP_PSK_FILE" ]]; then
    echo -e "${YELLOW}Error: Bootstrap PSK not found at $BOOTSTRAP_PSK_FILE${NC}"
    echo "Please run: ./deploy-prod-mac.sh and enable VPN when prompted"
    exit 1
fi

# Read values
SERVER_PUBLIC_KEY=$(cat "$SERVER_PUBLIC_KEY_FILE" 2>/dev/null)
BOOTSTRAP_PSK=$(cat "$BOOTSTRAP_PSK_FILE" 2>/dev/null)

# Get public IP
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "UNKNOWN")

# Get static IP from .env
STATIC_IP=$(grep "^STATIC_IP=" .env 2>/dev/null | cut -d'=' -f2 || echo "10.0.0.3")

echo -e "${GREEN}Server Public Key:${NC}"
echo "$SERVER_PUBLIC_KEY"
echo ""

echo -e "${GREEN}Bootstrap PSK:${NC}"
echo "$BOOTSTRAP_PSK"
echo ""

echo -e "${GREEN}Public IP (for endpoint):${NC}"
echo "$PUBLIC_IP"
echo ""

echo -e "${GREEN}Static IP (internal):${NC}"
echo "$STATIC_IP"
echo ""

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}JSON for Hosted Discovery Service (redroostertec.com)${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

cat << VPNJSON
{
  "vpn": {
    "enabled": true,
    "type": "wireguard",
    "endpoint": "$PUBLIC_IP:51820",
    "server_public_key": "$SERVER_PUBLIC_KEY",
    "subnet": "10.100.0.0/24",
    "dns": ["10.100.0.1"],
    "allowed_networks": ["10.0.0.0/24"],
    "required_for_remote_access": true,
    "bootstrap_psk": "$BOOTSTRAP_PSK"
  }
}
VPNJSON

echo ""
echo -e "${YELLOW}============================================================================${NC}"
echo -e "${YELLOW}Copy the JSON above and paste it into the hosted discovery service${NC}"
echo -e "${YELLOW}============================================================================${NC}"
echo ""

# Save to file
OUTPUT_FILE="vpn-discovery-config.json"
cat > "$OUTPUT_FILE" << JSONFILE
{
  "vpn": {
    "enabled": true,
    "type": "wireguard",
    "endpoint": "$PUBLIC_IP:51820",
    "server_public_key": "$SERVER_PUBLIC_KEY",
    "subnet": "10.100.0.0/24",
    "dns": ["10.100.0.1"],
    "allowed_networks": ["10.0.0.0/24"],
    "required_for_remote_access": true,
    "bootstrap_psk": "$BOOTSTRAP_PSK"
  },
  "note": "Use these values to update the hosted discovery service at redroostertec.com",
  "static_ip": "$STATIC_IP",
  "public_ip": "$PUBLIC_IP",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSONFILE

echo -e "${GREEN}Configuration saved to: $OUTPUT_FILE${NC}"
echo ""
