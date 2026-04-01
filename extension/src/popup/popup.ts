import browser from 'webextension-polyfill'

declare const __API_URL__: string
declare const __ADMIN_APP_URL__: string

const API_URL: string = __API_URL__
const ADMIN_APP_URL: string = __ADMIN_APP_URL__

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getJWT(): Promise<string | null> {
  const result = await browser.storage.local.get('jwt')
  return typeof result.jwt === 'string' ? result.jwt : null
}

async function signIn(): Promise<void> {
  // Delegate OAuth to the background script (uses tabs API + CloudFront redirect).
  await browser.runtime.sendMessage({ action: 'startSignIn' })
  window.close()
}

async function getUser(jwt: string): Promise<{ email: string } | null> {
  try {
    const res = await fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!res.ok) return null
    return res.json() as Promise<{ email: string }>
  } catch {
    return null
  }
}

async function resolveAlias(alias: string, jwt: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/resolve?alias=${encodeURIComponent(alias)}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) return null
    const { targetUrl } = await res.json() as { targetUrl: string }
    return targetUrl
  } catch {
    return null
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function clearApp(): HTMLElement {
  const app = document.getElementById('app')!
  app.textContent = ''
  return app
}

function el(tag: string, attrs?: Record<string, string>, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v))
  if (text) e.textContent = text
  return e
}

function showError(msg: string) {
  const s = document.getElementById('status')
  if (s) s.textContent = msg
}

function renderLoggedOut(errorMsg = '') {
  const app = clearApp()
  app.appendChild(el('div', { class: 'logo' }, 'rRed'))
  if (errorMsg) app.appendChild(el('p', { class: 'status' }, errorMsg))
  const btn = el('button', { class: 'btn btn-primary', id: 'sign-in', style: 'width:100%' }, 'Sign in with Google')
  app.appendChild(btn)

  btn.addEventListener('click', async () => {
    ;(btn as HTMLButtonElement).disabled = true
    btn.textContent = 'Signing in…'
    try {
      await signIn()
      init()
    } catch (e) {
      renderLoggedOut('Sign-in failed. Try again.')
    }
  })
}

function renderLoggedIn(email: string) {
  const app = clearApp()
  app.appendChild(el('div', { class: 'logo' }, 'rRed'))
  app.appendChild(el('div', { class: 'user-email' }, email))

  const row = el('div', { class: 'form-row' })
  const input = document.createElement('input')
  input.type = 'text'
  input.id = 'alias-input'
  input.placeholder = 'alias'
  input.autocomplete = 'off'
  row.appendChild(input)
  row.appendChild(el('button', { class: 'btn btn-primary', id: 'go-btn' }, 'Go'))
  app.appendChild(row)

  app.appendChild(el('p', { class: 'status', id: 'status' }))
  app.appendChild(el('button', { class: 'btn btn-secondary', id: 'open-admin' }, 'Open r/main'))
  app.appendChild(el('button', { class: 'btn btn-link', id: 'sign-out' }, 'Sign out'))

  input.focus()

  async function handleGo() {
    const alias = input.value.trim().replace(/^r\//, '').replace(/^\//, '')
    if (!alias) return

    if (alias === 'main') {
      openAdmin()
      return
    }

    const jwt = await getJWT()
    if (!jwt) { renderLoggedOut(); return }

    const targetUrl = await resolveAlias(alias, jwt)
    if (!targetUrl) {
      showError(`No link found for "${alias}"`)
      return
    }
    browser.tabs.create({ url: targetUrl })
    window.close()
  }

  document.getElementById('go-btn')!.addEventListener('click', handleGo)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleGo() })

  document.getElementById('open-admin')!.addEventListener('click', openAdmin)

  document.getElementById('sign-out')!.addEventListener('click', async () => {
    await browser.storage.local.remove('jwt')
    renderLoggedOut()
  })
}

async function openAdmin() {
  const jwt = await getJWT()
  // Pass the token in the URL so the web app can bootstrap its localStorage.
  const url = jwt ? `${ADMIN_APP_URL}?token=${encodeURIComponent(jwt)}` : ADMIN_APP_URL
  browser.tabs.create({ url })
  window.close()
}

async function init() {
  const jwt = await getJWT()
  if (!jwt) { renderLoggedOut(); return }

  const user = await getUser(jwt)
  if (!user) {
    await browser.storage.local.remove('jwt')
    renderLoggedOut()
    return
  }

  renderLoggedIn(user.email)
}

init()
