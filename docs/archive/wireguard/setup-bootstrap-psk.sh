#!/bin/bash
# Setup Bootstrap PSK for WireGuard VPN
# This script generates and saves the bootstrap pre-shared key

set -e

echo "=== WireGuard Bootstrap PSK Setup ==="
echo

# Check if WireGuard is installed
if ! command -v wg &> /dev/null; then
    echo "❌ WireGuard is not installed"
    echo "   Please install WireGuard first: brew install wireguard-tools"
    exit 1
fi

BOOTSTRAP_PSK_FILE="/usr/local/etc/wireguard/bootstrap.psk"

# Create directory if it doesn't exist
if [[ ! -d "/usr/local/etc/wireguard" ]]; then
    echo "📁 Creating WireGuard config directory..."
    sudo mkdir -p /usr/local/etc/wireguard
    sudo chmod 700 /usr/local/etc/wireguard
fi

# Check if bootstrap PSK already exists
if [[ -f "$BOOTSTRAP_PSK_FILE" ]]; then
    echo "✅ Bootstrap PSK already exists at $BOOTSTRAP_PSK_FILE"
    EXISTING_PSK=$(sudo cat "$BOOTSTRAP_PSK_FILE" 2>/dev/null)
    echo "   PSK: ${EXISTING_PSK:0:20}..."
    echo
    read -p "Do you want to regenerate it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing bootstrap PSK"
        exit 0
    fi
fi

# Generate bootstrap PSK
echo "🔐 Generating bootstrap pre-shared key..."
BOOTSTRAP_PSK=$(wg genpsk)

if [[ -z "$BOOTSTRAP_PSK" ]]; then
    echo "❌ Failed to generate bootstrap PSK"
    exit 1
fi

# Save to file
echo "$BOOTSTRAP_PSK" | sudo tee "$BOOTSTRAP_PSK_FILE" > /dev/null
sudo chmod 600 "$BOOTSTRAP_PSK_FILE"

echo "✅ Bootstrap PSK saved to $BOOTSTRAP_PSK_FILE"
echo "   PSK: ${BOOTSTRAP_PSK:0:20}..."
echo

# Update .env file
ENV_FILE="/Users/redroostertechnologies/Desktop/LANA-AI/.env"
if [[ -f "$ENV_FILE" ]]; then
    echo "📝 Updating .env file..."

    # Check if WIREGUARD_BOOTSTRAP_PSK exists
    if grep -q "^WIREGUARD_BOOTSTRAP_PSK=" "$ENV_FILE"; then
        # Update existing entry
        sed -i.bak "s|^WIREGUARD_BOOTSTRAP_PSK=.*|WIREGUARD_BOOTSTRAP_PSK=$BOOTSTRAP_PSK|" "$ENV_FILE"
        echo "   Updated WIREGUARD_BOOTSTRAP_PSK in .env"
    else
        # Add new entry
        echo "WIREGUARD_BOOTSTRAP_PSK=$BOOTSTRAP_PSK" >> "$ENV_FILE"
        echo "   Added WIREGUARD_BOOTSTRAP_PSK to .env"
    fi
fi

echo
echo "✅ Bootstrap PSK setup complete!"
echo
echo "Next steps:"
echo "1. Restart PM2 services to load the new PSK: pm2 restart all"
echo "2. The VPN setup page will now include the bootstrap PSK in QR codes"
echo "3. Clients can connect before device registration using the PSK"
