import { ref } from 'vue'
import type { TimelineEntry, TimelineLevel } from '../types/monitor'
import { formatClock } from '../utils/date-time'

export function useTimeline(limit = 20) {
  const timeline = ref<TimelineEntry[]>([])
  let nextEntryId = 1

  function pushLog(level: TimelineLevel, title: string, detail: string) {
    timeline.value = [
      ...timeline.value,
      {
        id: nextEntryId,
        time: formatClock(),
        level,
        title,
        detail,
      },
    ].slice(-limit)
    nextEntryId += 1
  }

  return {
    pushLog,
    timeline,
  }
}
