import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const auth = fs.readFileSync('src/pages/Auth/Auth.tsx', 'utf8')
const syncMobile = fs.readFileSync('src/lib/sync-mobile.ts', 'utf8')
const androidManifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(`mobile settings sync verification failed: ${message}`)
    process.exit(1)
  }
}

assert(
  app.includes('ensureMobileCloudSettingsHydrated'),
  'App must force a first mobile cloud settings pull for empty local profiles after login/session restore'
)

assert(
  /UPDATE\s+settings\s+SET\s+sync_enabled\s*=\s*1/i.test(app),
  'first mobile hydration must enable sync locally before calling syncNow(), otherwise syncNow exits early'
)

assert(
  /DELETE\s+FROM\s+sync_queue\s+WHERE\s+table_name\s*=\s*\?\s+AND\s+record_id\s*=\s*\?/i.test(app),
  'first mobile hydration must remove stale local settings queue before pulling remote settings'
)

assert(
  /syncNow\(true\)/.test(app),
  'first mobile hydration must force a full pull so settings are fetched without last_pull_at blocking it'
)

assert(
  /setTimeout\(\(\) => syncNow\(true\), 2000\)/.test(app),
  'Android startup/login sync must force a full pull so a stale last_pull_at cannot hide older cloud Jobs rows'
)

assert(
  app.includes('clearRestoredMobileAuthOnce') && app.includes('mobile_auth_restore_guard_v1'),
  'Mobile startup must clear one-time restored auth tokens so fresh installs open on Sign In / Create Account'
)

assert(
  app.includes("withStartupTimeout('clear restored mobile auth'") && app.indexOf('clear restored mobile auth') < app.indexOf('load saved session'),
  'Mobile restored-auth cleanup must run before loading any saved session token'
)

assert(
  androidManifest.includes('android:allowBackup="false"'),
  'Android app backup must be disabled so reinstall/fresh tester installs do not restore old auth Preferences'
)

assert(
  androidManifest.includes('android:fullBackupContent="false"'),
  'Android full backup must be disabled so stored auth/session data cannot be restored into a fresh install'
)

assert(
  !auth.includes('setKeychainValue(\'saved_password\'') && !auth.includes('setKeychainValue("saved_password"'),
  'Auth must not persist saved_password; first launch must require explicit password entry'
)

assert(
  !auth.includes('autoSubmitPending'),
  'Auth must not auto-submit restored credentials; first launch should stay on Sign In / Create Account'
)

assert(
  syncMobile.includes('SETTINGS_PUSH_EXCLUDE_COLUMNS'),
  'mobile sync must exclude device-local/runtime/secret settings columns like desktop sync does'
)

for (const column of ['sync_enabled', 'minimize_to_tray', 'company_logo', 'bratnet_api_key']) {
  assert(syncMobile.includes(`'${column}'`), `mobile settings push exclude list missing ${column}`)
}

assert(
  /!SETTINGS_PUSH_EXCLUDE_COLUMNS\.has\(k\)/.test(syncMobile),
  'mobile settings push must filter excluded columns before posting to Supabase'
)

console.log('mobile settings sync verification passed')
