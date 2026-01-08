# Installer VPN Configuration Capture

**Purpose:** Example scripts for capturing VPN configuration from deployment and sending to homebase.

---

## Overview

When `deploy-prod-mac.sh` runs with VPN enabled, it outputs the VPN configuration between special markers:

```
===VPN_CONFIG_START===
{JSON configuration here}
===VPN_CONFIG_END===
```

The installer should capture this JSON and send it to the homebase hosted discovery service.

---

## Bash Example

```bash
#!/bin/bash
# Example installer script that captures VPN config

set -e

HOMEBASE_URL="https://api.redroostertec.com"
HOMEBASE_API_KEY="your-api-key"
DEPLOY_LOG="deployment.log"

echo "Running deployment..."
./deploy-prod-mac.sh 2>&1 | tee "$DEPLOY_LOG"

echo ""
echo "Extracting VPN configuration..."

# Extract JSON between markers
VPN_CONFIG=$(sed -n '/===VPN_CONFIG_START===/,/===VPN_CONFIG_END===/p' "$DEPLOY_LOG" | \
    sed '1d;$d')

if [[ -z "$VPN_CONFIG" ]]; then
    echo "No VPN configuration found (VPN may not be enabled)"
    exit 0
fi

echo "VPN Configuration captured:"
echo "$VPN_CONFIG" | jq '.'

# Extract just the discovery_payload.vpn object
DISCOVERY_PAYLOAD=$(echo "$VPN_CONFIG" | jq '.discovery_payload')

# Get deployment info
ORG_ID=$(echo "$VPN_CONFIG" | jq -r '.deployment_info.organization_id')
ORG_DOMAIN=$(echo "$VPN_CONFIG" | jq -r '.deployment_info.organization_domain')
STATIC_IP=$(echo "$VPN_CONFIG" | jq -r '.deployment_info.static_ip')

echo ""
echo "Sending VPN configuration to homebase..."

# Send to homebase API
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${HOMEBASE_URL}/api/v1/deployments/vpn-config" \
    -H "Authorization: Bearer ${HOMEBASE_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"organization_id\": \"${ORG_ID}\",
        \"organization_domain\": \"${ORG_DOMAIN}\",
        \"static_ip\": \"${STATIC_IP}\",
        \"discovery_config\": ${DISCOVERY_PAYLOAD}
    }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "201" ]]; then
    echo "✓ VPN configuration sent successfully to homebase"
    echo "  Response: $BODY"
else
    echo "✗ Failed to send VPN configuration to homebase"
    echo "  HTTP Code: $HTTP_CODE"
    echo "  Response: $BODY"
    exit 1
fi

echo ""
echo "VPN configuration has been registered with homebase hosted discovery service"
```

---

## Python Example

```python
#!/usr/bin/env python3
"""
Example installer script that captures VPN config from deployment output
"""

import subprocess
import json
import re
import requests
import sys

HOMEBASE_URL = "https://api.redroostertec.com"
HOMEBASE_API_KEY = "your-api-key"

def run_deployment():
    """Run deployment script and capture output"""
    print("Running deployment...")

    result = subprocess.run(
        ['./deploy-prod-mac.sh'],
        capture_output=True,
        text=True
    )

    # Save full output to log
    with open('deployment.log', 'w') as f:
        f.write(result.stdout)
        f.write(result.stderr)

    return result.stdout + result.stderr

def extract_vpn_config(output):
    """Extract VPN config JSON from deployment output"""
    pattern = r'===VPN_CONFIG_START===\n(.*?)\n===VPN_CONFIG_END==='
    match = re.search(pattern, output, re.DOTALL)

    if not match:
        print("No VPN configuration found (VPN may not be enabled)")
        return None

    json_str = match.group(1)
    return json.loads(json_str)

def send_to_homebase(vpn_config):
    """Send VPN configuration to homebase hosted discovery service"""

    deployment_info = vpn_config['deployment_info']
    discovery_payload = vpn_config['discovery_payload']

    payload = {
        'organization_id': deployment_info['organization_id'],
        'organization_domain': deployment_info['organization_domain'],
        'static_ip': deployment_info['static_ip'],
        'discovery_config': discovery_payload
    }

    print("\nSending VPN configuration to homebase...")
    print(f"Organization: {deployment_info['organization_domain']}")
    print(f"Static IP: {deployment_info['static_ip']}")

    response = requests.post(
        f"{HOMEBASE_URL}/api/v1/deployments/vpn-config",
        headers={
            'Authorization': f'Bearer {HOMEBASE_API_KEY}',
            'Content-Type': 'application/json'
        },
        json=payload
    )

    if response.status_code in (200, 201):
        print("✓ VPN configuration sent successfully to homebase")
        print(f"  Response: {response.json()}")
        return True
    else:
        print("✗ Failed to send VPN configuration to homebase")
        print(f"  HTTP Code: {response.status_code}")
        print(f"  Response: {response.text}")
        return False

def main():
    # Run deployment
    output = run_deployment()

    # Extract VPN config
    vpn_config = extract_vpn_config(output)

    if not vpn_config:
        print("Deployment completed without VPN configuration")
        return 0

    print("\nVPN Configuration captured:")
    print(json.dumps(vpn_config, indent=2))

    # Send to homebase
    success = send_to_homebase(vpn_config)

    if success:
        print("\nVPN configuration has been registered with homebase hosted discovery service")
        return 0
    else:
        return 1

if __name__ == '__main__':
    sys.exit(main())
```

---

## Node.js Example

