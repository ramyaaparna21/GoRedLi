import browser from 'webextension-polyfill'

// Content script injected into the admin page.
// Bridges visit count data from the extension to the web app via localStorage + CustomEvent.

async function syncVisitCounts() {
  try {
    const counts = await browser.runtime.sendMessage({ action: 'getVisitCounts' }) as Record<string, number>
    if (counts && typeof counts === 'object') {
      localStorage.setItem('rred_visit_counts', JSON.stringify(counts))
      window.dispatchEvent(new CustomEvent('rred-visit-counts'))
    }
  } catch {
    // Extension context not available — ignore
  }
}

// Send proactively on load
syncVisitCounts()

// Also respond to requests from the page (in case React mounts after content script)
window.addEventListener('rred-get-visit-counts', () => syncVisitCounts())
