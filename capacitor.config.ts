import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.climaenergy.crm',
  appName: 'Clima Energy CRM',
  webDir: 'dist',
  // Android: Capacitor will serve the bundled React app
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    // Push notifications (future phase)
    // PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
