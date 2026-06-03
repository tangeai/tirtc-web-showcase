<script setup lang="ts">
import type { HistoryRecord } from '../types/monitor'

defineProps<{
  records: HistoryRecord[]
}>()
</script>

<template>
  <section class="history-card">
    <div class="history-card-head">
      <h2>历史连接记录</h2>
    </div>

    <article v-for="record in records" :key="record.id" class="history-row">
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
</template>
