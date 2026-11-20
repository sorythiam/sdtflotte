import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // L'intégration Supabase de Vercel fournit NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  test: {
    environment: 'node',
  },
} as never);
