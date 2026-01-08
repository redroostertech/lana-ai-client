# Port Forwarding Guide for VPN

**Quick Answer:** Do you need port forwarding? **It depends on where you're testing.**

**🎯 XFINITY USERS:** Jump to [Xfinity-Specific Instructions](#xfinity-users-special-instructions) below!

---

## Port Forwarding: Yes or No?

### ❌ **NO** - You Don't Need Port Forwarding For:

1. **Local Testing (On-Site)**
   - Testing on same WiFi network
   - Accessing via `http://10.0.0.3:8080`
   - Downloading VPN configs (while on-site)
   - Verifying WireGuard is running
   - Testing login page locally

2. **Initial Development/Testing**
   - Setting up VPN for the first time
   - Verifying everything works locally
   - Testing on phones/laptops connected to same WiFi

**Example:**
```
You → Same WiFi (192.168.x.x) → Mac Server (10.0.0.3) ✅ Works
```

---

### ✅ **YES** - You Need Port Forwarding For:

1. **Remote Access (Off-Site)**
   - Connecting from home/coffee shop/anywhere outside the office
   - Testing VPN from mobile data
   - Production remote user access
   - Connecting VPN clients from internet

2. **Production Deployment**
   - Real-world remote access scenarios
   - Multiple remote users
   - Mobile workers
   - Work-from-home employees

**Example:**
```
You → Mobile Data → Internet → Router (Needs Port Forwarding!) → Mac Server ✅ Works
You → Home WiFi → Internet → Router (Needs Port Forwarding!) → Mac Server ✅ Works
```

---

## Testing Plan: When to Configure What

### Phase 1: Local Testing (Start Here - NO Port Forwarding)

**Goal:** Verify everything works on-site

**Steps:**
1. ✅ Start WireGuard: `sudo wg-quick up wg0`
2. ✅ Start app: `./run.sh`
3. ✅ Check VPN status: `./run.sh vpn`
4. ✅ Test from Mac: `curl http://10.0.0.3:8080/api/health/discovery`
5. ✅ Test from phone on WiFi: Visit `http://10.0.0.3:8080/login.html`
6. ✅ Download VPN config: Visit `http://10.0.0.3:8080/vpn-setup.html`

**Port Forwarding:** NOT NEEDED ❌

**Time:** 10-15 minutes

---

### Phase 2: Remote Testing (Add Port Forwarding)

**Goal:** Test remote access from outside network

**Steps:**
1. ✅ Configure port forwarding in router (see below)
2. ✅ Test from mobile data: Connect VPN on phone
3. ✅ Access app through VPN: Visit `http://10.0.0.3:8080/login.html`

**Port Forwarding:** REQUIRED ✅

**Time:** 15-20 minutes (5 min router config + 10 min testing)

---

## How to Configure Port Forwarding

### Step 1: Find Your Router's Admin Page

**Common router IPs:**
- `http://192.168.1.1`
- `http://192.168.0.1`
- `http://10.0.0.1`
- `http://192.168.100.1`

**Or check with:**
```bash
netstat -nr | grep default
```

**Router-specific URLs:**
| Brand | URL |
|-------|-----|
| **Xfinity** | **https://www.xfinity.com/support/internet/** (See Xfinity section below) |
| Netgear | http://routerlogin.net |
| Linksys | http://myrouter.local |
| TP-Link | http://tplinkwifi.net |
| Google WiFi | Use Google Home app |
| UniFi | Use UniFi Network Controller |
| Asus | http://router.asus.com |

---

## XFINITY USERS: Special Instructions

If you have **Xfinity (Comcast)** internet, follow these specific steps:

### Method 1: Using Xfinity xFi App (Recommended)

**Step 1: Download and Open xFi App**
1. Download "Xfinity xFi" app from App Store or Google Play
2. Sign in with your Xfinity account credentials
3. Tap "Connect" at the bottom

**Step 2: Access Advanced Settings**
1. Tap the **menu icon** (≡) in top left
2. Scroll down and tap **"Advanced Settings"**
3. You'll be redirected to the web gateway interface

**Step 3: Log into Gateway Admin**
- Username: `admin`
- Password: `password` (default) or the password on your gateway sticker
- Gateway IP is usually: `http://10.0.0.1`

**Step 4: Navigate to Port Forwarding**
1. Click **"Advanced"** in top menu
2. Click **"Port Forwarding"** in left sidebar
3. Click **"Add Service"** button

**Step 5: Add WireGuard VPN Rule**
- **Service Name:** `WireGuard VPN`
- **Service Type:** Select "Other" or "Custom"
- **Server IPv4 Address:** `10.0.0.3` (your Mac's IP)
- **Start Port:** `51820`
- **End Port:** `51820`
- **Protocol:** Select **"UDP"** (NOT TCP!)
- Click **"Save"**

**Step 6: Add LANA-AI API Rule**
- Click **"Add Service"** again
- **Service Name:** `LANA-AI API`
- **Service Type:** Select "Other" or "Custom"
- **Server IPv4 Address:** `10.0.0.3` (your Mac's IP)
- **Start Port:** `8080`
- **End Port:** `8080`
- **Protocol:** Select **"TCP"**
- Click **"Save"**

### Method 2: Using Web Browser (Alternative)

**Step 1: Access Gateway**
1. Open web browser
2. Go to: `http://10.0.0.1`
3. Login:
   - Username: `admin`
   - Password: `password` (or check sticker on gateway)

**Step 2: Navigate to Port Forwarding**
1. Click **"Advanced"** tab
2. Click **"Port Forwarding"** in left menu
3. Click **"Add Service"**

**Step 3: Add Both Rules**
- Follow Step 5 and Step 6 from Method 1 above

### Important Xfinity Notes

⚠️ **Bridge Mode Warning:**
- If your Xfinity gateway is in "Bridge Mode", port forwarding is **disabled**
- Bridge Mode passes the public IP to your own router
- In this case, configure port forwarding on YOUR router instead

⚠️ **Static IP Lease (Recommended):**
1. In gateway admin, go to **"Connected Devices"**
2. Find your Mac (10.0.0.3)
3. Click **"Edit"** or gear icon
4. Enable **"Reserved IP"** or **"DHCP Reservation"**
5. This ensures your Mac always gets `10.0.0.3`

⚠️ **Gateway Models:**
- Works on: XB6, XB7, XB8 (Arris, Technicolor)
- Admin interface may look slightly different per model

### Testing Xfinity Port Forwarding

After adding rules:
1. **Wait 2-3 minutes** for gateway to apply changes
2. Test from mobile data (not WiFi):
   - Visit: https://www.yougetsignal.com/tools/open-ports/
   - Enter your public IP (find at https://whatismyipaddress.com)
   - Test port: `51820`
   - Should show: "Port 51820 is open on [your IP]"

If ports show **closed** after 5 minutes:
- Check if gateway is in Bridge Mode (see above)
- Your public IP might be different from gateway WAN IP (CGNAT issue)
- Call Xfinity: 1-800-XFINITY and ask them to remove CGNAT

---

### Step 2: Navigate to Port Forwarding (Non-Xfinity Routers)

**Look for these menu items:**
- "Port Forwarding"
- "Virtual Server"
- "NAT Forwarding"
- "Gaming" (sometimes includes port forwarding)
- "Advanced → Port Forwarding"
- "Firewall → Port Forwarding"

---

### Step 3: Add Two Port Forwarding Rules (Non-Xfinity Routers)

#### Rule 1 - WireGuard VPN

| Field | Value |
|-------|-------|
| Service Name | `WireGuard VPN` |
| External Port | `51820` |
| Internal IP | `10.0.0.3` (your Mac's IP) |
| Internal Port | `51820` |
| Protocol | `UDP` (important!) |

#### Rule 2 - LANA-AI Web/API

| Field | Value |
|-------|-------|
| Service Name | `LANA-AI API` |
| External Port | `8080` |
| Internal IP | `10.0.0.3` (your Mac's IP) |
| Internal Port | `8080` |
| Protocol | `TCP` |

**⚠️ Note:** Some routers call it "Port Range" - in that case, use `51820-51820` and `8080-8080`.

---

### Step 4: Save and Apply

- Click "Save" or "Apply"
- Router may reboot (1-2 minutes)
- Wait for router to come back online

---

### Step 5: Test Port Forwarding

#### Test from External Network (Mobile Data)

**Method 1: Use a Port Checker Tool**
- Visit: https://www.yougetsignal.com/tools/open-ports/
- Enter your public IP: `24.99.172.140`
- Test port: `51820`
- Should show: "Open" or "Success"

**Method 2: Try Connecting VPN**
- Disconnect from WiFi (use mobile data)
- Open WireGuard app on phone
- Try to connect to your VPN
- Should connect successfully

**Method 3: Test Web Access**
- From mobile data, visit: `http://24.99.172.140:8080`
- Should see: Connection timeout (this is expected - you need VPN)
- Connect VPN, then try again
- Should see: LANA-AI login page

---

## Troubleshooting Port Forwarding

### Issue: Ports Show as "Closed" After Configuration

**Possible Causes:**

1. **ISP Blocks Inbound Connections (CGNAT)**
   - Some ISPs use Carrier-Grade NAT
   - Blocks all inbound connections
   - **Solution:** Call ISP, ask them to:
     - Remove CGNAT
     - Enable port forwarding
     - Upgrade to business internet (may be required)

2. **Mac Firewall Blocking**
   - macOS firewall might block ports
   - **Solution:**
     ```bash
     # Check firewall status
     sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

     # Allow WireGuard
     sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /opt/homebrew/bin/wg
     sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblock /opt/homebrew/bin/wg
     ```

3. **Wrong Internal IP**
   - Port forwarding pointing to wrong IP
   - **Solution:** Verify Mac's IP:
     ```bash
     ifconfig | grep "inet " | grep -v 127.0.0.1
     ```
     Should show `10.0.0.3`

4. **WireGuard Not Running**
   - VPN server not actually listening
   - **Solution:**
     ```bash
     sudo wg show
     # Should show interface details
     ```

5. **Router's External IP is Different**
   - CGNAT or double-NAT situation
   - **Solution:**
     ```bash
     # Check your public IP
     curl ifconfig.me

     # Check router's WAN IP (in router admin page)
     # These should match!
     ```

---

## ISP Issues & Solutions

### Problem: ISP Uses CGNAT

**Symptoms:**
- Ports always show closed
- Router's WAN IP is in private range (10.x.x.x, 172.x.x.x, 100.64.x.x)
- Port forwarding doesn't work no matter what

**How to Check:**
```bash
# Get your public IP
curl ifconfig.me

# Log into router, check WAN IP
# If they're DIFFERENT, you're behind CGNAT
```

**Solutions:**

1. **Ask ISP to Remove CGNAT (Free-Cheap)**
   - Call ISP support
   - Say: "I need CGNAT removed for a business server"
   - Some ISPs will do this for free
   - Others charge $5-20/month

2. **Upgrade to Business Internet (Expensive but Best)**
   - Business plans usually don't have CGNAT
   - Often include static IP
   - Cost: $80-200/month depending on ISP
   - Benefits: Faster upload, better support, static IP

3. **Use VPN Service as Relay (Workaround)**
   - Services like Tailscale, ZeroTier, ngrok
   - Bypass CGNAT entirely
   - Not covered in this guide

---

## Decision Matrix

| Scenario | Port Forwarding Needed? | Time to Configure |
|----------|------------------------|-------------------|
| Testing locally (same WiFi) | ❌ No | N/A |
| Downloading VPN configs on-site | ❌ No | N/A |
| Testing VPN from mobile data | ✅ Yes | 5-10 minutes |
| Production remote access | ✅ Yes | 5-10 minutes |
| Multiple remote users | ✅ Yes | 5-10 minutes |

---

## Quick Commands Reference

```bash
# Check if WireGuard is listening
sudo wg show

# Check Mac's local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Check public IP
curl ifconfig.me

# Test port from outside (using external service)
# Visit: https://www.yougetsignal.com/tools/open-ports/

# Check firewall rules (macOS)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --listapps

# View VPN configuration details
./run.sh vpn
```

---

## Summary

### For Testing NOW (Local)
**Port Forwarding:** ❌ NOT NEEDED

Just:
1. Start WireGuard: `sudo wg-quick up wg0`
2. Start app: `./run.sh`
3. Test locally: `http://10.0.0.3:8080`

### For Production Later (Remote Access)
**Port Forwarding:** ✅ REQUIRED

You'll need:
1. Configure router (5-10 minutes)
2. Test from mobile data
3. Verify ports are open

---

## Next Steps

### Ready to Test Locally?
```bash
# 1. Start WireGuard
sudo wg-quick up wg0

# 2. Start application
./run.sh

# 3. Check VPN status
./run.sh vpn

# 4. Test locally
curl http://10.0.0.3:8080/api/health/discovery
```

### Ready for Remote Access?
1. Configure port forwarding (see steps above)
2. Test from mobile device on mobile data
3. Connect VPN and access app

---

## 📋 XFINITY QUICK REFERENCE CARD

**For Xfinity users: Here's the TL;DR**

### Quick Steps (5 minutes)

1. **Access Gateway:**
   - Go to: `http://10.0.0.1`
   - Login: `admin` / `password`

2. **Navigate:**
   - Click: **Advanced** → **Port Forwarding** → **Add Service**

3. **Add Rule 1 (VPN):**
   ```
   Service Name: WireGuard VPN
   IP Address: 10.0.0.3
   Start/End Port: 51820
   Protocol: UDP
   Click: Save
   ```

4. **Add Rule 2 (API):**
   ```
   Service Name: LANA-AI API
   IP Address: 10.0.0.3
   Start/End Port: 8080
   Protocol: TCP
   Click: Save
   ```

5. **Reserve IP (Important!):**
   - Go to: **Connected Devices**
   - Find: Mac (10.0.0.3)
   - Enable: **Reserved IP**

6. **Test:**
   - Wait 2-3 minutes
   - Use mobile data: https://www.yougetsignal.com/tools/open-ports/
   - Test port: `51820`

### Common Xfinity Issues

**Gateway in Bridge Mode?**
- Port forwarding won't work
- Configure on YOUR router instead

**Ports still closed?**
- Call Xfinity: 1-800-XFINITY
- Say: "I need CGNAT removed for a business server"
- They may charge $5-20/month or suggest business plan

**Alternative App Method:**
- Download: Xfinity xFi app
- Tap: Menu → Advanced Settings
- Follow same steps as above

---

**Questions?**
- Check full VPN docs: `docs/VPN_MOBILE_SETUP_AND_DEPLOYMENT.md`
- View VPN status: `./run.sh vpn`
- Test IP changes: `./run.sh check-ip`
