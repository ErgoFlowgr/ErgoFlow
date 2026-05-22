import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const main = read('electron/main.ts')
const sync = read('electron/sync.ts')
const customers = read('src/pages/Customers/Customers.tsx')
const migration = read('supabase/migrations/022_settings_runtime_columns.sql')

assert(main.includes('let isInstallingUpdate = false'), 'updater should track explicit install/quit state')
assert(main.includes("autoUpdater.autoInstallOnAppQuit = false"), 'updater should not auto-install on ordinary app quit')
assert(main.includes("app.on('before-quit'"), 'app should mark quit state before close handlers run')
assert(main.includes('destroyTray()'), 'update install should destroy tray before quitAndInstall')
assert(!main.includes('BrowserWindow.getAllWindows().forEach(w => w.destroy())'), 'update install should not destroy windows before quitAndInstall')
assert(main.includes('autoUpdater.quitAndInstall(false, true)'), 'explicit install should still call quitAndInstall')

assert(main.includes("https://fonts.googleapis.com") && main.includes("https://fonts.gstatic.com"), 'production CSP should allow configured Google font URLs')

assert(sync.includes('SETTINGS_PUSH_EXCLUDE_COLUMNS'), 'sync should centralize settings columns excluded from cloud push')
assert(sync.includes("'company_logo'") && sync.includes("'minimize_to_tray'"), 'sync should not push device/local settings columns')
assert(sync.includes("'bratnet_api_key'"), 'sync should not push e-invoicing secret fields')
assert(sync.includes('column missing'), 'sync should log PGRST204 as a schema problem with context')

for (const col of ['bratnet_username', 'ai_trial_start', 'ai_trial_used']) {
  assert(migration.includes(col), `settings runtime migration should include ${col}`)
}
assert(!migration.includes('ADD COLUMN IF NOT EXISTS company_logo'), 'cloud migration should not add local-only company_logo')
assert(!migration.includes('ADD COLUMN IF NOT EXISTS bratnet_api_key'), 'cloud migration should not add secret bratnet_api_key')

assert(!customers.includes('Î'), 'Customers page should not contain mojibake Greek text')
assert(!customers.includes('Â·'), 'Customers page should not contain mojibake middle-dot separator')
assert(!customers.includes('â€”'), 'Customers page should not contain mojibake em dash')
assert(customers.includes('Έχετε αποθηκεύσει τις αλλαγές;'), 'Customers unsaved-change prompt should be readable Greek')
assert(customers.includes("join(' · ')") && customers.includes("|| '—'"), 'Customer list separators should render cleanly')

console.log('release-fixes verification passed')
