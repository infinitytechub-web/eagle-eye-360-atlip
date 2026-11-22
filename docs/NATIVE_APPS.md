# Eagle Eye 360 · ATLIP — Native apps (iOS, Android, Desktop)

All apps use the same Supabase backend, roles, Row-Level Security, MFA rules and audit trail as the website.
No app holds any secret: only the public Supabase URL and publishable key are bundled.

| Platform | Technology | Package / bundle ID | Output |
|---|---|---|---|
| iOS 15+ | Capacitor 8 (web build bundled in the app) | `gh.infinitytechub.atlip` | Simulator build + unsigned `.xcarchive` |
| Android 7+ (target SDK 36) | Capacitor 8 | `gh.infinitytechub.atlip` | Debug APK, release APK, Play `.aab` |
| Windows 10/11 (x64, ARM64) | Electron 45 | `gh.infinitytechub.atlip.desktop` | NSIS installer `.exe` |
| macOS 12+ (Intel + Apple silicon) | Electron 45 | `gh.infinitytechub.atlip.desktop` | Universal `.dmg` |
| Linux (x64) | Electron 45 | `gh.infinitytechub.atlip.desktop` | `.AppImage`, `.deb` |

Version: **2.0.0** (Android versionCode / iOS build 20000).

## How sign-in works in the apps

- **Email + password + TOTP MFA:** works directly in every app, with the same rules as the website. This includes the forced password change and authenticator re-enrolment after a Super Administrator reset.
- **Passkeys (Face ID, Touch ID, fingerprint, Windows Hello, security keys):** passkeys belong to the domain `atlip.infinitytechub.com`, so the apps use them through the **system browser**:
  1. The app creates a one-time PKCE verifier (RFC 7636, S256) and opens `https://atlip.infinitytechub.com/#/native-login?cc=<challenge>`. The browser used is Safari View Controller on iOS, Chrome Custom Tabs on Android and the default browser on desktop.
  2. The user signs in there with their passkey, or with password and MFA, and taps **Approve**.
  3. The browser returns to `gh.infinitytechub.atlip://auth?code=…`. The code is single-use and lives for 60 seconds.
  4. The app redeems the code together with its verifier and gets its own session. A code intercepted by another app is useless without the verifier.

  Super Administrators still complete TOTP in the app, and accounts in a reset flow cannot use the hand-off.

## Voice traffic-light alerts in the apps

- **iOS and Android:**
  - Native location (Capacitor Geolocation) and native text-to-speech.
  - The screen is kept awake while alerts are on.
  - Location is requested only when the user starts alerts ("While using the app"). It is processed on the device and never uploaded.
  - Background alerts with the screen locked are deliberately **not** enabled. That would need "Always" location permission and extra App Store / Play review justification.
- **Desktop:** uses the operating system's location service through the browser engine. Desktop location is usually Wi-Fi based and much less accurate, so alerts are intended mainly for the phone apps.

## Security measures

**Mobile**
- HTTPS only; cleartext traffic disabled.
- Android:
  - App data is excluded from cloud backup and device transfer.
  - No WebView debugging in release builds.
  - Permissions are declared but requested only at the moment of use (location, camera).
- iOS: usage descriptions explain exactly why each permission is needed. `ITSAppUsesNonExemptEncryption = NO` (standard HTTPS only).

**Desktop (Electron)**
- Renderer: sandbox, context isolation, no Node.js, `webSecurity` on, no `<webview>`.
- Window: only `https://atlip.infinitytechub.com` can load in the app window. Other links open in the default browser (http/https/mailto only), and new windows are blocked.
- Permissions: geolocation, camera, notifications and clipboard-write are granted only to the ATLIP origin. USB, HID and serial access are always denied.
- Preload bridge: exposes 4 functions. The main process will only open the exact passkey sign-in URL shape.
- Electron fuses: RunAsNode off, `--inspect` and NODE_OPTIONS off, ASAR integrity on, load only from ASAR, cookie encryption on, extra file:// privileges off.
- Offline: the site's offline cache (service worker) keeps working. If the server cannot be reached, a local retry page is shown.

## Building

