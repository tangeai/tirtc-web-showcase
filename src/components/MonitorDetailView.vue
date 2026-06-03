<script setup lang="ts">
import type { HistoryRecord, MediaDiagnostics, TimelineEntry } from '../types/monitor'

defineProps<{
  canConnect: boolean
  isConnecting: boolean
  isConnected: boolean
  isTimelineOpen: boolean
  isTalking: boolean
  isDoorOpen: boolean
  isVolumeOpen: boolean
  manualVolume: number
  statusLabel: string
  isDeviceOnline: boolean
  volumeLevel: number
  volumeBars: boolean[]
  currentDeviceId: string
  connectionHelperText: string
  callActionLabel: string
  talkActionLabel: string
  doorActionLabel: string
  mediaDiagnostics: MediaDiagnostics
  historyRecords: HistoryRecord[]
  timeline: TimelineEntry[]
  timelineToggleText: string
}>()

const emit = defineEmits<{
  back: []
  scan: []
  callAction: []
  talkToggle: []
  volumeToggle: []
  volumeInput: [event: Event]
  doorToggle: []
  toggleTimeline: []
}>()
</script>

<template>
  <main class="mobile-page">
    <header class="detail-header">
      <button class="back-button" type="button" aria-label="返回" @click="emit('back')">‹</button>
      <h1>IPC 查看</h1>
      <button class="scan-button" type="button" :disabled="!canConnect" @click="emit('scan')">
        {{ isConnecting ? '连接中' : '扫描设备二维码' }}
      </button>
    </header>

    <section class="video-card">
      <div class="video-card-top">
        <div class="video-device-block">
          <div class="video-status-inline">
            <span class="status-dot" :data-active="isDeviceOnline"></span>
            <span>{{ statusLabel }}</span>
          </div>
        </div>
        <div class="volume-pill">
          <span>音量 {{ volumeLevel }}</span>
          <div class="volume-bars">
            <span v-for="(active, index) in volumeBars" :key="index" :data-active="active"></span>
          </div>
        </div>
      </div>

      <div class="video-stage">
        <canvas id="canvas" class="video-canvas"></canvas>
        <div v-if="!isConnected" class="video-overlay">
          <strong>{{ statusLabel }}</strong>
          <span>{{ connectionHelperText }}</span>
        </div>
      </div>

      <div class="video-card-bottom">{{ currentDeviceId }}</div>
    </section>

    <section class="media-info-card">
      <div class="media-info-grid">
        <div class="media-info-item">
          <span>传输状态</span>
          <strong>{{ mediaDiagnostics.transportState }}</strong>
          <small>模式 {{ mediaDiagnostics.connectionMode }}</small>
          <small v-if="mediaDiagnostics.lastErrorCode">错误码 {{ mediaDiagnostics.lastErrorCode }}</small>
          <small v-if="mediaDiagnostics.failureReason">{{ mediaDiagnostics.failureReason }}</small>
        </div>
        <div class="media-info-item">
          <span>视频编码</span>
          <strong>{{ mediaDiagnostics.videoCodec }}</strong>
        </div>
        <div class="media-info-item">
          <span>视频链路</span>
          <strong>{{ mediaDiagnostics.videoState }}</strong>
          <small>stream {{ mediaDiagnostics.videoStreamId }} · {{ mediaDiagnostics.lastVideoFrameAt || '暂无首帧' }}</small>
        </div>
        <div class="media-info-item">
          <span>音频链路</span>
          <strong>{{ mediaDiagnostics.audioState }}</strong>
          <small>stream {{ mediaDiagnostics.audioStreamId }} · {{ mediaDiagnostics.lastAudioPacketAt || '暂无音频包' }}</small>
        </div>
      </div>

      <div v-if="mediaDiagnostics.peerFailureMessage || mediaDiagnostics.iceTimeline.length" class="rtc-diagnostics">
        <div v-if="mediaDiagnostics.peerFailureMessage" class="rtc-diagnostics-block">
          <span>Peer 失败摘要</span>
          <strong>{{ mediaDiagnostics.peerFailureMessage }}</strong>
        </div>

        <div v-if="mediaDiagnostics.iceTimeline.length" class="rtc-diagnostics-block">
          <span>ICE 状态时序</span>
          <ul>
            <li v-for="item in mediaDiagnostics.iceTimeline" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="action-panel">
      <button
        class="action-tile"
        :class="isConnected || isConnecting ? 'action-tile-danger' : 'action-tile-success'"
        type="button"
        @click="emit('callAction')"
      >
        <svg v-if="isConnected || isConnecting" class="action-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.68 13.31a16.938 16.938 0 0 0 3.01 3.01l1.55-1.55a2 2 0 0 1 2.11-.46c1.12.37 2.33.57 3.65.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.3 21 3 13.7 3 4a1 1 0 0 1 1-1h3.12a1 1 0 0 1 1 1c0 1.32.2 2.53.57 3.65a2 2 0 0 1-.46 2.11z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
          <line x1="22" y1="2" x2="2" y2="22" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
        </svg>
        <svg v-else class="action-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 6.5c0 6.9 5.6 12.5 12.5 12.5h2a1 1 0 0 0 1-1v-2.2a1 1 0 0 0-.74-.97l-3.13-.78a1 1 0 0 0-.98.27l-1.2 1.2a10.6 10.6 0 0 1-4.72-4.72l1.2-1.2a1 1 0 0 0 .27-.98l-.78-3.13A1 1 0 0 0 9 4H6.5a2 2 0 0 0-2 2.5Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
          <path d="M14 6.5a5 5 0 0 1 3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          <path d="M14 3.5a8 8 0 0 1 6.5 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
        </svg>
        <span>{{ callActionLabel }}</span>
      </button>

      <button class="action-tile action-tile-talk" type="button" :data-active="isTalking" @click="emit('talkToggle')">
        <svg v-if="!isTalking" class="action-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 19v3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          <path d="M8 22h8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          <rect x="9" y="2" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M5 10v1a7 7 0 0 0 14 0v-1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
        </svg>
        <div v-else class="pickup-indicator" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span>{{ talkActionLabel }}</span>
      </button>

      <div class="volume-action-wrap action-slot">
        <button class="action-tile action-tile-volume" type="button" :data-active="isVolumeOpen" @click="emit('volumeToggle')">
          <svg class="action-svg" viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
          </svg>
          <span>音量</span>
        </button>
        <div v-if="isVolumeOpen" class="volume-popover">
          <span>音量 {{ manualVolume }}</span>
          <input type="range" min="0" max="100" :value="manualVolume" @input="emit('volumeInput', $event)" />
        </div>
      </div>

      <button class="action-tile action-tile-primary" type="button" :data-active="isDoorOpen" @click="emit('doorToggle')">
        <span class="action-icon door-icon"></span>
        <span>{{ doorActionLabel }}</span>
      </button>
    </section>

    <section class="history-card">
      <div class="history-card-head">
        <h2>历史连接记录</h2>
      </div>

      <article v-for="record in historyRecords" :key="record.id" class="history-row">
        <div class="history-avatar" :data-avatar="record.avatar">
          <span v-if="record.avatar === 'camera'" class="history-camera"></span>
          <span v-else class="history-scan-box"></span>
        </div>
        <div class="history-copy">
          <strong>{{ record.deviceId }}</strong>
          <span>{{ record.subtitle }}</span>
        </div>
        <div class="history-time">
          <strong>{{ record.time }}</strong>
          <span>{{ record.day }}</span>
        </div>
      </article>
    </section>

    <section class="timeline-card">
      <button class="timeline-toggle" type="button" @click="emit('toggleTimeline')">
        <span>事件日志</span>
        <span>{{ timelineToggleText }}</span>
      </button>

      <div v-if="isTimelineOpen" class="timeline-panel">
        <div v-if="mediaDiagnostics.consoleErrors.length" class="runtime-errors">
          <strong>浏览器 / SDK 运行时错误</strong>
          <ul>
            <li v-for="(item, index) in mediaDiagnostics.consoleErrors" :key="`${index}-${item}`">{{ item }}</li>
          </ul>
        </div>

        <ul class="timeline">
          <li v-for="item in timeline" :key="item.id" :data-level="item.level">
            <span class="timeline-time">{{ item.time }}</span>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>
