import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const layout = read('src/components/Layout.tsx')
const reactImport = layout.split('\n').find(line => line.startsWith("import {") && line.includes("from 'react'")) ?? ''

for (const hook of ['useEffect', 'useRef', 'useState']) {
  assert(reactImport.includes(hook), `Layout.tsx uses ${hook} but does not import it from react`)
}

assert(layout.includes("import { NavLink, useLocation } from 'react-router-dom'") || layout.includes('useLocation'), 'Layout.tsx should import useLocation from react-router-dom')

console.log('react hook import verification passed')
