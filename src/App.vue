<script setup lang="ts">
import MonitorDetailView from './components/MonitorDetailView.vue'
import MonitorHomeView from './components/MonitorHomeView.vue'
import MonitorScanDialog from './components/MonitorScanDialog.vue'
import { useMonitorWorkspace } from './composables/useMonitorWorkspace'

const {
  currentView,
  shortcutItems,
  timeline,
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
  connectionHelperText,
  callActionLabel,
  talkActionLabel,
  doorActionLabel,
  openDetail,
  openScanDialog,
  closeScanDialog,
  goBackHome,
  handleCallAction,
  toggleTalkAction,
  toggleVolumePanel,
  updateVolume,
  toggleDoorAction,
  handleScanResult,
  timelineToggleText,
} = useMonitorWorkspace()
</script>

<template>
  <div class="page-shell">
    <MonitorHomeView v-if="currentView === 'home'" :items="shortcutItems" @open="openDetail" />

    <template v-else>
      <MonitorDetailView
        :can-connect="canConnect"
        :is-connecting="isConnecting"
        :is-connected="isConnected"
        :is-timeline-open="isTimelineOpen"
        :is-talking="isTalking"
        :is-door-open="isDoorOpen"
        :is-volume-open="isVolumeOpen"
        :manual-volume="manualVolume"
        :status-label="statusLabel"
        :is-device-online="isDeviceOnline"
        :volume-level="volumeLevel"
        :volume-bars="volumeBars"
        :current-device-id="currentDeviceId"
        :connection-helper-text="connectionHelperText"
        :call-action-label="callActionLabel"
        :talk-action-label="talkActionLabel"
        :door-action-label="doorActionLabel"
        :media-diagnostics="mediaDiagnostics"
        :history-records="historyRecords"
        :timeline="timeline"
        :timeline-toggle-text="timelineToggleText"
        @back="goBackHome"
        @scan="openScanDialog"
        @call-action="handleCallAction"
        @talk-toggle="toggleTalkAction"
        @volume-toggle="toggleVolumePanel"
        @volume-input="updateVolume"
        @door-toggle="toggleDoorAction"
        @toggle-timeline="isTimelineOpen = !isTimelineOpen"
      />

      <MonitorScanDialog
        :open="isScanDialogOpen"
        @close="closeScanDialog"
        @scanned="handleScanResult"
      />
    </template>
  </div>
</template>
