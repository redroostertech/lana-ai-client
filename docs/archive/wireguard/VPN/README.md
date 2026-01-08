# LanaAI VPN Documentation

**Version:** 1.0.0
**Last Updated:** 2024-12-10

## Overview

This directory contains all documentation for LanaAI's optional WireGuard VPN feature, which enables secure remote access to LanaAI servers deployed on customer networks.

---

## 📚 Documentation Index

### 1. [VPN Implementation Guide](./VPN_IMPLEMENTATION.md)
**For:** System administrators, DevOps engineers
**Purpose:** Technical implementation details and architecture

**Contents:**
- Architecture overview (network extender model)
- Backend components (services, routes, database)
- Frontend components (setup wizard)
- Deployment steps
- Configuration reference
- Troubleshooting

**When to read:** Setting up VPN on a new LanaAI server deployment

---

### 2. [VPN Quick Start Guide](./VPN_QUICKSTART.md)
**For:** System administrators
**Purpose:** Fast 5-minute VPN setup on existing LanaAI server

**Contents:**
- Prerequisites checklist
- Step-by-step installation (7 steps)
- **Critical: IP forwarding configuration**
- Firewall setup
- Verification steps
- Common troubleshooting

**When to read:** Quick VPN enablement on an already-deployed server

---

### 3. [VPN Mobile Setup & Product Deployment](./VPN_MOBILE_SETUP_AND_DEPLOYMENT.md)
**For:** End users, support teams, deployment engineers
**Purpose:** Complete guide for mobile VPN setup and customer onboarding

**Contents:**
- **Mobile VPN setup instructions (iOS & Android)**
- Product installation on Mac Studio/Mini
- Customer onboarding process
- Complete VPN flow documentation
- Edge cases & troubleshooting
- Chicken-and-egg problem solutions

**When to read:** Onboarding customers or helping users set up VPN on mobile devices

---

### 4. Uninstallation & Cleanup

