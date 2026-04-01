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

// Handle sign-in request from popup
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg !== 'object' || msg === null) return
  const message = msg as Record<string, unknown>
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
      } catch (e) {
        console.error('rRed: sign-in error', e)
      }
    })()
  },
  { url: [{ urlPrefix: REDIRECT_URI }] },
)

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

// 1) Direct navigation: http://r/alias (works when /etc/hosts is set up)
browser.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return

    const url = new URL(details.url)
    const alias = url.pathname.replace(/^\/+/, '')

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
    ],
  },
)
