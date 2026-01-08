# Tailscale Configuration for lana-ai-chef

**Last Updated:** 2025-12-19
**Machine:** lana-ai-chef
**Status:** Active

---

## Required Configuration

### 1. Computer Name
```bash
Computer Name: lana-ai-chef
Local Hostname: lana-ai-chef
```

**Verify with:**
```bash
scutil --get ComputerName
scutil --get LocalHostName
```

**Set with:**
```bash
sudo scutil --set ComputerName lana-ai-chef
sudo scutil --set LocalHostName lana-ai-chef
```

### 2. Tailscale Serve Configuration

**HTTPS on port 8080** proxying to local API:

```bash
tailscale serve --bg --https=8080 http://localhost:8080
```

**Expected output:**
```
Available within your tailnet:

https://lana-ai-chef.taile853ba.ts.net:8080/
|-- proxy http://localhost:8080

Serve started and running in the background.
```

**Verify with:**
```bash
tailscale serve status
```

**Expected status:**
```
https://lana-ai-chef.taile853ba.ts.net:8080 (tailnet only)
|-- / proxy http://localhost:8080
```

---

## Team Access URLs

Once configured, team members can access via:

- **HTTPS (recommended):** `https://lana-ai-chef.taile853ba.ts.net:8080`
- **HTTP (fallback):** `http://lana-ai-chef.taile853ba.ts.net:8080`
- **Direct IP:** `http://100.107.51.75:8080`

**Test endpoint:**
```
https://lana-ai-chef.taile853ba.ts.net:8080/api/health/discovery
```

---

## What Can Break This Configuration

1. **Tailscale app restart** - May lose Serve configuration
2. **Computer name change** - Changes the Tailscale hostname
3. **Tailscale logout/login** - Creates new device registration
4. **System reboot** - Serve configuration should persist, but verify
5. **Killing tailscaled process** - Can cause device re-registration

---

## Recovery Procedure

If the configuration is broken:

1. **Run the fix script:**
   ```bash
   ./scripts/fix-tailscale.sh
   ```

2. **Or manually:**
   ```bash
   # Step 1: Set computer name
   sudo scutil --set ComputerName lana-ai-chef
   sudo scutil --set LocalHostName lana-ai-chef

   # Step 2: Restart Tailscale app
   # Quit Tailscale from menu bar, then reopen from Applications

   # Step 3: Configure HTTPS Serve
   tailscale serve --bg --https=8080 http://localhost:8080

   # Step 4: Verify
   tailscale serve status
   curl -k https://lana-ai-chef.taile853ba.ts.net:8080/api/health/discovery
   ```

3. **Clean up old devices** (if needed):
   - Go to https://login.tailscale.com/admin/machines
   - Delete any duplicate "chef" or "lana-ai-chef" devices with old IPs

---

## Monitoring

**Check if configuration is correct:**
```bash
./scripts/check-tailscale.sh
```

**Expected healthy output:**
- ✅ Computer name is "lana-ai-chef"
- ✅ Tailscale connected
- ✅ Serve configured on port 8080
- ✅ API responding via HTTPS

---

## Troubleshooting

### Team member cannot access

1. **Check their Tailscale connection:**
   ```bash
   tailscale status
   ```
   - They should see "lana-ai-chef" as "Connected"

2. **Test ping:**
   ```bash
   ping lana-ai-chef.taile853ba.ts.net
   ```

3. **Test HTTP first:**
   ```bash
   curl http://lana-ai-chef.taile853ba.ts.net:8080/health
   ```

4. **Test HTTPS:**
   ```bash
   curl https://lana-ai-chef.taile853ba.ts.net:8080/health
   ```

### Serve not working

```bash
# Turn off and reconfigure
tailscale serve --https=8080 off
tailscale serve --bg --https=8080 http://localhost:8080
```

### Wrong hostname showing

```bash
# Check current name
scutil --get ComputerName

# If wrong, fix it
sudo scutil --set ComputerName lana-ai-chef
sudo scutil --set LocalHostName lana-ai-chef

# Restart Tailscale app
```

---

## Integration with Deployment

The Tailscale configuration should be verified:
- On system startup
- After running `./run.sh`
- After any Tailscale updates

See: `scripts/fix-tailscale.sh` for automated checking and fixing.
