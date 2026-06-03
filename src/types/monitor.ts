export type TimelineLevel = 'info' | 'success' | 'warn' | 'error'
export type SessionState = 'idle' | 'connecting' | 'playing' | 'stopped' | 'error'
export type WorkspaceView = 'home' | 'detail'
export type SdkState = 'uninitialized' | 'preparing' | 'ready' | 'locked'
export type TokenState = 'missing' | 'loading' | 'ready' | 'error'

export interface MonitorFormState {
  appId: string
  audioStreamId: number
  autoSubscribe: boolean
  deviceId: string
  endpoint: string
  openapiEndpoint: string
  token: string
  videoStreamId: number
}

export interface TimelineEntry {
  id: number
  time: string
  level: TimelineLevel
  title: string
  detail: string
}

export interface HistoryRecord {
  id: number
  deviceId: string
  subtitle: string
  time: string
  day: string
  avatar: 'camera' | 'scan'
}

export interface MediaDiagnostics {
  audioState: string
  audioStreamId: number
  connectionMode: string
  consoleErrors: string[]
  failureReason: string
  iceTimeline: string[]
  lastAudioPacketAt: string
  lastErrorCode: string
  peerFailureMessage: string
  transportState: string
  videoCodec: string
  videoState: string
  videoStreamId: number
  lastVideoFrameAt: string
}

export interface ShortcutItem {
  id: string
  title: string
  subtitle: string
  accent: 'blue' | 'green' | 'gray'
}

export interface ScanResult {
  rawText: string
  deviceId: string
}
