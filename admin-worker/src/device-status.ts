import type { Device } from './devices'

export const RECENT_DEVICE_ACTIVITY_MS = 10 * 60 * 1000

export type DeviceStatus = 'recent' | 'offline' | 'never' | 'disabled'

type DeviceActivitySource = 'frame' | 'token'

export type DevicePresence = {
  status: DeviceStatus
  label: string
  description: string
  activityAt: string | null
  activitySource: DeviceActivitySource | null
}

const statusCopy: Record<
  DeviceStatus,
  Pick<DevicePresence, 'label' | 'description'>
> = {
  recent: {
    label: '近期連線',
    description: '最近 10 分鐘內有影格儲存或 Token 驗證活動',
  },
  offline: {
    label: '已離線',
    description: '超過 10 分鐘沒有影格儲存或 Token 驗證活動',
  },
  never: {
    label: '尚未連線',
    description: '尚未記錄影格儲存或目前 Token 的驗證活動',
  },
  disabled: {
    label: '已停用',
    description: '設備與目前 Token 已停用',
  },
}

export const getDevicePresence = (
  device: Device,
  nowMs: number,
): DevicePresence => {
  if (device.disabledAt) {
    return {
      status: 'disabled',
      ...statusCopy.disabled,
      activityAt: null,
      activitySource: null,
    }
  }

  const candidates = [
    { at: device.lastFrameAt, source: 'frame' as const },
    { at: device.token?.lastUsedAt ?? null, source: 'token' as const },
  ]
  const latestActivity = candidates
    .filter(
      (
        candidate,
      ): candidate is { at: string; source: DeviceActivitySource } =>
        candidate.at !== null && Number.isFinite(Date.parse(candidate.at)),
    )
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0]

  if (!latestActivity) {
    const hasInvalidActivity = candidates.some(
      (candidate) => candidate.at !== null,
    )
    const status = hasInvalidActivity ? 'offline' : 'never'

    return {
      status,
      ...statusCopy[status],
      activityAt: null,
      activitySource: null,
    }
  }

  const status =
    nowMs - Date.parse(latestActivity.at) <= RECENT_DEVICE_ACTIVITY_MS
      ? 'recent'
      : 'offline'

  return {
    status,
    ...statusCopy[status],
    activityAt: latestActivity.at,
    activitySource: latestActivity.source,
  }
}
