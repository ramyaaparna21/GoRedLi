import browser from 'webextension-polyfill'

declare const __API_URL__: string
declare const __ADMIN_APP_URL__: string
declare const __GOOGLE_CLIENT_ID__: string
declare const __GOOGLE_CLIENT_SECRET__: string

const API_URL: string = __API_URL__
const ADMIN_APP_URL: string = __ADMIN_APP_URL__
const GOOGLE_CLIENT_ID: string = __GOOGLE_CLIENT_ID__
const GOOGLE_CLIENT_SECRET: string = __GOOGLE_CLIENT_SECRET__

const REDIRECT_URI = `${ADMIN_APP_URL}/auth/callback`

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64URLEncode(bytes: Uint8Array): string {
  let str = ''
  for (const byte of bytes) str += String.fromCharCode(byte)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function generateVerifier(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return base64URLEncode(buf)
}

async function generateChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64URLEncode(new Uint8Array(hash))
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getJWT(): Promise<string | null> {
  const result = await browser.storage.local.get('jwt')
  return typeof result.jwt === 'string' ? result.jwt : null
}

// ── Links cache ──────────────────────────────────────────────────────────────

interface CachedLink {
  alias: string
  targetUrl: string
  workspaceId: string
}

async function refreshLinksCache(): Promise<void> {
  const jwt = await getJWT()
  if (!jwt) return

  try {
    // Fetch all links (paginated)
    const allLinks: CachedLink[] = []
    let offset = 0
    const limit = 100
    while (true) {
      const res = await fetch(`${API_URL}/links?offset=${offset}&limit=${limit}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (!res.ok) break
      const links = (await res.json()) as CachedLink[]
      allLinks.push(...links)
      if (links.length < limit) break
      offset += limit
    }

    // Fetch workspaces (returned in priority order)
    const wsRes = await fetch(`${API_URL}/workspaces`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    const workspaces = wsRes.ok
      ? ((await wsRes.json()) as { id: string }[])
      : []
    const wsPriority: Record<string, number> = {}
    workspaces.forEach((ws, i) => { wsPriority[ws.id] = i })

    // Build alias → targetUrl map respecting workspace priority
    const sorted = [...allLinks].sort(
      (a, b) => (wsPriority[a.workspaceId] ?? 999) - (wsPriority[b.workspaceId] ?? 999),
    )
    const aliasMap: Record<string, string> = {}
    for (const link of sorted) {
      if (!aliasMap[link.alias]) aliasMap[link.alias] = link.targetUrl
    }

    // Build visit counts for link target URLs from browser history
    const historyItems = await browser.history.search({
      text: '',
      startTime: Date.now() - 90 * 24 * 60 * 60 * 1000,
      maxResults: 10000,
    })
    const linkUrls = new Set(allLinks.map((l) => l.targetUrl))
    const visitCounts: Record<string, number> = {}
    for (const item of historyItems) {
      if (item.url && item.visitCount && linkUrls.has(item.url)) {
        visitCounts[item.url] = item.visitCount
      }
    }

    await browser.storage.local.set({
      linksCache: allLinks,
      aliasMap,
      visitCounts,
      cacheUpdatedAt: Date.now(),
    })
    console.log('rRed: cache refreshed,', allLinks.length, 'links')
  } catch (e) {
    console.error('rRed: cache refresh failed', e)
  }
}

// Periodic refresh every 5 minutes
browser.alarms.create('refreshLinksCache', { periodInMinutes: 5 })
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshLinksCache') refreshLinksCache()
})

// Initial cache on startup
refreshLinksCache()

// Handle messages from popup and other extension pages
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg !== 'object' || msg === null) return
  const message = msg as Record<string, unknown>

  if (message.action === 'openPopularUrls') {
    const popularPage = browser.runtime.getURL('popular/popular.html')
    browser.tabs.create({ url: popularPage })
    return
  }

  if (message.action === 'refreshCache') {
    refreshLinksCache()
    return
  }

  if (message.action === 'getVisitCounts') {
    // Return cached visit counts as a Promise
    return browser.storage.local.get('visitCounts').then(
      (data) => (data.visitCounts as Record<string, number>) || {},
    )
  }

  if (message.action !== 'startSignIn') return

  void (async () => {
    const verifier = generateVerifier()
    const challenge = await generateChallenge(verifier)
    const state = generateVerifier()

    // Persist auth state — survives event page suspension
    await browser.storage.local.set({
      pendingAuth: { verifier, state, timestamp: Date.now() },
    })

    const authURL =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
      })

    await browser.tabs.create({ url: authURL })
  })()
})

// Use webNavigation.onCompleted with URL filter — this reliably wakes
// Firefox MV3 event pages because the filter is declarative.
browser.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return

    const url = details.url
    console.log('rRed: callback detected', url)

    const params = new URL(url).searchParams
    const state = params.get('state')
    const code = params.get('code')
    if (!state || !code) {
      console.error('rRed: missing state or code in callback URL')
      return
    }

    const tabId = details.tabId

    void (async () => {
      try {
        // Read persisted auth state
        const stored = await browser.storage.local.get('pendingAuth')
        const pending = stored.pendingAuth as
          | { verifier: string; state: string; timestamp: number }
          | undefined
        if (!pending) {
          console.error('rRed: no pending auth state found in storage')
          return
        }

        if (pending.state !== state) {
          console.error('rRed: state mismatch', { expected: pending.state, got: state })
          return
        }

        // Expire after 5 minutes
        if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
          console.error('rRed: auth state expired')
          await browser.storage.local.remove('pendingAuth')
          return
        }

        await browser.storage.local.remove('pendingAuth')

        // Close the callback tab
        browser.tabs.remove(tabId)

        console.log('rRed: exchanging code for tokens...')
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
            code_verifier: pending.verifier,
          }),
        })
        if (!tokenRes.ok) {
          const errBody = await tokenRes.text()
          console.error('rRed: token exchange failed', tokenRes.status, errBody)
          return
        }
        const tokenData = await tokenRes.json() as { id_token: string }
        console.log('rRed: got id_token, verifying with backend...')

        const verifyRes = await fetch(`${API_URL}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: tokenData.id_token }),
        })
        if (!verifyRes.ok) {
          const errBody = await verifyRes.text()
          console.error('rRed: backend verify failed', verifyRes.status, errBody)
          return
        }
        const { token } = await verifyRes.json() as { token: string }

        await browser.storage.local.set({ jwt: token })
        console.log('rRed: sign-in complete, JWT stored')

        // Populate the local cache immediately so r/alias redirects are instant
        refreshLinksCache()
      } catch (e) {
        console.error('rRed: sign-in error', e)
      }
    })()
  },
  { url: [{ urlPrefix: REDIRECT_URI }] },
)

