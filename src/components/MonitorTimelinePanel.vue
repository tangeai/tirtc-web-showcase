<script setup lang="ts">
import type { TimelineEntry } from '../types/monitor'

defineProps<{
  isOpen: boolean
  toggleText: string
  entries: TimelineEntry[]
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section class="timeline-card">
    <button class="timeline-toggle" type="button" @click="emit('toggle')">
      <span>事件日志</span>
      <span>{{ toggleText }}</span>
    </button>

    <div v-if="isOpen" class="timeline-panel">
      <ul class="timeline">
        <li v-for="item in entries" :key="item.id" :data-level="item.level">
          <span class="timeline-time">{{ item.time }}</span>
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.detail }}</p>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
