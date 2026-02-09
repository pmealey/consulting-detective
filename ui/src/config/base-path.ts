/**
 * Router and API basename. Derived from the script URL so the same build works at
 * root (dev, direct CF) and under /consulting-detective/ (nginx proxy).
 */
function getBasename(): string {
  if (import.meta.env.DEV) return ''
  try {
    const pathname = new URL(import.meta.url).pathname
    if (!pathname.includes('/assets/')) return ''
    const parts = pathname.split('/').filter(Boolean)
    parts.pop() // chunk filename
    parts.pop() // "assets"
    return parts.length > 0 ? '/' + parts.join('/') : ''
  } catch {
    return ''
  }
}

export const basename = getBasename()
