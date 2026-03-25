# Clima Energy CRM — Setup Guide

## First-time setup

### 1. Install dependencies
```bash
npm install --ignore-scripts
npm run rebuild
```

### 2. Supabase setup (cloud sync)
1. Create a free project at https://supabase.com
2. Go to **SQL Editor** and run: `supabase/migrations/001_initial.sql`
3. Go to **Edge Functions** and deploy `vapi-webhook`:
   ```bash
   npx supabase functions deploy vapi-webhook
   ```
4. Set Edge Function secrets:
   ```bash
   npx supabase secrets set VAPI_WEBHOOK_SECRET=your-random-32-char-secret
   ```

### 3. VAPI setup (inbound calls)
1. Create account at https://vapi.ai
2. Create a phone number and an AI assistant
3. In assistant settings → Webhook URL:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/vapi-webhook?secret=YOUR_WEBHOOK_SECRET
   ```

### 4. Run in development
```bash
# Terminal 1 — Vite dev server
npm run dev

# Terminal 2 — Electron window
npm run electron:dev
```

### 5. Build Windows installer
```bash
npm run electron:build
# Output: dist-installer/Clima Energy CRM Setup.exe
```

## First launch
1. Sign in (or click "Continue offline")
2. Complete the 3-step onboarding
3. Go to **Settings** → enter your API keys:
   - VAPI API Key
   - Claude API Key (or set Ollama URL)
   - Supabase URL + Anon Key
4. Go to **AI Assistant** → upload product PDFs
5. Go to **Settings → Overseer** → enable morning briefing, set time

## Android (future)
```bash
npm run build
npx cap sync android
npx cap open android    # opens Android Studio
```
