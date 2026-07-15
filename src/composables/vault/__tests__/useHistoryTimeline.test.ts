import { describe, expect, it } from 'vitest'
import { groupTimelineItems } from '../useHistoryTimeline'

describe('groupTimelineItems', () => {
  it('groups Today, Yesterday, weekdays, and Last Week in display order', () => {
    const now = new Date(2026, 6, 15, 12).getTime()
    const day = 86_400_000
    const items = [
      { id: 'today', at: now },
      { id: 'yesterday', at: now - day },
      { id: 'monday', at: now - 2 * day },
      { id: 'last-week', at: now - 8 * day },
    ]

    const groups = groupTimelineItems(
      items,
      (item) => item.at,
      'en-US',
      { today: 'Today', yesterday: 'Yesterday', lastWeek: 'Last Week', earlier: 'Earlier' },
      now,
    )

    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday', 'Monday', 'Last Week'])
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      'today',
      'yesterday',
      'monday',
      'last-week',
    ])
  })
})
