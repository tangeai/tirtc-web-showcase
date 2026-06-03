import type { ShortcutItem } from '../types/monitor'

export const DEFAULT_DEVICE_ID = 'TESTSONGZC00'
export const DEFAULT_AUDIO_STREAM_ID = 1
export const DEFAULT_VIDEO_STREAM_ID = 0

export const SHORTCUT_ITEMS: ShortcutItem[] = [
  { id: 'ipc', title: 'IPC 查看', subtitle: '视频监视 · 音频状态', accent: 'blue' },
  { id: 'call', title: '呼叫', subtitle: '拨打设备联系人', accent: 'gray' },
  { id: 'wechat', title: '微信呼叫', subtitle: '微信联系人通知', accent: 'green' },
  { id: 'ai', title: 'AI 对讲', subtitle: '语音助手和远程问答', accent: 'green' },
  { id: 'settings', title: '设置', subtitle: '设备、网络和权限', accent: 'gray' },
]
