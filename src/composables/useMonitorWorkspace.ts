import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { DEFAULT_AUDIO_STREAM_ID, DEFAULT_DEVICE_ID, DEFAULT_VIDEO_STREAM_ID, SHORTCUT_ITEMS } from '../constants/monitor'
import { issueToken } from '../services/token-api'
import { startTiRtcPlayback, type PlaybackSession } from '../services/tirtc-client'
import type {
  HistoryRecord,
  MonitorFormState,
  ScanResult,
  SdkState,
  SessionState,
  TokenState,
  WorkspaceView,
} from '../types/monitor'
import {
  buildConnectionFailureMessage,
  normalizeOptionalUrl,
  validateStreamId,
} from '../utils/connection-diagnostics'
import { formatClock } from '../utils/date-time'
import { useMediaDiagnostics } from './useMediaDiagnostics'
import { useTimeline } from './useTimeline'

const CONNECTING_VOLUME_LEVEL = 24
const DEFAULT_MANUAL_VOLUME = 62
const VOLUME_BAR_THRESHOLDS = [15, 30, 45, 60]

export function useMonitorWorkspace() {
  const form = reactive<MonitorFormState>({
    deviceId: '',
    appId: '',
    token: '',
    endpoint: '',
    openapiEndpoint: '',
    audioStreamId: DEFAULT_AUDIO_STREAM_ID,
    videoStreamId: DEFAULT_VIDEO_STREAM_ID,
    autoSubscribe: true,
  })

  const { pushLog, timeline } = useTimeline()
  const {
    applyPlaybackDiagnostic,
    attachRuntimeDiagnostics,
    mediaDiagnostics,
    resetMediaDiagnostics,
  } = useMediaDiagnostics({
    getAudioStreamId: () => form.audioStreamId,
    getVideoStreamId: () => form.videoStreamId,
    pushLog,
  })

  const sdkState = ref<SdkState>('uninitialized')
  const tokenState = ref<TokenState>('missing')
  const sessionState = ref<SessionState>('idle')
  const currentView = ref<WorkspaceView>('home')
  const isConnecting = ref(false)
  const initializedAppId = ref('')
  const lastError = ref('')
  const lastTokenAt = ref('')
  const lastPlaybackAt = ref('')
  const activeSession = shallowRef<PlaybackSession | null>(null)
  const isTimelineOpen = ref(false)
  const connectedDeviceId = ref('')
  const isTalking = ref(false)
  const isDoorOpen = ref(false)
  const isVolumeOpen = ref(false)
  const manualVolume = ref(DEFAULT_MANUAL_VOLUME)
  const isScanDialogOpen = ref(false)
  const lastTokenSource = ref('openapi')
  let detachRuntimeDiagnostics: (() => void) | null = null

  const canConnect = computed(() => !isConnecting.value)
  const isConnected = computed(() => sessionState.value === 'playing')
  const isDeviceOnline = computed(() => sessionState.value === 'playing')
  const statusLabel = computed(() => {
    if (sessionState.value === 'playing') return '已连接'
    if (sessionState.value === 'connecting') return '连接中'
    return '未连接'
  })
  const volumeLevel = computed(() => {
    if (sessionState.value === 'playing') return manualVolume.value
    if (sessionState.value === 'connecting') return CONNECTING_VOLUME_LEVEL
    return 0
  })
  const volumeBars = computed(() => VOLUME_BAR_THRESHOLDS.map((threshold) => volumeLevel.value >= threshold))
  const currentDeviceId = computed(() => connectedDeviceId.value || form.deviceId.trim() || '设备 ID')
  const timelineToggleText = computed(() => (isTimelineOpen.value ? '隐藏事件日志' : '查看事件日志'))
  const connectionHelperText = computed(() => {
    if (sessionState.value === 'playing') return `当前设备 ${currentDeviceId.value}`
    return '右上角扫描设备二维码发起连接'
  })
  const callActionLabel = computed(() => (isConnected.value || sessionState.value === 'connecting' ? '挂断' : '连接'))
  const talkActionLabel = computed(() => (isTalking.value ? '拾音中' : '对讲'))
  const doorActionLabel = computed(() => (isDoorOpen.value ? '已开门' : '开门'))
  const historyRecords = computed<HistoryRecord[]>(() => [
    {
      id: 1,
      deviceId: connectedDeviceId.value || form.deviceId.trim() || DEFAULT_DEVICE_ID,
      subtitle: sessionState.value === 'playing' ? '实时监视进行中' : '最近一次扫码连接设备',
      time: lastPlaybackAt.value || lastTokenAt.value || '17:21',
      day: lastPlaybackAt.value || lastTokenAt.value ? '刚刚' : '今天',
      avatar: 'camera',
    },
    {
      id: 2,
      deviceId: 'TESTSONGZC02',
      subtitle: '历史连接设备',
      time: '15:08',
      day: '今天',
      avatar: 'scan',
    },
  ])

  function resetInteractiveStates() {
    isTalking.value = false
    isDoorOpen.value = false
    isVolumeOpen.value = false
  }

  function resolveTargetDeviceId() {
    return form.deviceId.trim()
  }

  function openDetail() {
    currentView.value = 'detail'
  }

  function openScanDialog() {
    currentView.value = 'detail'
    isScanDialogOpen.value = true
  }

  function closeScanDialog() {
    isScanDialogOpen.value = false
  }

  function stopPlayback(detail = '已手动释放当前连接', keepLog = true) {
    if (activeSession.value) {
      activeSession.value.stop()
      activeSession.value = null
    }

    if (sessionState.value === 'playing' || sessionState.value === 'connecting') {
      sessionState.value = 'stopped'
    }

    connectedDeviceId.value = ''
    resetInteractiveStates()
    resetMediaDiagnostics()

    if (keepLog) {
      pushLog('warn', '连接已释放', detail)
    }
  }

  function goBackHome() {
    stopPlayback('返回首页，已释放当前连接', false)
    currentView.value = 'home'
  }

  function handleCallAction() {
    if (isConnected.value || sessionState.value === 'connecting') {
      stopPlayback('通过挂断按钮结束当前连接')
      return
    }

    if (!form.deviceId.trim()) {
      lastError.value = '请先扫描二维码'
      pushLog('warn', '无法连接设备', '请先扫描二维码')
      return
    }

    void connectByScan()
  }

  function requireConnectedAction(actionName: string) {
    if (isConnected.value) return true

    pushLog('warn', `${actionName}未执行`, '请先完成设备连接。')
    return false
  }

  function toggleTalkAction() {
    if (!requireConnectedAction('对讲')) return

    isTalking.value = !isTalking.value
    pushLog(
      'info',
      isTalking.value ? '已开启对讲' : '已关闭对讲',
      isTalking.value ? '当前显示拾音器状态。' : '已恢复到默认麦克风状态。',
    )
  }

  function toggleDoorAction() {
    if (!requireConnectedAction('开门')) return

    isDoorOpen.value = !isDoorOpen.value
    pushLog(
      'info',
      isDoorOpen.value ? '开门动作已激活' : '开门动作已关闭',
      isDoorOpen.value ? '按钮进入深色激活状态。' : '按钮恢复默认浅色状态。',
    )
  }

  function toggleVolumePanel() {
    if (!requireConnectedAction('音量调节')) return
    isVolumeOpen.value = !isVolumeOpen.value
  }

  function updateVolume(event: Event) {
    const target = event.target as HTMLInputElement
    manualVolume.value = Number(target.value)
  }

  function markConnectValidationError(message: string) {
    sessionState.value = 'error'
    lastError.value = message
    pushLog('error', '参数校验失败', message)
  }

  function validateConnectionInput(remoteId: string) {
    if (!remoteId) {
      sessionState.value = 'error'
      tokenState.value = 'error'
      lastError.value = '请先扫描二维码'
      pushLog('warn', '无法连接设备', '请先扫描二维码')
      return false
    }

    try {
      validateStreamId(form.audioStreamId, '音频流 ID')
      validateStreamId(form.videoStreamId, '视频流 ID')
      return true
    } catch (error) {
      markConnectValidationError(error instanceof Error ? error.message : '流 ID 不合法')
      return false
    }
  }

  function prepareConnectingState(remoteId: string) {
    stopPlayback('准备建立新的播放会话', false)
    isConnecting.value = true
    tokenState.value = 'loading'
    sessionState.value = 'connecting'
    lastError.value = ''
    currentView.value = 'detail'
    resetMediaDiagnostics()
    mediaDiagnostics.transportState = 'connecting'
    pushLog('info', '开始扫码连接', `正在为设备 ${remoteId} 获取 token 并建立实时连接。`)
    pushLog('info', '测试流配置', `视频测试只请求 stream ${form.videoStreamId}；音频测试只请求 stream ${form.audioStreamId}。`)
  }

  async function connectByScan() {
    const remoteId = resolveTargetDeviceId()
    const connectStartedAt = Date.now()

    if (!validateConnectionInput(remoteId)) {
      return
    }

    prepareConnectingState(remoteId)

    try {
      const result = await issueToken({
        remoteId,
        endpoint: normalizeOptionalUrl(form.endpoint),
        openapiEndpoint: normalizeOptionalUrl(form.openapiEndpoint),
      })

      form.appId = result.appId
      form.token = result.token
      lastTokenSource.value = result.source
      tokenState.value = 'ready'
      lastTokenAt.value = formatClock()
      pushLog('success', 'Token 已签发', `设备 ${remoteId} 的连接凭证已生成。`)

      if (!initializedAppId.value) {
        sdkState.value = 'preparing'
      }

      const session = await startTiRtcPlayback({
        appId: result.appId,
        deviceId: remoteId,
        token: result.token,
        audioStreamId: form.audioStreamId,
        videoStreamId: form.videoStreamId,
        autoSubscribe: form.autoSubscribe,
        onDiagnostic: applyPlaybackDiagnostic,
      })

      activeSession.value = session
      initializedAppId.value = result.appId
      connectedDeviceId.value = remoteId
      sdkState.value = 'ready'
      sessionState.value = 'playing'
      mediaDiagnostics.transportState = 'connected'
      manualVolume.value = DEFAULT_MANUAL_VOLUME
      lastPlaybackAt.value = formatClock()
      pushLog('success', '设备已连接', `当前正在查看设备 ${remoteId}。`)
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : '连接失败'
      const diagnosticMessage = buildConnectionFailureMessage({
        rawMessage,
        remoteId,
        elapsedMs: Date.now() - connectStartedAt,
        environment: import.meta.env.VITE_TIRTC_ENV || 'test',
        tokenSource: lastTokenSource.value,
        connectionMode: mediaDiagnostics.connectionMode,
        peerFailureMessage: mediaDiagnostics.peerFailureMessage,
      })

      sessionState.value = 'error'
      tokenState.value = 'error'
      mediaDiagnostics.transportState = 'failed'
      mediaDiagnostics.failureReason = diagnosticMessage
      lastError.value = diagnosticMessage
      if (rawMessage.includes('AppId')) {
        sdkState.value = 'locked'
      }
      pushLog('error', '连接失败', diagnosticMessage)
    } finally {
      isConnecting.value = false
    }
  }

  async function handleScanResult(result: ScanResult) {
    closeScanDialog()
    form.deviceId = result.deviceId
    connectedDeviceId.value = result.deviceId
    pushLog('success', '扫码成功', `已识别设备 ${result.deviceId}。`)
    await connectByScan()
  }

  function applyUrlPrefill() {
    const search = new URLSearchParams(window.location.search)
    const deviceId = search.get('device_id')?.trim()

    if (deviceId) {
      form.deviceId = deviceId
      connectedDeviceId.value = deviceId
      currentView.value = 'detail'
      pushLog('info', '已加载预填设备', `已从 URL 预填设备 ${deviceId}。`)
    }
  }

  onMounted(() => {
    detachRuntimeDiagnostics = attachRuntimeDiagnostics()
    pushLog('info', '页面已加载', '等待扫码连接设备。')
    applyUrlPrefill()
  })

  onBeforeUnmount(() => {
    detachRuntimeDiagnostics?.()
    stopPlayback('页面卸载，已释放媒体链路', false)
  })

  return {
    currentView,
    shortcutItems: SHORTCUT_ITEMS,
    timeline,
    sdkState,
    tokenState,
    sessionState,
    isScanDialogOpen,
    isConnecting,
    isConnected,
    isTimelineOpen,
    isTalking,
    isDoorOpen,
    isVolumeOpen,
    manualVolume,
    mediaDiagnostics,
    historyRecords,
    canConnect,
    statusLabel,
    isDeviceOnline,
    volumeLevel,
    volumeBars,
    currentDeviceId,
    timelineToggleText,
    connectionHelperText,
    callActionLabel,
    talkActionLabel,
    doorActionLabel,
    lastError,
    openDetail,
    openScanDialog,
    closeScanDialog,
    goBackHome,
    handleCallAction,
    toggleTalkAction,
    toggleDoorAction,
    toggleVolumePanel,
    updateVolume,
    connectByScan,
    handleScanResult,
  }
}
