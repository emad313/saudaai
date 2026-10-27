import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, ApiError } from '../api.ts'
import type { Me } from '../types.ts'

export const useSession = defineStore('session', () => {
  const me = ref<Me | null>(null)
  const pending = ref(0)

  async function load() {
    try {
      me.value = await api<Me>('/api/me')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) me.value = null
      else throw err
    }
    return me.value
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    me.value = null
  }

  return { me, pending, load, logout }
})
