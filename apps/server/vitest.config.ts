import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', MEDIA_DIR: join(tmpdir(), 'saudaai-test-media'), LOG_LEVEL: 'error' },
  },
})
