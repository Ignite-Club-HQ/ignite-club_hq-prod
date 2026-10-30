import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const root = process.cwd();
export default defineConfig({
  envPrefix:['VITE_','IGNITE_LIVE_'], envDir:false, esbuild:{jsx:'automatic'},
  define:{'process.env.LOG_LEVEL':'undefined'},
  css:{postcss:{plugins:[tailwindcss({config:path.join(root,'tailwind.config.ts')}),autoprefixer()]}},
  resolve:{dedupe:['react','react-dom','react-router-dom','@tanstack/react-query']},
  plugins:[{
    name:'isolated-runtime-aliases', enforce:'pre',
    resolveId(source,importer) {
      if (!source.startsWith('@/') || !importer) return null;
      const secure = importer.includes('/secure/');
      let relative = source.slice(2);
      if (secure) {
        if(relative==='integrations/supabase/client') relative='integrations/supabase/liveClient';
        else if(relative==='lab/internetIdentityAuth') relative='live/internetIdentityAuth';
        else if(relative==='lab/localRuntimeMode') relative='live/localRuntimeMode';
        else if(/^lab\/(fixtureDataLayer|localActor|localCompetitionService|localEventsService|localIdentityAccess|localMediaMetadata|localMessagingService|syntheticIdentities\.mjs)$/.test(relative)) relative='live/disabledLabRuntime';
      }
      return this.resolve(path.join(root,secure?'secure/src':'email/src',relative),importer,{skipSelf:true});
    },
    configureServer(server) {
      server.middlewares.use((req,_res,next) => {
        const url = req.url || '/'; const pathname=url.split('?')[0];
        if (!pathname.includes('.') && !pathname.startsWith('/@') && !pathname.includes('/src/')) {
          req.url = (pathname==='/secure'||pathname.startsWith('/secure/')?'/secure-index.html':'/email-index.html')+(url.includes('?')?url.slice(url.indexOf('?')):'');
        }
        next();
      });
    },
  }],
  build:{outDir:'dist',target:['es2020','safari15'],rollupOptions:{input:['email-index.html','secure-index.html']}},
});