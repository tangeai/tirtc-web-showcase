<script setup lang="ts">
import { Html5Qrcode } from 'html5-qrcode'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ScanResult } from '../types/monitor'
import { normalizeScanText } from '../utils/scan-result'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  scanned: [result: ScanResult]
}>()

const readerId = 'monitor-qr-reader'
const scanner = ref<Html5Qrcode | null>(null)
const scannerState = ref<'idle' | 'starting' | 'scanning' | 'error'>('idle')
const errorMessage = ref('')
const isClosing = ref(false)
const manualDeviceId = ref('')

const helperText = computed(() => {
  if (scannerState.value === 'starting') return '正在启动相机…'
  if (scannerState.value === 'scanning') return '将二维码对准扫描框'
  if (scannerState.value === 'error') return errorMessage.value || '无法启动扫码'
  return '点击下方按钮开始扫码'
})

async function stopScanner() {
  const current = scanner.value
  if (!current) return

  try {
    if (scannerState.value === 'scanning') {
      await current.stop()
    }
  } catch {
    // ignore stop errors
  }

  try {
    await current.clear()
  } catch {
    // ignore clear errors
  }

  scanner.value = null
  scannerState.value = 'idle'
}

async function closeDialog() {
  isClosing.value = true
  await stopScanner()
  manualDeviceId.value = ''
  isClosing.value = false
  emit('close')
}

async function handleDecoded(rawText: string) {
  const result = normalizeScanText(rawText)
  await stopScanner()
  emit('scanned', result)
}

async function startScanner() {
  errorMessage.value = ''
  scannerState.value = 'starting'

  await nextTick()

  try {
    const instance = new Html5Qrcode(readerId)
    scanner.value = instance

    const cameras = await Html5Qrcode.getCameras()
    if (!cameras.length) {
      throw new Error('未检测到可用摄像头，请确认已授予相机权限')
    }

    const preferredCamera =
      cameras.find((camera) => /back|rear|environment|后置/i.test(camera.label)) ?? cameras[0]

    await instance.start(
      { deviceId: { exact: preferredCamera.id } },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        await handleDecoded(decodedText)
      },
      () => {
        // ignore frame parse noise
      },
    )

    scannerState.value = 'scanning'
  } catch (error) {
    scannerState.value = 'error'
    errorMessage.value =
      error instanceof Error ? error.message : '扫码启动失败，请确认浏览器相机权限已开启'
  }
}

async function onPickImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  errorMessage.value = ''

  try {
    const instance = scanner.value ?? new Html5Qrcode(readerId)
    scanner.value = instance
    const decodedText = await instance.scanFile(file, true)
    await handleDecoded(decodedText)
  } catch (error) {
    scannerState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '识别图片二维码失败'
  } finally {
    input.value = ''
  }
}

async function submitManualDeviceId() {
  const value = manualDeviceId.value.trim()
  if (!value) {
    scannerState.value = 'error'
    errorMessage.value = '请先输入设备 ID'
    return
  }

  await stopScanner()
  emit('scanned', { rawText: value, deviceId: value })
  manualDeviceId.value = ''
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await startScanner()
    } else if (!isClosing.value) {
      await stopScanner()
    }
  },
)

onBeforeUnmount(async () => {
  await stopScanner()
})
</script>

<template>
  <div v-if="open" class="scan-dialog-mask" @click.self="closeDialog">
    <section class="scan-dialog">
      <header class="scan-dialog-head">
        <div>
          <h2>扫描设备二维码</h2>
          <p>{{ helperText }}</p>
        </div>
        <button class="scan-dialog-close" type="button" @click="closeDialog">×</button>
      </header>

      <div :id="readerId" class="scan-reader"></div>

      <div class="scan-manual-section">
        <label class="scan-manual-field">
          <span>手动输入设备 ID</span>
          <input
            v-model.trim="manualDeviceId"
            type="text"
            placeholder="例如 TESTSONGZC00"
            @keydown.enter.prevent="submitManualDeviceId"
          />
        </label>
      </div>

      <div class="scan-dialog-actions">
        <label class="scan-image-btn">
          <input type="file" accept="image/*" @change="onPickImage" />
          相册导入
        </label>
        <button class="scan-manual-btn" type="button" @click="submitManualDeviceId">手动连接</button>
      </div>
    </section>
  </div>
</template>
