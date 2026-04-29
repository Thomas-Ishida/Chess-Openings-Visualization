import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Chess-Openings-Visualization/',
  plugins: [react()],
})