#### Server-Side Uninstall
- **Quick disable:** See [VPN_QUICKSTART.md - Uninstall VPN](./VPN_QUICKSTART.md#-uninstall-vpn-quick-disableremove)
- **Complete removal:** See [VPN_IMPLEMENTATION.md - Uninstallation](./VPN_IMPLEMENTATION.md#uninstallation-and-cleanup)

**Quick disable command:**
```bash
sudo ./scripts/cleanup-vpn.sh
```

#### Mobile Client Uninstall

**iOS:**
1. Open WireGuard app → Swipe left on config → Delete
2. Settings → VPN & Device Management → Delete VPN profiles

**Android:**
1. Open WireGuard app → Long-press tunnel → Delete
2. Settings → Network & Internet → VPN → Forget profiles

**When to uninstall:**
- Testing/debugging VPN setup
- Decommissioning server
- Removing VPN feature from deployment

---

## 🏗️ Architecture Quick Reference

### Network Model: VPN as Network Extender

```
Customer Network: 192.168.100.0/24
├─ Mac Studio (LanaAI Server): 192.168.100.50:8080
├─ On-site users: Direct connection ✓
└─ WireGuard VPN Server
       │
       │ Public: 203.0.113.42:51820 (customer's router)
       │ Routes: 192.168.100.0/24 through VPN tunnel
       │
       └─ Remote users → VPN tunnel → 192.168.100.50:8080 ✓
```

**Key Benefit:** Single URL (`http://192.168.100.50:8080`) works for all users, whether on-site or remote.

---

## 📱 Mobile Thin Client + VPN Process

### Overview

The LanaAI mobile thin client (iOS/Android native apps) automatically handles VPN requirements based on network location.

### User Experience Flow

#### Scenario 1: User on Customer Network (Office Wi-Fi)
```
User opens app
    ↓
App discovers server: 192.168.100.50:8080
    ↓
Direct connection ✓ (No VPN needed)
    ↓
User logs in normally
```

**Implementation:**
- App attempts HTTP connection to server
- If successful within 5 seconds → proceed to login
- No VPN setup required

---

#### Scenario 2: User Off-Network (Home, Cellular, Public Wi-Fi)
```
User opens app
    ↓
App tries to connect to 192.168.100.50:8080
    ↓
Connection fails (not on local network)
    ↓
App checks: Is VPN enabled for this organization?
    ↓ YES
    ↓
App checks: Is WireGuard installed?
    ↓ NO
    ↓
Show in-app VPN setup wizard
    ↓
User follows steps:
  1. Install WireGuard from App Store
  2. Login to get VPN config
  3. Import config to WireGuard
  4. Connect VPN
    ↓
Return to app
    ↓
Connection succeeds ✓
    ↓
User logs in normally
```

---

### Mobile App Implementation Guide

#### Step 1: Detect Network Reachability

**iOS (Swift):**
```swift
func isServerReachable(url: String) async -> Bool {
    guard let url = URL(string: url) else { return false }

    do {
        let (_, response) = try await URLSession.shared.data(from: url)
        if let httpResponse = response as? HTTPURLResponse {
            return httpResponse.statusCode == 200
        }
    } catch {
        return false
    }

    return false
}

// Usage
let serverUrl = "http://192.168.100.50:8080/api/health/discovery"
let isReachable = await isServerReachable(url: serverUrl)
```

**Android (Kotlin):**
```kotlin
suspend fun isServerReachable(url: String): Boolean = withContext(Dispatchers.IO) {
    try {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 5000
        connection.readTimeout = 5000

        val responseCode = connection.responseCode
        connection.disconnect()

        return@withContext responseCode == 200
    } catch (e: Exception) {
        return@withContext false
    }
}

// Usage
val serverUrl = "http://192.168.100.50:8080/api/health/discovery"
val isReachable = isServerReachable(serverUrl)
```

---

#### Step 2: Check VPN Requirements

**Query the discovery endpoint to check if VPN is required:**

**iOS (Swift):**
```swift
struct DiscoveryResponse: Codable {
    let status: String
    let discovery: Discovery

    struct Discovery: Codable {
        let staticIp: String
        let port: Int
        let vpn: VPNInfo?

        enum CodingKeys: String, CodingKey {
            case staticIp = "static_ip"
            case port
            case vpn
        }
    }

    struct VPNInfo: Codable {
        let enabled: Bool
        let requiredForRemoteAccess: Bool
        let publicEndpoint: String
        let serverPublicKey: String

        enum CodingKeys: String, CodingKey {
            case enabled
            case requiredForRemoteAccess = "required_for_remote_access"
            case publicEndpoint = "public_endpoint"
            case serverPublicKey = "server_public_key"
        }
    }
}

func checkVPNRequirements(serverUrl: String) async -> VPNInfo? {
    guard let url = URL(string: "\(serverUrl)/api/health/discovery") else { return nil }

    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(DiscoveryResponse.self, from: data)
        return response.discovery.vpn
    } catch {
        print("Failed to fetch discovery: \(error)")
        return nil
    }
}
```

**Android (Kotlin):**
```kotlin
data class DiscoveryResponse(
    val status: String,
    val discovery: Discovery
)

data class Discovery(
    @SerializedName("static_ip") val staticIp: String,
    val port: Int,
    val vpn: VPNInfo?
)

data class VPNInfo(
    val enabled: Boolean,
    @SerializedName("required_for_remote_access") val requiredForRemoteAccess: Boolean,
    @SerializedName("public_endpoint") val publicEndpoint: String,
    @SerializedName("server_public_key") val serverPublicKey: String
)

suspend fun checkVPNRequirements(serverUrl: String): VPNInfo? = withContext(Dispatchers.IO) {
    try {
        val response = apiService.getDiscovery("$serverUrl/api/health/discovery")
        return@withContext response.discovery.vpn
    } catch (e: Exception) {
        null
    }
}
```

---

#### Step 3: Handle VPN Setup in App

**Decision Tree:**
```
Server reachable?
├─ YES → Continue to login
└─ NO → Check VPN info
    ├─ VPN enabled AND required_for_remote_access?
    │   ├─ YES → Show VPN setup flow
    │   └─ NO → Show error "Server unreachable"
    └─ VPN info not available → Show error "Server unreachable"
```

**iOS (SwiftUI):**
```swift
struct LoginView: View {
    @State private var showVPNSetup = false
    @State private var vpnInfo: VPNInfo?

    var body: some View {
        VStack {
            if showVPNSetup {
                VPNSetupView(vpnInfo: vpnInfo)
            } else {
                LoginFormView()
            }
        }
        .onAppear {
            Task {
                await checkServerConnection()
            }
        }
    }

    func checkServerConnection() async {
        let serverUrl = UserDefaults.standard.string(forKey: "serverUrl") ?? ""

        // Try to connect
        let isReachable = await isServerReachable(url: serverUrl)

        if !isReachable {
            // Check if VPN is available
            vpnInfo = await checkVPNRequirements(serverUrl: serverUrl)

            if let vpn = vpnInfo, vpn.enabled && vpn.requiredForRemoteAccess {
                showVPNSetup = true
            } else {
                // Show error
                showError("Server unreachable. Please check your connection.")
            }
        }
    }
}
```

**Android (Jetpack Compose):**
```kotlin
@Composable
fun LoginScreen(viewModel: LoginViewModel) {
    val uiState by viewModel.uiState.collectAsState()

    when (uiState) {
        is UiState.CheckingConnection -> LoadingScreen()
        is UiState.VPNRequired -> VPNSetupScreen(uiState.vpnInfo)
        is UiState.Ready -> LoginForm()
        is UiState.Error -> ErrorScreen(uiState.message)
    }

    LaunchedEffect(Unit) {
        viewModel.checkServerConnection()
    }
}

class LoginViewModel : ViewModel() {
    private val _uiState = MutableStateFlow<UiState>(UiState.CheckingConnection)
    val uiState: StateFlow<UiState> = _uiState

    fun checkServerConnection() {
        viewModelScope.launch {
            val serverUrl = prefs.getString("serverUrl", "")
            val isReachable = isServerReachable(serverUrl)

            if (!isReachable) {
                val vpnInfo = checkVPNRequirements(serverUrl)

                if (vpnInfo?.enabled == true && vpnInfo.requiredForRemoteAccess) {
                    _uiState.value = UiState.VPNRequired(vpnInfo)
                } else {
                    _uiState.value = UiState.Error("Server unreachable")
                }
            } else {
                _uiState.value = UiState.Ready
            }
        }
    }
}
```

---

#### Step 4: VPN Setup Flow in Mobile App

**VPN Setup Screen Components:**

1. **Check if WireGuard is installed**
2. **Provide WireGuard installation link**
3. **Authenticate user to get VPN config**
4. **Download VPN config file**
5. **Trigger import to WireGuard**
6. **Return to app and retry connection**

**iOS Implementation:**
```swift
struct VPNSetupView: View {
    let vpnInfo: VPNInfo?
    @State private var setupStep = 1

    var body: some View {
        VStack(spacing: 20) {
            Text("VPN Setup Required")
                .font(.title)

            Text("You're not on the office network. Set up VPN to connect remotely.")
                .multilineTextAlignment(.center)

            // Step 1: Install WireGuard
            if setupStep == 1 {
                VStack {
                    Text("Step 1: Install WireGuard")
                        .font(.headline)

                    Button("Open App Store") {
                        openWireGuardAppStore()
                    }

                    Button("I've installed it") {
                        setupStep = 2
                    }
                }
            }

            // Step 2: Login and download config
            if setupStep == 2 {
                VStack {
                    Text("Step 2: Login to get your VPN config")
                        .font(.headline)

                    LoginFormView { credentials in
                        Task {
                            await downloadVPNConfig(credentials)
                        }
                    }
                }
            }

            // Step 3: Import to WireGuard
            if setupStep == 3 {
                VStack {
                    Text("Step 3: Import config to WireGuard")
                        .font(.headline)

                    Text("Tap 'Open in WireGuard' when prompted")

                    Button("Done - Return to App") {
                        // Retry connection
                        setupStep = 4
                    }
                }
            }
        }
    }

    func openWireGuardAppStore() {
        let url = URL(string: "https://apps.apple.com/app/wireguard/id1441195209")!
        UIApplication.shared.open(url)
    }

    func downloadVPNConfig(_ credentials: Credentials) async {
        // Authenticate
        let token = await authenticate(credentials)

        // Download config
        let configData = await downloadConfig(token: token)

        // Save to temporary location
        let tempURL = saveToTemp(configData)

        // Trigger share sheet / Open in WireGuard
        shareFile(tempURL)

        setupStep = 3
    }
}
```

**Android Implementation:**
```kotlin
@Composable
fun VPNSetupScreen(vpnInfo: VPNInfo) {
    var setupStep by remember { mutableStateOf(1) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("VPN Setup Required", style = MaterialTheme.typography.h5)

        Spacer(modifier = Modifier.height(16.dp))

        when (setupStep) {
            1 -> InstallWireGuardStep { setupStep = 2 }
            2 -> LoginAndDownloadStep(vpnInfo) { setupStep = 3 }
            3 -> ImportConfigStep { setupStep = 4 }
            4 -> RetryConnectionStep()
        }
    }
}

@Composable
fun InstallWireGuardStep(onNext: () -> Unit) {
    Column {
        Text("Step 1: Install WireGuard")

        Button(onClick = {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("https://play.google.com/store/apps/details?id=com.wireguard.android")
            }
            context.startActivity(intent)
        }) {
            Text("Open Play Store")
        }

        Button(onClick = onNext) {
            Text("I've installed it")
        }
    }
}

@Composable
fun LoginAndDownloadStep(vpnInfo: VPNInfo, onNext: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column {
        Text("Step 2: Login to get your VPN config")

        TextField(value = email, onValueChange = { email = it }, label = { Text("Email") })
        TextField(value = password, onValueChange = { password = it }, label = { Text("Password") })

        Button(onClick = {
            // Authenticate and download config
            downloadVPNConfig(email, password, vpnInfo)
            onNext()
        }) {
            Text("Download Config")
        }
    }
}

suspend fun downloadVPNConfig(email: String, password: String, vpnInfo: VPNInfo) {
    // Authenticate
    val token = authenticate(email, password)

    // Download config
    val configData = downloadConfig(token)

    // Save to external storage
    val file = File(context.getExternalFilesDir(null), "lana-vpn-$email.conf")
    file.writeBytes(configData)

    // Trigger intent to open with WireGuard
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(FileProvider.getUriForFile(context, "com.lana.app.fileprovider", file), "application/x-wireguard-profile")
        flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
    }
    context.startActivity(intent)
}
```

---

#### Step 5: Detect WireGuard Installation

**iOS:**
```swift
func isWireGuardInstalled() -> Bool {
    // WireGuard doesn't expose a URL scheme on iOS
    // Instead, check if config import would work
    // Or guide user through App Store installation
    return false // Always show install step
}
```

**Android:**
```kotlin
fun isWireGuardInstalled(context: Context): Boolean {
    return try {
        context.packageManager.getPackageInfo("com.wireguard.android", 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }
}
```

---

#### Step 6: Handle VPN Config Download

**API Endpoint:** `GET /api/v1/vpn/client-config`

**Headers:**
- `Authorization: Bearer <token>`

**Response:** Binary file (`application/x-wireguard-profile`)

**iOS:**
```swift
func downloadVPNConfig(token: String, serverUrl: String) async throws -> URL {
    var request = URLRequest(url: URL(string: "\(serverUrl)/api/v1/vpn/client-config")!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
        throw NetworkError.downloadFailed
    }

    // Save to temporary file
    let tempDir = FileManager.default.temporaryDirectory
    let filename = "lana-vpn-config.conf"
    let fileURL = tempDir.appendingPathComponent(filename)

    try data.write(to: fileURL)

    return fileURL
}

func shareVPNConfig(fileURL: URL) {
    let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    // Present activity controller
}
```

**Android:**
```kotlin
suspend fun downloadVPNConfig(token: String, serverUrl: String): File = withContext(Dispatchers.IO) {
    val request = Request.Builder()
        .url("$serverUrl/api/v1/vpn/client-config")
        .addHeader("Authorization", "Bearer $token")
        .build()

    val response = httpClient.newCall(request).execute()

    if (!response.isSuccessful) {
        throw IOException("Download failed: ${response.code}")
    }

    val bytes = response.body?.bytes() ?: throw IOException("Empty response")

    val file = File(context.getExternalFilesDir(null), "lana-vpn-config.conf")
    file.writeBytes(bytes)

    return@withContext file
}
```

---

### Testing Checklist for Mobile Apps

- [ ] **On-network connection** works without VPN
- [ ] **Off-network detection** triggers VPN setup flow
- [ ] **WireGuard installation** link opens correctly
- [ ] **VPN config download** succeeds with valid credentials
- [ ] **Config import to WireGuard** works on iOS and Android
- [ ] **Return to app** after VPN connection retries and succeeds
- [ ] **Error handling** for failed VPN setup
- [ ] **Seamless switching** between on-network and VPN modes

---

## 🔐 Security Considerations

### Private Key Handling
- User private keys are **encrypted** before storing in database
- Encryption key stored in `VPN_ENCRYPTION_KEY` environment variable
- Keys transmitted over HTTPS only (in production)

### Access Control
- VPN access granted per-user
- Admins can revoke access via API
- IP allocation tracked to prevent conflicts

### Network Isolation
- Split-tunnel configuration (only routes specific networks)
- Users' internet traffic NOT routed through VPN by default

---

## 🆘 Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Can't connect even with VPN | IP forwarding disabled | See [VPN_QUICKSTART.md](./VPN_QUICKSTART.md#step-5b-enable-ip-forwarding) |
| VPN connects but no access | Wrong allowed networks | Check `AllowedIPs` in client config |
| Can't download config | Not authenticated | Ensure user has valid account and password |
| WireGuard won't import | Invalid config format | Re-download config file |

### Support Resources
- **Quick Start:** [VPN_QUICKSTART.md](./VPN_QUICKSTART.md)
- **Full Implementation:** [VPN_IMPLEMENTATION.md](./VPN_IMPLEMENTATION.md)
- **Mobile Setup:** [VPN_MOBILE_SETUP_AND_DEPLOYMENT.md](./VPN_MOBILE_SETUP_AND_DEPLOYMENT.md)
- **Uninstall/Cleanup:** [VPN_IMPLEMENTATION.md - Uninstallation](./VPN_IMPLEMENTATION.md#uninstallation-and-cleanup)

---

## 📞 Support

For issues or questions:
1. Check troubleshooting sections in individual guides
2. Review server logs: `pm2 logs lana-api`
3. Verify WireGuard status: `sudo wg show wg0`
4. Contact: support@redroostertec.com

---

**Documentation Version:** 1.1.0
**Last Updated:** 2025-12-10
**Maintained By:** LanaAI Engineering Team
