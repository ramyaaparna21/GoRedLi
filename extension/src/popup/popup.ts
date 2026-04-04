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

// ── API helpers ──────────────────────────────────────────────────────────────

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

interface WorkspaceInfo { id: string; name: string }

async function getWorkspaces(jwt: string): Promise<WorkspaceInfo[]> {
  try {
    const res = await fetch(`${API_URL}/workspaces`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    if (!res.ok) return []
    return res.json() as Promise<WorkspaceInfo[]>
  } catch {
    return []
  }
}

async function createLink(
  jwt: string,
  wsId: string,
  data: { alias: string; targetUrl: string; title: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/workspaces/${wsId}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(data),
    })
    if (res.ok) return { ok: true }
    const err = await res.json().catch(() => ({ error: res.statusText }))
    return { ok: false, error: (err as { error?: string }).error || res.statusText }
  } catch {
    return { ok: false, error: 'Network error' }
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

function showStatus(msg: string, type: 'error' | 'success' = 'error') {
  const s = document.getElementById('status')
  if (s) {
    s.textContent = msg
    s.className = type === 'success' ? 'status status-success' : 'status'
  }
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
    } catch {
      renderLoggedOut('Sign-in failed. Try again.')
    }
  })
}

async function renderLoggedIn(email: string) {
  const app = clearApp()
  app.appendChild(el('div', { class: 'logo' }, 'rRed'))
  app.appendChild(el('div', { class: 'user-email' }, email))

  const jwtOrNull = await getJWT()
  if (!jwtOrNull) { renderLoggedOut(); return }
  const jwt: string = jwtOrNull

  // Fetch current tab and workspaces in parallel
  const [tabs, workspaces] = await Promise.all([
    browser.tabs.query({ active: true, currentWindow: true }),
    getWorkspaces(jwt),
  ])

  const currentTab = tabs[0]
  const currentUrl = currentTab?.url || ''
  const currentTitle = currentTab?.title || ''
  const isSaveable = currentUrl && !currentUrl.startsWith('chrome://') && !currentUrl.startsWith('chrome-extension://')

  // ── Save current page section ──
  if (isSaveable) {
    const urlDisplay = el('div', { class: 'page-url' }, currentUrl)
    urlDisplay.title = currentUrl
    app.appendChild(urlDisplay)
  }

  // Workspace selector
  let selectedWsId = workspaces[0]?.id ?? ''
  if (workspaces.length > 0) {
    const wsSelect = document.createElement('select')
    wsSelect.className = 'ws-select'
    for (const ws of workspaces) {
      const opt = document.createElement('option')
      opt.value = ws.id
      opt.textContent = ws.name
      wsSelect.appendChild(opt)
    }
    wsSelect.addEventListener('change', () => { selectedWsId = wsSelect.value })
    app.appendChild(wsSelect)
  }

  // Alias input row with r/ prefix
  const inputRow = el('div', { class: 'input-row' })
  const prefix = el('span', { class: 'input-prefix' }, 'r/')
  const aliasInput = document.createElement('input')
  aliasInput.type = 'text'
  aliasInput.id = 'alias-input'
  aliasInput.placeholder = 'alias'
  aliasInput.autocomplete = 'off'
  inputRow.appendChild(prefix)
  inputRow.appendChild(aliasInput)
  app.appendChild(inputRow)

  // Button row: Save (primary) + Go (secondary)
  const btnRow = el('div', { class: 'btn-row' })
  const saveBtn = el('button', { class: 'btn btn-primary', id: 'save-btn' }, 'Save page')
  const goBtn = el('button', { class: 'btn btn-ghost', id: 'go-btn' }, 'Go')
  btnRow.appendChild(saveBtn)
  btnRow.appendChild(goBtn)
  app.appendChild(btnRow)

  // Status area
  app.appendChild(el('p', { class: 'status', id: 'status' }))

  // Open r/main
  app.appendChild(el('button', { class: 'btn btn-secondary', id: 'open-admin' }, 'Open r/main'))

  // Sign out
  app.appendChild(el('button', { class: 'btn btn-link', id: 'sign-out' }, 'Sign out'))

  aliasInput.focus()

  // ── Save handler ──
  async function handleSave() {
    const alias = aliasInput.value.trim().replace(/^r\//, '').replace(/^\//, '')
    if (!alias) { showStatus('Enter an alias'); return }
    if (!isSaveable) { showStatus('Cannot save this page'); return }
    if (!selectedWsId) { showStatus('Create a workspace first in r/main'); return }

    ;(saveBtn as HTMLButtonElement).disabled = true
    saveBtn.textContent = 'Saving…'
    showStatus('')

    const result = await createLink(jwt, selectedWsId, {
      alias,
      targetUrl: currentUrl,
      title: currentTitle,
    })

    ;(saveBtn as HTMLButtonElement).disabled = false
    saveBtn.textContent = 'Save page'

    if (result.ok) {
      showStatus(`Saved r/${alias}`, 'success')
      aliasInput.value = ''
    } else {
      showStatus(result.error || 'Failed to save')
    }
  }

  // ── Go handler ──
  async function handleGo() {
    const alias = aliasInput.value.trim().replace(/^r\//, '').replace(/^\//, '')
    if (!alias) return

    if (alias === 'main') { openAdmin(); return }

    ;(goBtn as HTMLButtonElement).disabled = true
    goBtn.textContent = '…'

    const targetUrl = await resolveAlias(alias, jwt)

    ;(goBtn as HTMLButtonElement).disabled = false
    goBtn.textContent = 'Go'

    if (!targetUrl) { showStatus(`No link found for "${alias}"`); return }
    browser.tabs.create({ url: targetUrl })
    window.close()
  }

  saveBtn.addEventListener('click', handleSave)
  goBtn.addEventListener('click', handleGo)
  aliasInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSave()
  })

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

  await renderLoggedIn(user.email)
}

init()
