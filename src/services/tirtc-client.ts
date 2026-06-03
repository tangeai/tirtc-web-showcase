import {
  TiRtc,
  TiRtcAudioOutput,
  TiRtcConn,
  type TiRtcEnvironment,
  TiRtcInitOptions,
  TiRtcVideoOutput,
} from '../vendor/tirtc.es.min.js'

export interface StartPlaybackInput {
  appId: string
  autoSubscribe: boolean
  audioStreamId: number
  deviceId: string
  onDiagnostic?: (event: PlaybackDiagnosticEvent) => void
  token: string
  videoStreamId: number
}

export interface PlaybackSession {
  stop: () => void
}

export interface PlaybackDiagnosticEvent {
  phase:
    | 'sdk:init:start'
    | 'sdk:init:ready'
    | 'connection:create'
    | 'connection:connect:start'
    | 'connection:connect:success'
    | 'output:attach:audio'
    | 'output:attach:video'
    | 'subscribe:audio'
    | 'subscribe:video'
    | 'media:audio-ready'
    | 'media:video-ready'
    | 'connection:disconnect'
    | 'connection:error'
  detail: string
  meta?: Record<string, unknown>
  media?: {
    audioState?: string
    connectionMode?: string
    iceTimeline?: string[]
    peerFailureMessage?: string
    transportState?: string
    videoCodec?: string
    videoState?: string
  }
}

function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    const errorLike = error as unknown as Record<string, unknown>
    const extra: Record<string, unknown> = {}
    for (const key of Object.keys(error)) {
      extra[key] = errorLike[key]
    }
    return {
      message: error.message,
      stack: error.stack || '',
      meta: extra,
    }
  }

  if (typeof error === 'object' && error) {
    return {
      message: JSON.stringify(error),
      stack: '',
      meta: error as Record<string, unknown>,
    }
  }

  return {
    message: String(error || '连接失败'),
    stack: '',
    meta: {},
  }
}

function extractLogInsights(meta: Record<string, unknown>) {
  const logs = Array.isArray(meta.logs) ? meta.logs.map((item) => String(item)) : []
  const connectionMode = logs.find((line) => line.includes('connection mode:'))?.split('connection mode:')[1]?.trim() || ''
  const iceTimeline = logs.filter((line) => line.includes('ice connection state'))
  const peerFailureMessage = logs.find((line) => line.includes('peer connection failed')) || ''

  return {
    connectionMode,
    iceTimeline,
    peerFailureMessage,
  }
}

let initializedAppId = ''
let videoReadyPromise: Promise<void> | null = null

function resolveSdkEnvironment(): TiRtcEnvironment {
  const urlParams = new URLSearchParams(window.location.search)
  const fromUrl = urlParams.get('tirtc-env')?.trim().toLowerCase()
  const fromBuild = (import.meta.env.VITE_TIRTC_ENV || '').trim().toLowerCase()
  const env = fromUrl || fromBuild || 'test'

  if (env === 'pre') return 'pre'
  if (env === 'production') return 'production'
  return 'test'
}

async function ensureSdkReady(appId: string) {
  const normalizedAppId = appId.trim()
  if (!normalizedAppId) {
    throw new Error('缺少 AppId，无法初始化 TiRTC SDK')
  }

  if (initializedAppId && initializedAppId !== normalizedAppId) {
    throw new Error('当前页面已经使用其他 AppId 初始化，请刷新页面后重试')
  }

  if (!initializedAppId) {
    TiRtc.initialize(
      TiRtcInitOptions({
        appId: normalizedAppId,
        environment: resolveSdkEnvironment(),
      }),
    )
    initializedAppId = normalizedAppId
    videoReadyPromise = TiRtc.videoOutputReady()
  }

  await videoReadyPromise
}

