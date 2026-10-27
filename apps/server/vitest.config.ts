import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      MEDIA_DIR: join(tmpdir(), 'saudaai-test-media'),
      LOG_LEVEL: 'error',
      META_APP_SECRET: 'test-secret',
      META_VERIFY_TOKEN: 'verify-me',
      MESSENGER_PAGE_ID: 'PAGE_ID',
      WHATSAPP_PHONE_NUMBER_ID: 'PHONE_ID',
    },
  },
})
