import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vercel from './vercel.json';

export default defineConfig({
  plugins: [react()],
  // Mêmes en-têtes de sécurité qu'en production (vercel.json), pour les tester en local.
  preview: { headers: Object.fromEntries((vercel.headers[0].headers as { key: string; value: string }[]).map((h) => [h.key, h.value])) },
  build: {
    rollupOptions: {
      output: {
        // Bibliothèques à part : elles changent rarement et restent en cache entre deux mises à jour.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
  // L'intégration Supabase de Vercel fournit NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never);