Every build runs in GitHub Actions: **Actions → "Native apps" → Run workflow**, or push a tag `vX.Y.Z` to also publish a GitHub Release with `SHA256SUMS.txt`.

The workflow:
- Builds the web bundle, syncs it into the native projects and runs the desktop security unit tests.
- Installs and launches the **Android** app on an Android 15 emulator. The job fails if the app is not in the foreground or crashes.
- Installs and launches the **iOS** app in the iOS Simulator. The job fails if it is not running.
- Keeps screenshots of both launches as build artefacts.

Local development (pnpm only; see the main README):
```bash
pnpm install --frozen-lockfile && pnpm run cap:sync   # web → native projects (run after any dependency change)
pnpm run android                                     # open in Android Studio
pnpm run ios                                         # open in Xcode (macOS)
cd desktop && pnpm install --frozen-lockfile && pnpm start   # desktop app against the live site
cd desktop && pnpm test && pnpm run dist                     # desktop installers for the current OS
```

## Signing and store submission (needs your accounts)

Builds are **unsigned** until you add your own signing identities. Nothing in the code needs to change.

### Android (Google Play)
1. Create an upload keystore (keep it safe; never commit it):
   `keytool -genkeypair -v -keystore atlip-upload.jks -alias atlip -keyalg RSA -keysize 4096 -validity 10000`
2. Add these repository secrets:
   - `ANDROID_KEYSTORE_BASE64` (`base64 -w0 atlip-upload.jks`)
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

   The workflow will then produce a signed release APK and `.aab`.
3. In the Play Console:
   - Upload the `.aab` and enrol in Play App Signing.
   - Data safety: account email and name are collected for app functionality. Location is **not collected**, because it is processed on the device only.
   - Declare camera and foreground location usage.

### iOS (App Store)
1. You need an Apple Developer Program membership. In Xcode, open `ios/App/App.xcodeproj`, select your Team and keep the bundle ID `gh.infinitytechub.atlip`.
2. Add an app-level privacy manifest (`PrivacyInfo.xcprivacy`) in Xcode:
   - No tracking.
   - Collected data types: email address and name, linked to the user, for app functionality.
   - Location: not collected.
3. Product → Archive → Distribute → App Store Connect. Submit with the usage descriptions already in `Info.plist`.

### Windows / macOS code signing
- **Windows:** set `CSC_LINK` / `CSC_KEY_PASSWORD` (an OV/EV code-signing certificate, or Azure Trusted Signing) as secrets, and remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from the workflow.
- **macOS:** set `CSC_LINK`, `CSC_KEY_PASSWORD` (a Developer ID Application certificate) plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` so electron-builder notarises the DMG.

Until then:
- **Windows** SmartScreen will warn ("More info → Run anyway").
- **macOS** Gatekeeper requires right-click → Open.

## CCTV gateway

The mobile apps call the gateway from `capacitor://localhost` (iOS) and `https://localhost` (Android). These origins are now in the gateway's default `ALLOWED_ORIGINS`. Add them to the gateway's `.env` on the camera network when you install it.

## Verification record (22 Nov 2026)

| Area | Result |
|---|---|
| Passkeys — browser (virtual authenticator): register, duplicate refused, passwordless sign-in, revoke | 17/17 |
| Admin password reset — server and database enforcement (sessions revoked, factors and passkeys removed, no skipping) | 15/15 |
| Admin password reset — forced password change and MFA re-enrolment in the browser | 13/13 |
| Admin screens — reset button, self-reset blocked, own password change keeps the MFA session | 8/8 |
| App sign-in hand-off (PKCE) from the iOS and Android origins — interception, replay, CORS | 16/16 |
| Voice alerts — engine unit tests | 11/11 |
| Voice alerts — browser drive simulation (300 m and 100 m alerts, parallel road, walking pace, permission denied, no location sent to the server) | 9/9 |
| Desktop security policy unit tests | 5/5 |
| Desktop app runtime (hardening, navigation lock, bridge, offline retry) | 13/13 |
| All 19 screens at desktop and phone sizes (no errors, no horizontal overflow, phone menu) | 19/19 + 19/19 |
| Android emulator / iOS Simulator launch, Windows / macOS installers | See the GitHub Actions run and Release |
