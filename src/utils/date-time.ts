export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}