// Handle requests from externally connectable web pages (admin app)
browser.runtime.onMessageExternal.addListener((msg: unknown) => {
  if (typeof msg !== 'object' || msg === null) return
  const message = msg as Record<string, unknown>

  if (message.action === 'openPopularUrls') {
    const popularPage = browser.runtime.getURL('popular/popular.html')
    browser.tabs.create({ url: popularPage })
  }
})

// ── r/ link interception ──────────────────────────────────────────────────────

// Immediately redirect to the extension's own redirect page so the user never
// sees Chrome's "This site can't be reached" error while the API resolves.
const REDIRECT_PAGE = browser.runtime.getURL('redirect/redirect.html')

// Extract r/alias from a search engine query URL. Returns the alias or null.
function extractRAlias(url: string): string | null {
  try {
    const u = new URL(url)
    // Google, Bing, Yahoo, DuckDuckGo, Ecosia, Brave, Startpage all use "q" param
    const q = u.searchParams.get('q') ?? u.searchParams.get('query') ?? ''
    const match = q.match(/^r\/(.+)$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// Extension page for Popular URLs
const POPULAR_PAGE = browser.runtime.getURL('popular/popular.html')

// 1) Direct navigation: http://r/alias (works when /etc/hosts is set up)
browser.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return

    const url = new URL(details.url)
    const alias = url.pathname.replace(/^\/+/, '')

    // Intercept special alias for Popular URLs page
    if (alias === 'popular-urls') {
      browser.tabs.update(details.tabId, { url: POPULAR_PAGE })
      return
    }

    browser.tabs.update(details.tabId, {
      url: `${REDIRECT_PAGE}?alias=${encodeURIComponent(alias)}`,
    })
  },
  { url: [{ schemes: ['http'], hostEquals: 'r' }] },
)

// 2) Search engine fallback: when Chrome treats r/alias as a search query,
//    intercept the search navigation and redirect before the search page loads.
browser.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return

    const alias = extractRAlias(details.url)
    if (!alias) return

    // Intercept special alias for Popular URLs page
    if (alias === 'popular-urls') {
      browser.tabs.update(details.tabId, { url: POPULAR_PAGE })
      return
    }

    browser.tabs.update(details.tabId, {
      url: `${REDIRECT_PAGE}?alias=${encodeURIComponent(alias)}`,
    })
  },
  {
    url: [
      { hostSuffix: '.google.com', pathPrefix: '/search' },
      { hostSuffix: '.bing.com', pathPrefix: '/search' },
      { hostEquals: 'search.yahoo.com' },
      { hostEquals: 'duckduckgo.com' },
      { hostEquals: 'www.ecosia.org', pathPrefix: '/search' },
      { hostEquals: 'search.brave.com', pathPrefix: '/search' },
      { hostEquals: 'www.startpage.com', pathPrefix: '/search' },
      { hostEquals: 'www.perplexity.ai', pathPrefix: '/search' },
    ],
  },
)
