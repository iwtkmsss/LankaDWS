import type { ChatMessageView, ChatThreadPreview } from '@lankadws/contracts'
import { useEffect, useSyncExternalStore } from 'react'

const preferencePrefix = 'lankadws.message-sound.'
const changedEvent = 'lankadws:message-sound-changed'
const uniqueId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const tabId = uniqueId()
const readingThreads = new Map<string, number>()
const storageFallback = new Map<string, string>()
let audio: AudioContext | undefined
let localLastSound = 0

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return storageFallback.get(key) ?? null }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { storageFallback.set(key, value) }
}

export function messageSoundEnabled(userId: string) {
  return read(preferencePrefix + userId) !== 'false'
}

async function unlockAudio() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') await audio.resume()
  } catch { /* Unsupported or blocked audio must not interrupt messaging. */ }
}

function playTone(): boolean {
  if (!audio || audio.state !== 'running') return false
  try {
    const start = audio.currentTime
    for (const [frequency, delay] of [[660, 0], [880, 0.12]]) {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, start + delay)
      gain.gain.linearRampToValueAtTime(0.12, start + delay + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, start + delay + 0.16)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      oscillator.start(start + delay)
      oscillator.stop(start + delay + 0.18)
    }
    return true
  } catch { return false }
}

export async function previewMessageSound() {
  await unlockAudio()
  return playTone()
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener)
  window.addEventListener(changedEvent, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(changedEvent, listener)
  }
}

export function useMessageSoundPreference(userId: string) {
  const enabled = useSyncExternalStore(subscribe, () => messageSoundEnabled(userId))
  const setEnabled = (value: boolean) => {
    write(preferencePrefix + userId, String(value))
    window.dispatchEvent(new Event(changedEvent))
    if (value) void unlockAudio()
  }
  return [enabled, setEnabled] as const
}

export function useReadingMessageThread(userId: string | undefined, threadId: string | undefined) {
  useEffect(() => {
    if (!userId || !threadId) return
    const registryKey = `${userId}:${threadId}`
    const storageKey = `${preferencePrefix}reading.${userId}.${tabId}.${threadId}`
    readingThreads.set(registryKey, (readingThreads.get(registryKey) ?? 0) + 1)
    const update = () => write(storageKey, String(
      document.visibilityState === 'visible' && document.hasFocus() ? Date.now() : 0,
    ))
    update()
    const timer = window.setInterval(update, 10_000)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
      const count = (readingThreads.get(registryKey) ?? 1) - 1
      if (count) readingThreads.set(registryKey, count)
      else {
        readingThreads.delete(registryKey)
        storageFallback.delete(storageKey)
        try { localStorage.removeItem(storageKey) } catch { /* Storage is optional. */ }
      }
    }
  }, [userId, threadId])
}

function isReading(userId: string, threadId: string) {
  if (document.visibilityState === 'visible' && document.hasFocus()
    && readingThreads.has(`${userId}:${threadId}`)) return true
  try {
    const prefix = `${preferencePrefix}reading.${userId}.`
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix) && key.endsWith(`.${threadId}`)
        && Number(read(key)) > Date.now() - 20_000) return true
    }
  } catch { /* Fall back to this tab's reading state. */ }
  return false
}

export function useMessageSoundActivation(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return
    const activate = () => {
      if (messageSoundEnabled(userId)) void unlockAudio()
    }
    document.addEventListener('pointerdown', activate)
    document.addEventListener('keydown', activate)
    return () => {
      document.removeEventListener('pointerdown', activate)
      document.removeEventListener('keydown', activate)
    }
  }, [userId])
}

export async function notifyMessageSound(
  userId: string,
  threadId: string,
  message: ChatMessageView,
  preview: ChatThreadPreview,
) {
  if (message.authorId === userId || message.deletedAt
    || preview.item.notificationMode === 'NONE') return
  const play = () => {
    if (!messageSoundEnabled(userId) || isReading(userId, threadId)) return
    const key = `${preferencePrefix}last.${userId}`
    const now = Date.now()
    // One shared cooldown also prevents a burst of messages from ringing repeatedly.
    if (now - Math.max(Number(read(key)) || 0, localLastSound) < 2_000) return
    if (!playTone()) return
    localLastSound = now
    write(key, String(now))
  }
  try {
    if (navigator.locks) await navigator.locks.request(`${preferencePrefix}play.${userId}`, play)
    else {
      // Older/insecure browser contexts lack Web Locks. Elect a tab before playing.
      const claimKey = `${preferencePrefix}claim.${userId}`
      const claim = `${tabId}:${uniqueId()}`
      write(claimKey, claim)
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      if (read(claimKey) === claim) play()
    }
  } catch { /* A closed tab or denied lock must not interrupt messaging. */ }
}
