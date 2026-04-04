import browser from 'webextension-polyfill'

declare const __API_URL__: string
declare const __ADMIN_APP_URL__: string

const API_URL: string = __API_URL__
const ADMIN_APP_URL: string = __ADMIN_APP_URL__

async function getJWT(): Promise<string | null> {
  const result = await browser.storage.local.get('jwt')
  return typeof result.jwt === 'string' ? result.jwt : null
}

async function resolve() {
  const params = new URLSearchParams(window.location.search)
  const alias = params.get('alias') || ''

  const jwt = await getJWT()
  if (!jwt) {
    window.location.href = ADMIN_APP_URL
    return
  }

  const adminUrl = `${ADMIN_APP_URL}?token=${encodeURIComponent(jwt)}`

  if (!alias || alias === 'main') {
    window.location.href = adminUrl
    return
  }

  try {
    const resp = await fetch(`${API_URL}/resolve?alias=${encodeURIComponent(alias)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })

    if (resp.ok) {
      const { targetUrl } = await resp.json() as { targetUrl: string }
      window.location.href = targetUrl
    } else if (resp.status === 401) {
      await browser.storage.local.remove('jwt')
      window.location.href = ADMIN_APP_URL
    } else {
      window.location.href = `${adminUrl}&notfound=${encodeURIComponent(alias)}`
    }
  } catch {
    window.location.href = adminUrl
  }
}

resolve()
