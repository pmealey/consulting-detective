/**
 * Base path derived from where the app bundle was loaded (e.g. .../consulting-detective/assets/index-xxx.js → /consulting-detective).
 * No configuration needed: works at any path and stays correct if you move the app.
 */
function getBasePath(): string {
  // Dev server: modules are under /src/..., not /assets/; always use root.
  if (import.meta.env.DEV) return ''

  try {
    const pathname = new URL(import.meta.url).pathname
    // Only derive from URL when we're in a built bundle under /assets/
    if (!pathname.includes('/assets/')) return ''

    const segments = pathname.split('/').filter(Boolean)
    if (segments.length >= 2) {
      segments.pop() // chunk filename
      segments.pop() // "assets"
      const base = '/' + segments.join('/')
      return base || ''
    }
  } catch {
    // fallback if URL parsing fails
  }
  return ''
}

export const basename = getBasePath()
