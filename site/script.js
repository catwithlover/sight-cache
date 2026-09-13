const menuButton = document.querySelector('[data-menu-button]')
const siteNav = document.querySelector('[data-site-nav]')
const mobileMenu = window.matchMedia('(max-width: 52rem)')

const setMenu = (open) => {
  if (!menuButton || !siteNav) return

  const isOpen = mobileMenu.matches && open
  menuButton.setAttribute('aria-expanded', String(isOpen))
  siteNav.hidden = mobileMenu.matches ? !isOpen : false
}

if (menuButton && siteNav) {
  setMenu(false)

  menuButton.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true')
  })

  siteNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      setMenu(false)
      menuButton.focus()
    }
  })

  mobileMenu.addEventListener('change', () => setMenu(false))
}

const copyButton = document.querySelector('[data-copy]')
const copyStatus = document.querySelector('[data-copy-status]')

copyButton?.addEventListener('click', async () => {
  const command = copyButton.dataset.copy

  try {
    await navigator.clipboard.writeText(command)
    copyButton.dataset.copied = 'true'
    copyButton.querySelector('span').textContent = copyButton.dataset.copiedLabel
    if (copyStatus) copyStatus.textContent = copyButton.dataset.successMessage

    window.setTimeout(() => {
      copyButton.dataset.copied = 'false'
      copyButton.querySelector('span').textContent = copyButton.dataset.copyLabel
      if (copyStatus) copyStatus.textContent = ''
    }, 2200)
  } catch {
    if (copyStatus) copyStatus.textContent = copyButton.dataset.errorMessage
  }
})
