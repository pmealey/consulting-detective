/**
 * Base path derived from where the app bundle was loaded (e.g. .../consulting-detective/assets/index-xxx.js → /consulting-detective).
 * No configuration needed: works at any path and stays correct if you move the app.
 */
function getBasePath(): string {
  try {
    const pathname = new URL(import.meta.url).pathname
    const segments = pathname.split('/').filter(Boolean)
    // Bundle is at {base}/assets/<chunk>.js (or in dev, path may be /src/... → base '')
    if (segments.length >= 2) {
      segments.pop() // chunk filename
      segments.pop() // "assets" or "src"
      const base = '/' + segments.join('/')
      return base || ''
    }
  } catch {
    // fallback if URL parsing fails
  }
  return ''
}

export const basename = getBasePath()