```javascript
#!/usr/bin/env node
/**
 * Example installer script that captures VPN config from deployment output
 */

const { execSync } = require('child_process');
const fs = require('fs');
const axios = require('axios');

const HOMEBASE_URL = 'https://api.redroostertec.com';
const HOMEBASE_API_KEY = 'your-api-key';

async function runDeployment() {
  console.log('Running deployment...');

  try {
    const output = execSync('./deploy-prod-mac.sh', {
      encoding: 'utf8',
      stdio: 'pipe'
    });

    // Save to log
    fs.writeFileSync('deployment.log', output);

    return output;
  } catch (error) {
    // execSync throws on non-zero exit, but we still get output
    fs.writeFileSync('deployment.log', error.stdout + error.stderr);
    return error.stdout + error.stderr;
  }
}

function extractVpnConfig(output) {
  const startMarker = '===VPN_CONFIG_START===';
  const endMarker = '===VPN_CONFIG_END===';

  const startIndex = output.indexOf(startMarker);
  const endIndex = output.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    console.log('No VPN configuration found (VPN may not be enabled)');
    return null;
  }

  const jsonStr = output.substring(
    startIndex + startMarker.length,
    endIndex
  ).trim();

  return JSON.parse(jsonStr);
}

async function sendToHomebase(vpnConfig) {
  const { deployment_info, discovery_payload } = vpnConfig;

  const payload = {
    organization_id: deployment_info.organization_id,
    organization_domain: deployment_info.organization_domain,
    static_ip: deployment_info.static_ip,
    discovery_config: discovery_payload
  };

  console.log('\nSending VPN configuration to homebase...');
  console.log(`Organization: ${deployment_info.organization_domain}`);
  console.log(`Static IP: ${deployment_info.static_ip}`);

  try {
    const response = await axios.post(
      `${HOMEBASE_URL}/api/v1/deployments/vpn-config`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${HOMEBASE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✓ VPN configuration sent successfully to homebase');
    console.log(`  Response:`, response.data);
    return true;
  } catch (error) {
    console.error('✗ Failed to send VPN configuration to homebase');
    console.error(`  Error:`, error.message);
    if (error.response) {
      console.error(`  HTTP Code:`, error.response.status);
      console.error(`  Response:`, error.response.data);
    }
    return false;
  }
}

async function main() {
  // Run deployment
  const output = await runDeployment();

  // Extract VPN config
  const vpnConfig = extractVpnConfig(output);

  if (!vpnConfig) {
    console.log('Deployment completed without VPN configuration');
    return 0;
  }

  console.log('\nVPN Configuration captured:');
  console.log(JSON.stringify(vpnConfig, null, 2));

  // Send to homebase
  const success = await sendToHomebase(vpnConfig);

  if (success) {
    console.log('\nVPN configuration has been registered with homebase hosted discovery service');
    return 0;
  } else {
    return 1;
  }
}

main().then(process.exit).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## JSON Structure

### Complete VPN Config (in vpn-discovery-config.json)

```json
{
  "deployment_info": {
    "organization_id": "uuid-here",
    "organization_domain": "norton-estate-planning",
    "static_ip": "10.0.0.3",
    "deployed_at": "2025-12-11T12:00:00Z",
    "deployment_type": "production"
  },
  "vpn_configuration": {
    "enabled": true,
    "type": "wireguard",
    "endpoint": "24.99.172.140:51820",
    "server_public_key": "base64-encoded-key",
    "subnet": "10.100.0.0/24",
    "dns": ["10.100.0.1"],
    "allowed_networks": ["10.0.0.0/24"],
    "required_for_remote_access": true,
    "bootstrap_psk": "base64-encoded-psk"
  },
  "discovery_payload": {
    "vpn": {
      "enabled": true,
      "type": "wireguard",
      "endpoint": "24.99.172.140:51820",
      "server_public_key": "base64-encoded-key",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_networks": ["10.0.0.0/24"],
      "required_for_remote_access": true,
      "bootstrap_psk": "base64-encoded-psk"
    }
  }
}
```

### What to Send to Homebase

Send the **`discovery_payload`** object to the hosted discovery service:

```json
{
  "organization_id": "uuid-here",
  "organization_domain": "norton-estate-planning",
  "static_ip": "10.0.0.3",
  "discovery_config": {
    "vpn": {
      "enabled": true,
      "type": "wireguard",
      "endpoint": "24.99.172.140:51820",
      "server_public_key": "base64-encoded-key",
      "subnet": "10.100.0.0/24",
      "dns": ["10.100.0.1"],
      "allowed_networks": ["10.0.0.0/24"],
      "required_for_remote_access": true,
      "bootstrap_psk": "base64-encoded-psk"
    }
  }
}
```

---

## Homebase API Endpoint (Example)

### POST /api/v1/deployments/vpn-config

**Request:**
```json
{
  "organization_id": "uuid",
  "organization_domain": "norton-estate-planning",
  "static_ip": "10.0.0.3",
  "discovery_config": {
    "vpn": { ... }
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "VPN configuration registered successfully",
  "organization_id": "uuid",
  "discovery_url": "https://api.redroostertec.com/lana-ai/v1/discovery?org_id=uuid"
}
```

---

## Testing Locally

To test without homebase, just extract and verify the JSON:

```bash
# Run deployment
./deploy-prod-mac.sh 2>&1 | tee deploy.log

# Extract VPN config
sed -n '/===VPN_CONFIG_START===/,/===VPN_CONFIG_END===/p' deploy.log | \
  sed '1d;$d' | jq '.'

# Or read from saved file
cat vpn-discovery-config.json | jq '.'
```

---

## Summary

1. **Deployment outputs** VPN config between `===VPN_CONFIG_START===` and `===VPN_CONFIG_END===`
2. **Installer captures** this JSON from stdout
3. **Installer sends** `discovery_payload` to homebase API
4. **Homebase stores** it in hosted discovery service
5. **Clients query** homebase discovery endpoint and get VPN config automatically

This enables zero-configuration VPN setup for thin clients!
