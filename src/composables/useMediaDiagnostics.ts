import { reactive } from 'vue'
import { DEFAULT_AUDIO_STREAM_ID, DEFAULT_VIDEO_STREAM_ID } from '../constants/monitor'
import type { PlaybackDiagnosticEvent } from '../services/tirtc-client'
import type { MediaDiagnostics, TimelineLevel } from '../types/monitor'
import { formatClock } from '../utils/date-time'

interface UseMediaDiagnosticsOptions {
  getAudioStreamId: () => number
  getVideoStreamId: () => number
  pushLog: (level: TimelineLevel, title: string, detail: string) => void
}

function createMediaDiagnostics(audioStreamId: number, videoStreamId: number): MediaDiagnostics {
  return {
    audioState: '待接收',
    audioStreamId,
    consoleErrors: [],
    failureReason: '',
    connectionMode: '未知',
    lastAudioPacketAt: '',
    lastErrorCode: '',
    iceTimeline: [],
    peerFailureMessage: '',
    transportState: 'idle',
    videoCodec: '未知',
    videoState: '待接收',
    videoStreamId,
    lastVideoFrameAt: '',
  }
}

function stringifyConsoleArg(value: unknown) {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function resolvePhaseTitle(phase: PlaybackDiagnosticEvent['phase']) {
  const phaseTitleMap: Record<string, string> = {
    token: '阶段 1 · Token 就绪',
    init: '阶段 2 · SDK 初始化',
    connect: '阶段 3 · 发起连接',
    attach: '阶段 4 · 绑定输出',
    subscribe: '阶段 5 · 请求流',
    media: '阶段 6 · 媒体反馈',
    'sdk:init:start': '阶段 2 · SDK 初始化',
    'sdk:init:ready': '阶段 2 · SDK 初始化',
    'connection:create': '阶段 3 · 创建连接',
    'connection:connect:start': '阶段 3 · 发起连接',
    'connection:connect:success': '阶段 3 · 连接成功',
    'connection:error': '阶段 3 · 连接异常',
    'connection:disconnect': '阶段 3 · 连接断开',
    'output:attach:audio': '阶段 4 · 绑定音频输出',
    'output:attach:video': '阶段 4 · 绑定视频输出',
    'subscribe:audio': '阶段 5 · 请求音频流',
    'subscribe:video': '阶段 5 · 请求视频流',
    'media:audio-ready': '阶段 6 · 音频到达',
    'media:video-ready': '阶段 6 · 视频到达',
  }

  return phaseTitleMap[phase] || `阶段 · ${phase}`
}

export function useMediaDiagnostics(options: UseMediaDiagnosticsOptions) {
  const mediaDiagnostics = reactive(
    createMediaDiagnostics(DEFAULT_AUDIO_STREAM_ID, DEFAULT_VIDEO_STREAM_ID),
  )

  function resetMediaDiagnostics() {
    Object.assign(
      mediaDiagnostics,
      createMediaDiagnostics(options.getAudioStreamId(), options.getVideoStreamId()),
    )
  }

  function applyPlaybackDiagnostic(event: PlaybackDiagnosticEvent) {
    const level: TimelineLevel = event.phase === 'connection:error' ? 'error' : 'info'
    const metaSuffix = event.meta && Object.keys(event.meta).length
      ? ` | ${JSON.stringify(event.meta)}`
      : ''

    options.pushLog(level, resolvePhaseTitle(event.phase), `${event.detail}${metaSuffix}`)

    if (event.media?.transportState) {
      mediaDiagnostics.transportState = event.media.transportState
    }
    if (event.media?.connectionMode) {
      mediaDiagnostics.connectionMode = event.media.connectionMode
    }
    if (event.media?.iceTimeline) {
      mediaDiagnostics.iceTimeline = event.media.iceTimeline
    }
    if (event.media?.peerFailureMessage) {
      mediaDiagnostics.peerFailureMessage = event.media.peerFailureMessage
    }
    if (event.media?.audioState) {
      mediaDiagnostics.audioState = event.media.audioState
      mediaDiagnostics.lastAudioPacketAt = formatClock()
    }
    if (event.media?.videoState) {
      mediaDiagnostics.videoState = event.media.videoState
      mediaDiagnostics.lastVideoFrameAt = formatClock()
    }
    if (event.media?.videoCodec) {
      mediaDiagnostics.videoCodec = event.media.videoCodec
    }

    if (event.phase === 'connection:error') {
      const meta = event.meta || {}
      const errorCode = typeof meta.code === 'string' || typeof meta.code === 'number'
        ? String(meta.code)
        : typeof meta.errorCode === 'string' || typeof meta.errorCode === 'number'
          ? String(meta.errorCode)
          : ''

      mediaDiagnostics.lastErrorCode = errorCode
      if (meta.stack) {
        mediaDiagnostics.consoleErrors = [String(meta.stack), ...mediaDiagnostics.consoleErrors].slice(0, 5)
      }
    }
  }

  function attachRuntimeDiagnostics() {
    const originalError = window.console.error
    window.console.error = (...args: unknown[]) => {
      const text = args.map(stringifyConsoleArg).join(' ')
      mediaDiagnostics.consoleErrors = [text, ...mediaDiagnostics.consoleErrors].slice(0, 8)
      originalError.apply(window.console, args)
    }

    const handleError = (event: ErrorEvent) => {
      const text = [event.message, event.filename, event.lineno, event.colno].filter(Boolean).join(' @ ')
      mediaDiagnostics.consoleErrors = [text, ...mediaDiagnostics.consoleErrors].slice(0, 8)
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const text = event.reason instanceof Error
        ? `${event.reason.message} | ${event.reason.stack || ''}`
        : String(event.reason)
      mediaDiagnostics.consoleErrors = [text, ...mediaDiagnostics.consoleErrors].slice(0, 8)
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.console.error = originalError
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }

  return {
    applyPlaybackDiagnostic,
    attachRuntimeDiagnostics,
    mediaDiagnostics,
    resetMediaDiagnostics,
  }
}