export async function startTiRtcPlayback(input: StartPlaybackInput): Promise<PlaybackSession> {
  input.onDiagnostic?.({
    phase: 'sdk:init:start',
    detail: `准备初始化 TiRTC，AppId=${input.appId}`,
  })
  await ensureSdkReady(input.appId)
  input.onDiagnostic?.({
    phase: 'sdk:init:ready',
    detail: 'TiRTC 初始化完成，视频依赖已就绪',
  })

  const connection = new TiRtcConn()
  input.onDiagnostic?.({
    phase: 'connection:create',
    detail: `已创建连接对象，deviceId=${input.deviceId}`,
  })
  const audioOutput = TiRtcAudioOutput({
    connection,
    streamId: input.audioStreamId,
  })
  const videoOutput = TiRtcVideoOutput({
    connection,
    streamId: input.videoStreamId,
  })

  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    input.onDiagnostic?.({
      phase: 'connection:disconnect',
      detail: '开始释放音视频输出和连接对象',
    })

    try {
      videoOutput.detach()
    } catch {
      // ignore detach errors during shutdown
    }

    try {
      audioOutput.detach()
    } catch {
      // ignore detach errors during shutdown
    }

    try {
      connection.disconnect()
    } catch {
      // ignore disconnect errors during shutdown
    }
  }

  try {
    input.onDiagnostic?.({
      phase: 'connection:connect:start',
      detail: '已发起 TiRtcConn.connect，等待连接成功',
      media: { transportState: 'connecting' },
    })
    await connection.connect({
      deviceId: input.deviceId,
      token: input.token,
    })

    input.onDiagnostic?.({
      phase: 'connection:connect:success',
      detail: '连接已建立，开始挂载音视频输出',
      media: { transportState: 'connected' },
    })

    audioOutput.attach()
    input.onDiagnostic?.({
      phase: 'output:attach:audio',
      detail: `音频输出已绑定到 stream ${input.audioStreamId}`,
      media: { audioState: 'attached' },
    })
    videoOutput.attach()
    input.onDiagnostic?.({
      phase: 'output:attach:video',
      detail: `视频输出已绑定到 stream ${input.videoStreamId}`,
      media: { videoState: 'attached', videoCodec: '等待首帧' },
    })

    if (input.autoSubscribe) {
      connection.subscribeAudio({ streamId: input.audioStreamId })
      input.onDiagnostic?.({
        phase: 'subscribe:audio',
        detail: `已请求远端音频订阅 stream ${input.audioStreamId}`,
        media: { audioState: 'subscribed' },
      })
      connection.subscribeVideo({ streamId: input.videoStreamId })
      input.onDiagnostic?.({
        phase: 'subscribe:video',
        detail: `已请求远端视频订阅 stream ${input.videoStreamId}`,
        media: { videoState: 'subscribed', videoCodec: '等待首帧' },
      })
    }

    input.onDiagnostic?.({
      phase: 'media:audio-ready',
      detail: `音频订阅请求已发出，当前测试只请求音频 stream ${input.audioStreamId}，等待真实音频包到达`,
      media: { audioState: '等待音频包' },
    })
    input.onDiagnostic?.({
      phase: 'media:video-ready',
      detail: `视频订阅请求已发出，当前测试只请求视频 stream ${input.videoStreamId}，等待真实首帧到达（可能是 H264 或 MJPEG）`,
      media: { videoState: '等待首帧', videoCodec: '待识别' },
    })

    return { stop }
  } catch (error) {
    const normalizedError = describeUnknownError(error)
    const insights = extractLogInsights(normalizedError.meta)
    input.onDiagnostic?.({
      phase: 'connection:error',
      detail: normalizedError.message,
      meta: {
        stack: normalizedError.stack,
        ...normalizedError.meta,
      },
      media: {
        transportState: 'failed',
        connectionMode: insights.connectionMode,
        iceTimeline: insights.iceTimeline,
        peerFailureMessage: insights.peerFailureMessage,
      },
    })
    stop()
    throw error
  }
}