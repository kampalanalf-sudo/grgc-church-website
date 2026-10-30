# Phone Tracker — Android app

A thin native WebView shell around the hosted app at
<https://gatewayrevivalglory.online/phone-tracker/>. Because the real app is
the website, **web updates apply automatically — you only need a new APK when
the shell itself changes.**

## What the native layer adds
- Runtime **location permission** + WebView geolocation prompts
- **DOM storage** so you stay signed in (Supabase session)
- **Vibration**, **wake-lock** and a `TrackerNative` JS bridge
  (`setKeepAwake`, `saveBase64File` for CSV/GPX exports → Downloads)
- Media autoplay allowed so the **remote siren** can sound without a tap

## Building
CI builds it: the **Build Android APK** workflow runs on every push to `main`
that touches `phone-tracker/android/**` (or manually via *Run workflow*).
It assembles `app/build/outputs/apk/release/`, verifies the signature,
checks the package really contains `classes.dex` + the binary manifest,
prints the zip listing and sha256, and publishes the APK on the
**android-v1.0** GitHub Release.

To build locally you need the Android SDK + JDK 17:

```bash
cd phone-tracker/android
gradle assembleRelease
```

## Signing
CI prefers the repo secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`,
`KEY_ALIAS`, `KEY_PASSWORD` (Settings → Secrets → Actions). Without them it
generates a keystore and stores it in the actions cache, so the signature
stays stable between runs; if that cache is ever evicted, install the next
APK after uninstalling the old one (sign in again — your data lives in the
cloud, not on the phone).

## Releasing a new version
Bump `versionCode` (always increase) and `versionName` in
`app/build.gradle`, change the tag/filename in `.github/workflows/apk.yml`,
push to `main`.
