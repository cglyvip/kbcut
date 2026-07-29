import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    projects: [
      {
        // Node environment for main-process / service unit tests
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/components/**']
        }
      },
      {
        // jsdom environment for React component tests
        plugins: [react()],
        resolve: {
          alias: { '@': resolve('src/renderer/src') }
        },
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version)
        },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/setup-dom.ts'],
          globals: true
        }
      }
    ]
  }
})
