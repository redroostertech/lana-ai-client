# Tailscale Team Access Guide

## Overview

Your LANA AI server is running on a Mac Studio and accessible via Tailscale VPN. This guide explains how team members can connect and access the system.

## Prerequisites

- Email address (for Tailscale account)
- Device to install Tailscale (iOS, Android, macOS, Windows, Linux)

---

## Step 1: Get Added to the Tailscale Network

**Admin Action Required:**

The admin needs to invite you to the Tailscale network:

1. Go to https://login.tailscale.com/admin/users
2. Click "Invite user"
3. Enter your email address
4. Send invitation

You'll receive an email invitation to join the network.

---

## Step 2: Install Tailscale on Your Device

**Important:** Complete Tailscale installation BEFORE installing/updating Lana AI.

### iOS (iPhone/iPad)
1. Open App Store
2. Search for "Tailscale"
3. Install the app
4. Open Tailscale app
5. Sign in with the email where you received the invitation
6. Tap "Connect" to enable the VPN

### macOS
1. Visit https://tailscale.com/download/mac
2. Download and install Tailscale
3. Open Tailscale from Applications
4. Sign in with your invitation email
5. Click "Connect"

### Android
1. Open Google Play Store
2. Search for "Tailscale"
3. Install the app
4. Open Tailscale
5. Sign in with your invitation email
6. Tap "Connect"

### Windows
1. Visit https://tailscale.com/download/windows
2. Download and run the installer
3. Open Tailscale from Start Menu
4. Sign in with your invitation email
5. Click "Connect"

### Linux
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

---

## Step 3: Install or Update Lana AI

**After Tailscale is connected**, you can install or update the Lana AI app:

1. **Download the installer** for the appropriate device type
2. **Ensure Lana AI is fully closed** (quit the app completely)
3. **Run the installer** and follow the prompts
4. **Relaunch Lana AI** and sign in
5. The app will automatically discover the server via Tailscale

---

## Step 4: Verify Connection

Once Tailscale is connected and Lana AI is running, you can verify access to the server:

### Server Details

**Hostname:** `lana-ai-chef.taile853ba.ts.net`
**IP Address:** `100.64.13.68`
**Port:** `8080`

### Access URLs

**HTTPS (Recommended - for iOS apps):**
```
https://lana-ai-chef.taile853ba.ts.net:8080
```

**HTTP (for testing/development):**
```
http://100.64.13.68:8080
```

### Test Your Connection

#### From iOS App
Your iOS app should call the discovery endpoint:
```
GET https://lana-ai-chef.taile853ba.ts.net:8080/health/discovery
```

This returns the server configuration and confirms connectivity.

#### From Browser
Open your browser and visit:
```
https://lana-ai-chef.taile853ba.ts.net:8080
```

You should see the LANA AI API welcome page.

#### From Command Line
```bash
# Test HTTPS connection
curl https://lana-ai-chef.taile853ba.ts.net:8080/health

# Test discovery endpoint
curl https://lana-ai-chef.taile853ba.ts.net:8080/health/discovery | jq
```

---

## Step 5: Configure Your App (For Developers)

### For iOS/Mobile Apps

Use the **discovery endpoint** to automatically get the correct server URL:

```swift
// 1. Call discovery endpoint
let discoveryURL = URL(string: "https://lana-ai-chef.taile853ba.ts.net:8080/health/discovery")!

URLSession.shared.dataTask(with: discoveryURL) { data, response, error in
    guard let data = data else { return }

    let json = try? JSONDecoder().decode(DiscoveryResponse.self, from: data)

    // 2. Use the Tailscale URL from response
    if let tailscaleURL = json?.discovery.tailscale.url {
        // Save this as your API base URL
        UserDefaults.standard.set(tailscaleURL, forKey: "apiBaseURL")
    }
}.resume()
```

### For Desktop Apps

Configure your API client with:
```javascript
const API_BASE_URL = "https://lana-ai-chef.taile853ba.ts.net:8080";
```

---

## Troubleshooting

### Can't Resolve Hostname

**Problem:** Browser/app can't find `lana-ai-chef.taile853ba.ts.net`

**Solution:**
1. Verify Tailscale is connected (green icon/status)
2. Try using the IP address instead: `http://100.64.13.68:8080`
3. Check that MagicDNS is enabled in Tailscale admin console

### Connection Refused

**Problem:** "Connection refused" error

**Solution:**
1. Verify server is running (ask admin to check `pm2 status`)
2. Make sure you're using the correct port (8080)
3. Try the IP address directly: `http://100.64.13.68:8080`

### SSL Certificate Error

**Problem:** "Certificate not trusted" or SSL error

**Solution:**
1. Make sure you're using the full hostname: `lana-ai-chef.taile853ba.ts.net`
2. Don't use the IP address with `https://` (certificate is for hostname only)
3. Use HTTP with IP if needed: `http://100.64.13.68:8080`

