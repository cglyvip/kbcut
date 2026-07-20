/** Shared permanent settings persistence (disk via main process). */

type SaveTimer = ReturnType<typeof setTimeout> | null

let hydratePromise: Promise<any | null> | null = null
let saveTimer: SaveTimer = null
let pendingPartial: any = null

export async function loadPermanentSettings(): Promise<any | null> {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      if (typeof window === 'undefined' || typeof window.api?.loadAppSettings !== 'function') {
        return null
      }
      return await window.api.loadAppSettings()
    } catch (err) {
      console.error('[settings] loadPermanentSettings failed:', err)
      return null
    }
  })()
  return hydratePromise
}

export function savePermanentSettings(partial: any): void {
  // merge pending patches then debounce write
  pendingPartial = deepMerge(pendingPartial || {}, partial || {})
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const payload = pendingPartial
    pendingPartial = null
    saveTimer = null
    void flushSave(payload)
  }, 120)
}

export async function savePermanentSettingsNow(partial: any): Promise<boolean> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const payload = deepMerge(pendingPartial || {}, partial || {})
  pendingPartial = null
  return flushSave(payload)
}

async function flushSave(partial: any): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || typeof window.api?.saveAppSettings !== 'function') {
      return false
    }
    const res = await window.api.saveAppSettings(partial)
    if (!res?.ok) {
      console.error('[settings] savePermanentSettings failed:', res?.error)
      return false
    }
    return true
  } catch (err) {
    console.error('[settings] savePermanentSettings error:', err)
    return false
  }
}

function deepMerge(a: any, b: any): any {
  if (!a) return b
  if (!b) return a
  const out: any = { ...a }
  for (const key of Object.keys(b)) {
    const bv = b[key]
    const av = a[key]
    if (
      bv && typeof bv === 'object' && !Array.isArray(bv) &&
      av && typeof av === 'object' && !Array.isArray(av)
    ) {
      out[key] = deepMerge(av, bv)
    } else {
      out[key] = bv
    }
  }
  return out
}
