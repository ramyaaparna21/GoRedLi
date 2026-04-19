import browser from 'webextension-polyfill'

declare const __API_URL__: string
declare const __ADMIN_APP_URL__: string
const API_URL: string = __API_URL__
const ADMIN_APP_URL: string = __ADMIN_APP_URL__

interface HistoryEntry {
  url: string
  title: string
  visitCount: number
}

interface WorkspaceInfo { id: string; name: string }

async function getJWT(): Promise<string | null> {
  const result = await browser.storage.local.get('jwt')
  return typeof result.jwt === 'string' ? result.jwt : null
}

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

async function getAllLinks(jwt: string): Promise<Set<string>> {
  const urls = new Set<string>()
  let offset = 0
  const limit = 100
  while (true) {
    try {
      const res = await fetch(`${API_URL}/links?offset=${offset}&limit=${limit}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (!res.ok) break
      const links = await res.json() as { targetUrl: string }[]
      if (links.length === 0) break
      for (const l of links) urls.add(l.targetUrl)
      if (links.length < limit) break
      offset += limit
    } catch {
      break
    }
  }
  return urls
}

async function getHistory(days: number): Promise<HistoryEntry[]> {
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000
  const items = await browser.history.search({
    text: '',
    startTime,
    maxResults: 5000,
  })

  const entries: HistoryEntry[] = []
  for (const item of items) {
    if (!item.url || !item.visitCount) continue
    // Filter out extension pages, chrome internals, empty pages
    if (item.url.startsWith('chrome://') ||
        item.url.startsWith('chrome-extension://') ||
        item.url.startsWith('moz-extension://') ||
        item.url.startsWith('about:') ||
        item.url.startsWith('edge://') ||
        item.url.startsWith('data:')) continue
    entries.push({
      url: item.url,
      title: item.title || item.url,
      visitCount: item.visitCount,
    })
  }

  entries.sort((a, b) => b.visitCount - a.visitCount)
  return entries
}

async function createLink(
  jwt: string, wsId: string,
  data: { alias: string; targetUrl: string; title: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/workspaces/${wsId}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(data),
    })
    if (res.ok) return { ok: true }
    const err = await res.json().catch(() => ({ error: res.statusText }))
    return { ok: false, error: (err as { error?: string }).error || res.statusText }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

async function init() {
  const app = document.getElementById('app')!
  const jwtOrNull = await getJWT()
  if (!jwtOrNull) {
    app.innerHTML = '<p class="empty">Please sign in via the rRed extension first.</p>'
    return
  }
  const jwt: string = jwtOrNull

  const [workspaces, existingUrls] = await Promise.all([
    getWorkspaces(jwt),
    getAllLinks(jwt),
  ])

  if (workspaces.length === 0) {
    app.innerHTML = '<p class="empty">No workspaces found. Create one first.</p>'
    return
  }

  let days = 30
  let entries: HistoryEntry[] = []

  // Build controls once — they persist across data reloads
  const controls = document.createElement('div')
  controls.className = 'controls'

  const label = document.createElement('label')
  label.textContent = 'Show history from last'
  controls.appendChild(label)

  const daysInput = document.createElement('input')
  daysInput.type = 'number'
  daysInput.min = '1'
  daysInput.max = '365'
  daysInput.value = String(days)
  controls.appendChild(daysInput)

  const labelDays = document.createElement('label')
  labelDays.textContent = 'days'
  controls.appendChild(labelDays)

  // Workspace selector
  const wsLabel = document.createElement('label')
  wsLabel.textContent = 'Save to:'
  wsLabel.style.marginLeft = '16px'
  controls.appendChild(wsLabel)

  const wsSelect = document.createElement('select')
  wsSelect.className = 'ws-select'
  for (const ws of workspaces) {
    const opt = document.createElement('option')
    opt.value = ws.id
    opt.textContent = ws.name
    wsSelect.appendChild(opt)
  }
  controls.appendChild(wsSelect)

  app.innerHTML = ''
  app.appendChild(controls)

  // Content container — only this part is rebuilt on data changes
  const content = document.createElement('div')
  content.id = 'content'
  app.appendChild(content)

  let debounce: ReturnType<typeof setTimeout>
  daysInput.addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      const val = parseInt(daysInput.value, 10)
      if (val > 0 && val <= 365) {
        days = val
        loadHistory()
      }
    }, 500)
  })

  async function loadHistory() {
    content.innerHTML = '<p class="loading">Loading browser history...</p>'
    const history = await getHistory(days)
    entries = history.filter((e) => !existingUrls.has(e.url))
    renderTable()
  }

  function renderTable() {
    content.innerHTML = ''

    if (entries.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = 'All your frequently visited URLs already have aliases!'
      content.appendChild(empty)
      return
    }

    const wrap = document.createElement('div')
    wrap.className = 'table-wrap'

    const table = document.createElement('table')

    // Fixed column widths via colgroup
    const colgroup = document.createElement('colgroup')
    colgroup.innerHTML = `
      <col class="col-url">
      <col class="col-title">
      <col class="col-visits">
      <col class="col-action">`
    table.appendChild(colgroup)

    const thead = document.createElement('thead')
    thead.innerHTML = `<tr>
      <th>URL</th>
      <th>Title</th>
      <th>Visits</th>
      <th>Add redirect</th>
    </tr>`
    table.appendChild(thead)

    const tbody = document.createElement('tbody')

    for (const entry of entries) {
      const tr = document.createElement('tr')

      const tdUrl = document.createElement('td')
      tdUrl.className = 'url-cell'
      const a = document.createElement('a')
      a.href = entry.url
      a.target = '_blank'
      a.rel = 'noreferrer'
      a.textContent = entry.url
      a.title = entry.url
      tdUrl.appendChild(a)
      tr.appendChild(tdUrl)

      const tdTitle = document.createElement('td')
      tdTitle.className = 'title-cell'
      tdTitle.textContent = entry.title
      tdTitle.title = entry.title
      tr.appendChild(tdTitle)

      const tdVisits = document.createElement('td')
      tdVisits.className = 'visit-count'
      tdVisits.textContent = String(entry.visitCount)
      tr.appendChild(tdVisits)

      // Combined alias input + add button in one cell
      const tdAction = document.createElement('td')
      const actionWrap = document.createElement('div')
      actionWrap.className = 'action-cell'

      const aliasInput = document.createElement('input')
      aliasInput.type = 'text'
      aliasInput.className = 'alias-input'
      aliasInput.placeholder = 'r/alias'
      aliasInput.autocomplete = 'off'

      const addBtn = document.createElement('button')
      addBtn.className = 'btn btn-primary'
      addBtn.textContent = 'Add'

      const statusSpan = document.createElement('span')
      statusSpan.className = 'status-msg'

      actionWrap.appendChild(aliasInput)
      actionWrap.appendChild(addBtn)
      actionWrap.appendChild(statusSpan)
      tdAction.appendChild(actionWrap)
      tr.appendChild(tdAction)

      async function handleAdd() {
        const alias = aliasInput.value.trim().replace(/^r\//, '').replace(/^\//, '')
        if (!alias) {
          statusSpan.textContent = 'Enter an alias'
          statusSpan.className = 'status-msg status-error'
          return
        }

        addBtn.disabled = true
        addBtn.textContent = 'Saving...'
        statusSpan.textContent = ''

        const wsId = wsSelect.value
        const result = await createLink(jwt, wsId, {
          alias,
          targetUrl: entry.url,
          title: entry.title,
        })

        if (result.ok) {
          existingUrls.add(entry.url)
          // Refresh the local cache so the new link is available immediately
          browser.runtime.sendMessage({ action: 'refreshCache' })
          tr.classList.add('row-fade-out')
          tr.addEventListener('animationend', () => {
            tr.remove()
            entries = entries.filter((e) => e.url !== entry.url)
            if (entries.length === 0) {
              const empty = document.createElement('p')
              empty.className = 'empty'
              empty.textContent = 'All your frequently visited URLs already have aliases!'
              wrap.replaceWith(empty)
            }
          })
        } else {
          addBtn.disabled = false
          addBtn.textContent = 'Add'
          statusSpan.textContent = result.error || 'Failed'
          statusSpan.className = 'status-msg status-error'
        }
      }

      addBtn.addEventListener('click', handleAdd)
      aliasInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdd()
      })

      tbody.appendChild(tr)
    }

    table.appendChild(tbody)
    wrap.appendChild(table)
    content.appendChild(wrap)
  }

  await loadHistory()

  // Logo click → open admin page
  document.getElementById('logo-link')?.addEventListener('click', async (e) => {
    e.preventDefault()
    const jwt = await getJWT()
    if (!jwt) { window.location.href = ADMIN_APP_URL; return }
    try {
      const res = await fetch(`${API_URL}/auth/code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (res.ok) {
        const { code } = await res.json() as { code: string }
        window.location.href = `${ADMIN_APP_URL}?code=${encodeURIComponent(code)}`
      } else {
        window.location.href = ADMIN_APP_URL
      }
    } catch {
      window.location.href = ADMIN_APP_URL
    }
  })
}

init()
