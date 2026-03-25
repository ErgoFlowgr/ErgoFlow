/**
 * Dev launcher: finds a free port, starts Vite, waits for it, then starts Electron.
 * Avoids hardcoded port conflicts when running from Claude Code or other tools.
 */
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

function findFreePort(start = 5173) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(start, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
    s.on('error', () => resolve(findFreePort(start + 1)))
  })
}

function waitForPort(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const try_ = () => {
      const s = net.createConnection(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('Vite did not start in time'))
        setTimeout(try_, 300)
      })
    }
    try_()
  })
}

async function main() {
  const port = await findFreePort(5173)
  console.log(`[dev] Using port ${port}`)

  // Start Vite
  const vite = spawn('npx', ['vite', '--port', port, '--strictPort'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
  })
  vite.on('exit', (code) => { if (code !== 0) process.exit(code ?? 1) })

  // Wait for Vite to be ready
  console.log(`[dev] Waiting for Vite on port ${port}...`)
  await waitForPort(port)
  console.log(`[dev] Vite ready — starting Electron`)

  // Start Electron
  const electronPath = require('electron')
  const env = { ...process.env, VITE_DEV_PORT: String(port), NODE_ENV: 'development' }
  delete env.ELECTRON_RUN_AS_NODE

  const electron = spawn(electronPath, ['.'], { stdio: 'inherit', env })
  electron.on('exit', (code) => process.exit(code ?? 0))
}

main().catch((e) => { console.error(e); process.exit(1) })
