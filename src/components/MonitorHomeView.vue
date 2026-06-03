<script setup lang="ts">
import type { ShortcutItem } from '../types/monitor'

defineProps<{
  items: ShortcutItem[]
}>()

const emit = defineEmits<{
  open: [id: string]
}>()
</script>

<template>
  <main class="mobile-page home-page">
    <p class="home-title">欢迎使用 TiRTC</p>

    <section class="shortcut-list">
      <button
        v-for="item in items"
        :key="item.id"
        class="shortcut-card"
        type="button"
        @click="emit('open', item.id)"
      >
        <div class="shortcut-icon" :data-accent="item.accent">
          <span v-if="item.id === 'ipc'" class="shortcut-monitor">
            <span class="shortcut-monitor-screen"></span>
            <span class="shortcut-monitor-stand"></span>
            <span class="shortcut-monitor-base"></span>
          </span>
          <span v-else-if="item.id === 'call'" class="shortcut-phone"></span>
          <span v-else-if="item.id === 'wechat'" class="shortcut-wechat">
            <span class="shortcut-wechat-main"></span>
            <span class="shortcut-wechat-sub"></span>
          </span>
          <span v-else-if="item.id === 'ai'" class="shortcut-ai">AI</span>
          <span v-else class="shortcut-gear">
            <span class="shortcut-gear-ring"></span>
            <span class="shortcut-gear-dot"></span>
          </span>
        </div>
        <span class="shortcut-copy">
          <strong>{{ item.title }}</strong>
          <span>{{ item.subtitle }}</span>
        </span>
      </button>
    </section>
  </main>
</template>
