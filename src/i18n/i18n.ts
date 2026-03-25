import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import el from './el.json'
import en from './en.json'

i18n.use(initReactI18next).init({
  resources: { el: { translation: el }, en: { translation: en } },
  lng: localStorage.getItem('language') || 'el',
  fallbackLng: 'el',
  interpolation: { escapeValue: false },
})

export default i18n
