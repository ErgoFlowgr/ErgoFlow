import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './i18n/i18n'
import './index.css'

// On Android WebView, the soft keyboard uses IME composition mode for autocorrect /
// predictive text. When React re-renders a controlled input mid-composition, it resets
// the DOM value, which cancels the pending character and the letter disappears.
// Setting autocorrect=off on focus tells the keyboard to commit each keystroke
// immediately (no composition buffer), so React and the IME never fight over the value.
// We skip inputs that explicitly opt in to autocorrect (e.g. the Chat textarea).
document.addEventListener('focusin', e => {
  const el = e.target as HTMLElement
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return
  if (el.getAttribute('autocorrect')) return  // already explicitly set
  el.setAttribute('autocorrect', 'off')
  el.setAttribute('autocomplete', 'off')
  el.setAttribute('spellcheck', 'false')
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