### iOS App Transport Security Error

**Problem:** iOS app can't connect - ATS error

**Solution:**
- Use HTTPS URL: `https://lana-ai-chef.taile853ba.ts.net:8080`
- Do NOT use HTTP or IP address for iOS apps
- The HTTPS certificate is valid and satisfies ATS requirements

### Tailscale Not Connected

**Problem:** Tailscale shows "Not connected"

**Solution:**
1. Open Tailscale app
2. Tap/click "Connect"
3. If prompted, approve the connection
4. Wait for status to show "Connected"

---

## Security Notes

### What is Tailscale?

Tailscale creates a secure, private network (VPN) between your devices. Think of it as a secure tunnel that lets you access the Mac Studio as if you were on the same local network, even when you're remote.

### Security Features

- ✅ **End-to-end encrypted** - All traffic is encrypted
- ✅ **No port forwarding** - Server doesn't need public exposure
- ✅ **Works through NAT** - No router configuration needed
- ✅ **Per-user access control** - Admin can add/remove users
- ✅ **Device management** - Admin can see all connected devices
- ✅ **Automatic HTTPS** - Valid SSL certificates for secure connections

### Best Practices

1. **Keep Tailscale updated** - Install updates when prompted
2. **Enable MFA** - Set up multi-factor authentication on your Tailscale account
3. **Use HTTPS** - Always use HTTPS URLs for iOS/production apps
4. **Don't share credentials** - Each team member should have their own Tailscale account
5. **Disconnect when not in use** - Turn off Tailscale when you don't need access

---

## Admin Tasks

### Add New Team Member

1. Go to https://login.tailscale.com/admin/users
2. Click "Invite user"
3. Enter their email
4. Send invitation
5. Share this guide with them

### Remove Team Member

1. Go to https://login.tailscale.com/admin/machines
2. Find their device(s)
3. Click "..." menu → "Remove device"

### View Connected Devices

1. Go to https://login.tailscale.com/admin/machines
2. See all devices connected to your network
3. View IP addresses and last seen time

### Disable Key Expiry (Recommended)

By default, Tailscale device keys expire after 180 days. To avoid reconnection:

1. Go to https://login.tailscale.com/admin/machines
2. Click on the Mac Studio device
3. Click "Disable key expiry"
4. Confirm

This ensures the server's IP address never changes.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Hostname** | `lana-ai-chef.taile853ba.ts.net` |
| **IP Address** | `100.64.13.68` |
| **Port** | `8080` |
| **HTTPS URL** | `https://lana-ai-chef.taile853ba.ts.net:8080` |
| **HTTP URL** | `http://100.64.13.68:8080` |
| **Discovery** | `/health/discovery` |
| **Health Check** | `/health` |
| **Admin Console** | https://login.tailscale.com/admin |
| **Downloads** | https://tailscale.com/download |

---

## Support

### Need Help?

1. Check the troubleshooting section above
2. Verify Tailscale is connected (green status)
3. Test with the IP address: `http://100.64.13.68:8080`
4. Contact your admin if server is not responding

### Useful Commands

```bash
# Check Tailscale status
tailscale status

# Get your Tailscale IP
tailscale ip

# Check if you can reach the server
ping 100.64.13.68

# Test HTTP connection
curl http://100.64.13.68:8080/health

# Test HTTPS connection
curl https://lana-ai-chef.taile853ba.ts.net:8080/health
```

---

## FAQ

**Q: Do I need to be on the same WiFi as the Mac Studio?**
A: No! Tailscale works from anywhere - home, office, coffee shop, anywhere with internet.

**Q: Will this work on cellular data?**
A: Yes! Tailscale works on cellular, WiFi, wired - any internet connection.

**Q: Does Tailscale slow down my connection?**
A: Minimal impact. Tailscale uses peer-to-peer connections when possible for best performance.

**Q: Can I use this on multiple devices?**
A: Yes! Install Tailscale on your phone, laptop, tablet - all your devices.

**Q: What if I forget the server URL?**
A: Just remember the discovery endpoint: `https://lana-ai-chef.taile853ba.ts.net:8080/health/discovery` - it tells you everything you need.

**Q: Is my data secure?**
A: Yes! All traffic over Tailscale is encrypted end-to-end using WireGuard protocol.

**Q: What happens if the Mac Studio restarts?**
A: Tailscale auto-starts on boot. The server will be available again once macOS finishes loading.

**Q: Can I access this without Tailscale?**
A: Only if you're on the same local network (same WiFi). For remote access, you must use Tailscale.

---

**Last Updated:** December 11, 2025
**Server:** Mac Studio M3 (lana-ai-chef)
**Tailscale Network:** taile853ba.ts.net
