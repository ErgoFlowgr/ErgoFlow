import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const capacitorConfig = read('capacitor.config.ts')
const mainActivity = read('android/app/src/main/java/com/ergoflow/app/MainActivity.java')
const app = read('src/App.tsx')
const platform = read('src/lib/platform.ts')
const dbDriver = read('src/lib/db-driver.ts')
const packageJson = JSON.parse(read('package.json'))
const androidBuildGradle = read('android/app/build.gradle')

assert(capacitorConfig.includes('server:'), 'Capacitor config should explicitly define Android WebView server settings')
assert(capacitorConfig.includes("androidScheme: 'https'") || capacitorConfig.includes('androidScheme: "https"'), 'Android WebView should use https scheme expected by Capacitor SQLite')
assert(!mainActivity.includes('registerPlugin(CapacitorSQLitePlugin.class)'), 'SQLite plugin should not be manually registered when Capacitor generated plugin discovery is present')
assert(!mainActivity.includes('CapacitorSQLitePlugin'), 'MainActivity should not import SQLite plugin directly')
assert(platform.includes('Capacitor') && platform.includes('isNativePlatform'), 'platform detection should distinguish native Capacitor from plain web preview')
assert(dbDriver.includes('isNativeMobile') && dbDriver.includes('webDriver'), 'database driver should not treat plain web preview as Android native SQLite')
assert(app.includes('withStartupTimeout'), 'App startup should have a watchdog so native init hangs show an error instead of a black/loading screen')
assert(app.includes('[App] init stage:'), 'App startup should log init stages for Android black-screen diagnosis')
assert(androidBuildGradle.includes(`versionName "${packageJson.version}"`), 'Android versionName should match package.json version')

console.log('android-startup verification passed')
