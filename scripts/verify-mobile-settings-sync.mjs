import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const syncMobile = fs.readFileSync('src/lib/sync-mobile.ts', 'utf8')

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
