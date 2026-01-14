import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.igniteteamhub',
  appName: 'ignite-team-hub',
  webDir: 'dist',
  server: {
    url: 'https://0ae01178-1280-45c0-83ac-d7ab1bb64b2e.lovableproject.com?forceHideBadge=true',
    cleartext: true
  }
};

export default config;
