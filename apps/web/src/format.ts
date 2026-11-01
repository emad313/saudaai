import { formatMoney } from '@saudaai/shared'
import { useSession } from './stores/session.ts'

const dhaka = 'Asia/Dhaka'

export const time = (at: number) =>
  new Date(at).toLocaleTimeString('en-GB', { timeZone: dhaka, hour: '2-digit', minute: '2-digit' })

export const day = (at: number) =>
  new Date(at).toLocaleDateString('en-GB', { timeZone: dhaka, day: 'numeric', month: 'short' })

export function when(at: number) {
  const today = new Date().toLocaleDateString('en-GB', { timeZone: dhaka })
  return new Date(at).toLocaleDateString('en-GB', { timeZone: dhaka }) === today
    ? time(at)
    : `${day(at)}, ${time(at)}`
}

export const bnDate = (at: number) =>
  new Date(at).toLocaleDateString('bn-BD', {
    timeZone: dhaka,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

export const channelName: Record<string, string> = {
  messenger: 'Messenger',
  whatsapp: 'WhatsApp',
  webchat: 'Web chat',
  instagram: 'Instagram',
}

export const methodName: Record<string, string> = {
  cod: 'Cash on delivery',
  bkash: 'bKash',
  nagad: 'Nagad',
}

// Money in the logged-in shop's currency (the connected store's).
export const money = (minor: number) => formatMoney(minor, useSession().me?.currency ?? 'BDT')

export const currencySymbol = () =>
  formatMoney(0, useSession().me?.currency ?? 'BDT').replace(/[\d.,\s]/g, '')

export const compactMoney = (minor: number) => {
  const whole = minor / 100
  return `${currencySymbol()}${whole >= 1000 ? `${+(whole / 1000).toFixed(1)}k` : whole}`
}
