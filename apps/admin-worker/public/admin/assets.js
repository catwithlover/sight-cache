(() => {
  const createForm = document.querySelector('[data-create-device]')
  const deviceNameInput = document.querySelector('#device-name')
  const notice = document.querySelector('[data-notice]')
  const tokenDialog = document.querySelector('[data-token-dialog]')
  const dialogNotice = document.querySelector('[data-dialog-notice]')
  const tokenField = document.querySelector('[data-token-value]')
  const tokenDevice = document.querySelector('[data-token-device]')
  const copyButton = document.querySelector('[data-copy-token]')
  const actionDialog = document.querySelector('[data-action-dialog]')
  const actionKicker = document.querySelector('[data-action-kicker]')
  const actionTitle = document.querySelector('[data-action-title]')
  const actionDescription = document.querySelector('[data-action-description]')
  const actionMark = document.querySelector('[data-action-mark]')
  const cancelActionButton = document.querySelector('[data-cancel-action]')
  const confirmActionButton = document.querySelector('[data-confirm-action]')
  let pendingAction = null
  let tokenVisible = false
  let copyResetTimer

  const clearNotices = () => {
    const elements = [notice, dialogNotice]
    elements.forEach((element) => {
      if (!(element instanceof HTMLElement)) return
      element.hidden = true
      element.textContent = ''
    })
  }

  const showNotice = (message, tone = 'info') => {
    const target =
      tokenDialog instanceof HTMLDialogElement && tokenDialog.open
        ? dialogNotice
        : notice
    if (!(target instanceof HTMLElement)) return
    target.textContent = message
    target.dataset.tone = tone
    target.hidden = false
  }

  const setBusy = (button, busy, label) => {
    if (!(button instanceof HTMLButtonElement)) return
    if (!button.dataset.label) button.dataset.label = button.textContent || ''
    button.disabled = busy
    button.textContent = busy ? label : button.dataset.label
  }

  const request = async (url, options) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(payload?.error?.message || '操作失敗，請稍後再試。')
    }

    return payload
  }

  const readToken = (payload) => {
    const token = payload?.data?.token
    if (typeof token !== 'string' || !token.startsWith('scd_')) {
      throw new Error('Token 回應格式無效，請重新整理後再次產生。')
    }
    return token
  }

  const resetCopyButton = () => {
    if (!(copyButton instanceof HTMLButtonElement)) return
    window.clearTimeout(copyResetTimer)
    copyButton.textContent = '複製 Token'
    delete copyButton.dataset.copied
  }

  const showToken = (deviceName, token) => {
    if (
      !(tokenDialog instanceof HTMLDialogElement) ||
      !(tokenField instanceof HTMLTextAreaElement) ||
      !(tokenDevice instanceof HTMLElement)
    ) {
      throw new Error('畫面無法顯示 Token，請重新整理後再次產生。')
    }

    clearNotices()
    resetCopyButton()
    tokenDevice.textContent = deviceName
    tokenField.value = token
    tokenVisible = true
    tokenDialog.showModal()
    tokenField.focus()
    tokenField.select()
  }

  const openActionDialog = (action) => {
    if (
      !(actionDialog instanceof HTMLDialogElement) ||
      !(actionKicker instanceof HTMLElement) ||
      !(actionTitle instanceof HTMLElement) ||
      !(actionDescription instanceof HTMLElement) ||
      !(actionMark instanceof HTMLElement) ||
      !(confirmActionButton instanceof HTMLButtonElement)
    ) {
      showNotice('畫面無法確認操作，請重新整理後再試。', 'error')
      return
    }

    pendingAction = action
    const disabling = action.kind === 'disable'
    actionDialog.dataset.tone = disabling ? 'disable' : 'rotate'
    actionKicker.textContent = disabling ? '撤銷設備權限' : '更新存取憑證'
    actionTitle.textContent = disabling
      ? '停用「' + action.name + '」？'
      : '替「' + action.name + '」產生新 Token？'
    actionDescription.textContent = disabling
      ? '目前 Token 會立即失效，而且設備之後無法重新啟用。這項操作不能復原。'
      : '目前 Token 會立即失效。請確認 Collector 可同步更新，以免設備中斷傳送。'
    actionMark.textContent = disabling ? '!' : '↻'
    confirmActionButton.className = disabling
      ? 'danger-solid-button'
      : 'primary-button'
    confirmActionButton.textContent = disabling ? '停用設備' : '重新產生 Token'
    actionDialog.showModal()

    if (cancelActionButton instanceof HTMLButtonElement) {
      cancelActionButton.focus()
    }
  }

  const executeDeviceAction = async (action) => {
    clearNotices()

    if (action.kind === 'rotate') {
      setBusy(action.button, true, '產生中...')
      try {
        const payload = await request(
          '/api/devices/' + encodeURIComponent(action.id) + '/token',
          { method: 'POST' },
        )
        showToken(action.name, readToken(payload))
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '無法產生 Token。', 'error')
      } finally {
        setBusy(action.button, false, '')
      }
      return
    }

    setBusy(action.button, true, '停用中...')
    try {
      await request('/api/devices/' + encodeURIComponent(action.id), {
        method: 'DELETE',
      })
      window.location.reload()
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '無法停用設備。', 'error')
      setBusy(action.button, false, '')
    }
  }

  document.querySelectorAll('[data-local-time]').forEach((element) => {
    if (!(element instanceof HTMLTimeElement)) return
    const date = new Date(element.dateTime)
    if (!Number.isNaN(date.getTime())) {
      element.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    }
  })

  if (deviceNameInput instanceof HTMLInputElement) {
    deviceNameInput.addEventListener('input', () => {
      deviceNameInput.removeAttribute('aria-invalid')
      if (
        deviceNameInput.value.trim() &&
        notice instanceof HTMLElement &&
        notice.dataset.tone === 'error'
      ) {
        clearNotices()
      }
    })
  }

  if (createForm instanceof HTMLFormElement) {
    createForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      clearNotices()
      const button = createForm.querySelector('button[type="submit"]')
      const name = String(new FormData(createForm).get('name') || '').trim()

      if (!name) {
        if (deviceNameInput instanceof HTMLInputElement) {
          deviceNameInput.setAttribute('aria-invalid', 'true')
          deviceNameInput.focus()
        }
        showNotice('請輸入設備名稱。', 'error')
        return
      }

      setBusy(button, true, '建立中...')
      try {
        const payload = await request('/api/devices', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        createForm.reset()
        showToken(payload?.data?.device?.name || name, readToken(payload))
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '無法建立設備。', 'error')
      } finally {
        setBusy(button, false, '')
      }
    })
  }

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('[data-device-action]')
    if (!(button instanceof HTMLButtonElement)) return

    const id = button.dataset.deviceId
    const name = button.dataset.deviceName || '此設備'
    const kind = button.dataset.deviceAction
    if (!id || (kind !== 'rotate' && kind !== 'disable')) return

    openActionDialog({ id, name, kind, button })
  })

  if (actionDialog instanceof HTMLDialogElement) {
    actionDialog.addEventListener('close', () => {
      const action = pendingAction
      const confirmed = actionDialog.returnValue === 'confirm'
      pendingAction = null
      actionDialog.returnValue = ''
      if (confirmed && action) void executeDeviceAction(action)
    })
  }

  if (
    copyButton instanceof HTMLButtonElement &&
    tokenField instanceof HTMLTextAreaElement
  ) {
    copyButton.addEventListener('click', async () => {
      clearNotices()
      try {
        await navigator.clipboard.writeText(tokenField.value)
        copyButton.textContent = '已複製'
        copyButton.dataset.copied = 'true'
        copyResetTimer = window.setTimeout(resetCopyButton, 2400)
        showNotice('Token 已複製，可以貼到 Collector。')
      } catch {
        tokenField.focus()
        tokenField.select()
        showNotice('請手動複製選取的 Token。', 'error')
      }
    })
  }

  if (tokenDialog instanceof HTMLDialogElement) {
    tokenDialog.addEventListener('cancel', (event) => {
      if (tokenVisible) event.preventDefault()
    })
    tokenDialog.addEventListener('close', () => {
      tokenVisible = false
      window.location.assign('/admin')
    })
  }

  window.addEventListener('beforeunload', (event) => {
    if (!tokenVisible) return
    event.preventDefault()
    event.returnValue = ''
  })
})()
