import browser from 'webextension-polyfill'

declare const __API_URL__: string
declare const __ADMIN_APP_URL__: string

const API_URL: string = __API_URL__
const ADMIN_APP_URL: string = __ADMIN_APP_URL__

async function getJWT(): Promise<string | null> {
  const result = await browser.storage.local.get('jwt')
  return typeof result.jwt === 'string' ? result.jwt : null
}

async function getAuthCode(jwt: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) return null
    const { code } = await res.json() as { code: string }
    return code
  } catch {
    return null
  }
}

async function buildAdminUrl(jwt: string, extra?: string): Promise<string> {
  const code = await getAuthCode(jwt)
  let url = ADMIN_APP_URL
  if (code) url += `?code=${encodeURIComponent(code)}`
  if (extra) url += (code ? '&' : '?') + extra
  return url
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function resolve() {
  const params = new URLSearchParams(window.location.search)
  const alias = params.get('alias') || ''

  const jwt = await getJWT()
  if (!jwt) {
    window.location.href = ADMIN_APP_URL
    return
  }

  if (!alias || alias === 'main') {
    window.location.href = await buildAdminUrl(jwt)
    return
  }

  // Try local cache first for instant redirect
  try {
    const cache = await browser.storage.local.get('aliasMap')
    const aliasMap = cache.aliasMap as Record<string, string> | undefined
    if (aliasMap && aliasMap[alias] && isSafeUrl(aliasMap[alias])) {
      window.location.href = aliasMap[alias]
      return
    }
  } catch { /* cache miss — fall through to API */ }

  // Fall back to API
  try {
    const resp = await fetch(`${API_URL}/resolve?alias=${encodeURIComponent(alias)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })

    if (resp.ok) {
      const { targetUrl } = await resp.json() as { targetUrl: string }
      if (!isSafeUrl(targetUrl)) {
        window.location.href = await buildAdminUrl(jwt)
        return
      }
      window.location.href = targetUrl
    } else if (resp.status === 401) {
      await browser.storage.local.remove('jwt')
      window.location.href = ADMIN_APP_URL
    } else {
      window.location.href = await buildAdminUrl(jwt, `notfound=${encodeURIComponent(alias)}`)
    }
  } catch {
    window.location.href = await buildAdminUrl(jwt)
  }
}

resolve()
