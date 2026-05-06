import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ergoflow.app',
  appName: 'Ergoflow',
  webDir: 'dist',
  // Android: Capacitor will serve the bundled React app
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Native HTTP — bypasses CORS for fetch() calls (needed for myDATA and any API without CORS headers)
    CapacitorHttp: {
      enabled: true,
    },
    // Push notifications (future phase)
    // PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
