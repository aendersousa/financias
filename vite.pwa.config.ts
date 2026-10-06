import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: 'src/renderer',
  envDir: __dirname,
  base: '/financias/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    {
      name: 'local-supabase-development-policy',
      apply: 'serve',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return html.replace("connect-src 'self' https://*.supabase.co wss://*.supabase.co", "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321 ws://127.0.0.1:54321")
        }
      }
    },
    react(),
    tailwindcss(),
    {
      name: 'app-version-meta',
      transformIndexHtml(html) {
        return html.replace('</head>', `<meta name="app-version" content="${pkg.version}"></head>`)
      }
    },
    VitePWA({
      strategies: 'injectManifest',
      srcDir: '.',
      filename: 'sw.js',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: { rollupFormat: 'iife' },
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'brand/wallet-mark.png'],
      manifest: {
        name: 'WalletUp',
        short_name: 'WalletUp',
        lang: 'pt-BR',
        description: 'Gestão financeira pessoal',
        theme_color: '#0b1116',
        background_color: '#0b1116',
        display: 'standalone',
        start_url: '/financias/',
        scope: '/financias/',
        shortcuts: [{ name:'Novo gasto',short_name:'Novo gasto',url:'/financias/?quick=expense',icons:[{ src:'icon-192.png',sizes:'192x192',type:'image/png' }] }],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  build: {
    outDir: '../../out/pwa',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html')
    }
  }
})
