import type { ScanResult } from '../types/monitor'

const DEVICE_ID_QUERY_KEYS = ['device_id', 'deviceId', 'remote_id', 'remoteId']
const DEVICE_ID_JSON_KEYS = ['deviceId', 'device_id', 'remoteId', 'remote_id']

export function normalizeScanText(rawText: string): ScanResult {
  const text = rawText.trim()

  try {
    const parsed = new URL(text)
    const deviceId = DEVICE_ID_QUERY_KEYS
      .map((key) => parsed.searchParams.get(key))
      .find((value) => value?.trim())

    if (deviceId) {
      return { rawText: text, deviceId: deviceId.trim() }
    }
  } catch {
    // Fall back to JSON or plain text parsing.
  }

  try {
    const parsedJson = JSON.parse(text) as Record<string, unknown>
    const candidate = DEVICE_ID_JSON_KEYS
      .map((key) => parsedJson[key])
      .find((value) => typeof value === 'string' && value.trim())

    if (typeof candidate === 'string') {
      return { rawText: text, deviceId: candidate.trim() }
    }
  } catch {
    // Fall back to using the raw text as the device id.
  }

  return { rawText: text, deviceId: text }
}
