# Native App Build Guide (Codemagic)

Build your Ignite Club HQ Android and iOS apps using Codemagic — no local Android Studio or Xcode required.

## Prerequisites

### 1. Firebase Project Setup
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Add Android app:
   - Package name: `app.lovable.igniteteamhub`
   - Download `google-services.json`
4. Add iOS app:
   - Bundle ID: `app.lovable.igniteteamhub`
   - Download `GoogleService-Info.plist`
5. Enable Cloud Messaging and get your **FCM Server Key**:
   - Project Settings → Cloud Messaging → Server key

### 2. Add FCM Secret to Supabase
Add your FCM Server Key as a secret in Supabase:
- Go to: https://supabase.com/dashboard/project/yabcfiuntwqjwvschnji/settings/functions
- Add secret: `FCM_SERVER_KEY` = your server key

### 3. Export Project to GitHub
1. In Lovable, click your project name → Settings → GitHub
2. Connect and export to your GitHub account
3. Clone the repo locally (just once, for adding native platforms):

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
npm install
```

### 4. Add Native Platforms (One-time Setup)

```bash
# Build the web app
npm run build

# Add Android platform
npx cap add android

# Add iOS platform  
npx cap add ios

# Copy Firebase config files
cp /path/to/google-services.json android/app/
cp /path/to/GoogleService-Info.plist ios/App/App/

# Sync everything
npx cap sync

# Commit and push
git add .
git commit -m "Add native platforms with Firebase"
git push
```

---

## Codemagic Setup

### 1. Create Codemagic Account
1. Go to [codemagic.io](https://codemagic.io/)
2. Sign up with GitHub
3. Click "Add application" → Select your repo

### 2. Add codemagic.yaml to Your Repo

Create `codemagic.yaml` in your project root:

```yaml
workflows:
  android-workflow:
    name: Android Build
    max_build_duration: 60
    instance_type: mac_mini_m2
    environment:
      java: 17
      node: 18
    scripts:
      - name: Install dependencies
        script: npm install
      - name: Build web app
        script: npm run build
      - name: Sync Capacitor
        script: npx cap sync android
      - name: Build Android
        script: |
          cd android
          ./gradlew assembleDebug
    artifacts:
      - android/app/build/outputs/**/*.apk

  ios-workflow:
    name: iOS Build
    max_build_duration: 60
    instance_type: mac_mini_m2
    environment:
      xcode: latest
      node: 18
      cocoapods: default
    scripts:
      - name: Install dependencies
        script: npm install
      - name: Build web app
        script: npm run build
      - name: Sync Capacitor
        script: npx cap sync ios
      - name: Install CocoaPods
        script: |
          cd ios/App
          pod install
      - name: Build iOS (Simulator)
        script: |
          cd ios/App
          xcodebuild -workspace App.xcworkspace \
            -scheme App \
            -configuration Debug \
            -destination 'generic/platform=iOS Simulator' \
            -derivedDataPath build \
            build
    artifacts:
      - ios/App/build/**/*.app
```

Commit and push:
```bash
git add codemagic.yaml
git commit -m "Add Codemagic build configuration"
git push
```

### 3. Run Your First Build
1. In Codemagic dashboard, select your app
2. Click "Start new build"
3. Select workflow (android-workflow or ios-workflow)
4. Wait for build to complete (~5-10 minutes)
5. Download APK/APP from artifacts

---

## Signed Release Builds (For App Stores)

### Android Signing

1. Generate a keystore (run locally once):
```bash
keytool -genkey -v -keystore ignite-release.keystore \
  -alias ignite -keyalg RSA -keysize 2048 -validity 10000
```

2. In Codemagic → App settings → Environment variables, add:
   - `CM_KEYSTORE` (upload your keystore file)
   - `CM_KEYSTORE_PASSWORD`
   - `CM_KEY_ALIAS`
   - `CM_KEY_PASSWORD`

3. Update codemagic.yaml android build script:
```yaml
- name: Build Android Release
  script: |
    cd android
    ./gradlew assembleRelease
```

### iOS Signing

1. In Codemagic → App settings → Code signing:
   - Upload your Apple Distribution certificate (.p12)
   - Upload your provisioning profile
   - Or use Codemagic's automatic signing with App Store Connect API

2. Update codemagic.yaml ios build script for release.

---

## Updating Your App

After making changes in Lovable:

1. **Web app**: Auto-deploys to Netlify (no action needed)

2. **Native apps**: 
   - Go to Codemagic dashboard
   - Click "Start new build"
   - Download new APK/IPA
   - Upload to Google Play / App Store

Or set up automatic builds on every push in Codemagic settings.

---

## Troubleshooting

### Build fails on npm install
- Check Node version in codemagic.yaml matches your project requirements

### Android build fails
- Ensure `google-services.json` is in `android/app/`
- Check Gradle version compatibility

### iOS build fails
- Ensure `GoogleService-Info.plist` is in `ios/App/App/`
- Run `pod install` in `ios/App/` before pushing

### Push notifications not working
- Verify `FCM_SERVER_KEY` secret is set in Supabase
- Check Firebase project has correct bundle IDs
- Ensure push notification capability is enabled in Xcode project

---

## Useful Links

- [Codemagic Capacitor Docs](https://docs.codemagic.io/yaml-quick-start/building-a-capacitor-app/)
- [Firebase Console](https://console.firebase.google.com/)
- [Supabase Edge Functions Secrets](https://supabase.com/dashboard/project/yabcfiuntwqjwvschnji/settings/functions)
- [Capacitor Documentation](https://capacitorjs.com/docs)
