<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useCurrentUser } from '@/features/auth/composables/useCurrentUser'
import { useMonthActivitiesQuery } from '@/features/home/composables/useHome'
import {
  activityLocalDate,
  calendarActivityIcon,
  monthGrid,
  shiftMonth,
  weekStartIndex,
} from '@/features/home/utils/activityCalendar'

const { t, locale } = useI18n()
const { data: currentUser } = useCurrentUser()

const today = new Date()
const cursor = ref({ year: today.getFullYear(), monthIndex: today.getMonth() })
const weekStartsOn = computed(() => currentUser.value?.firstDayOfWeek ?? 'monday')

const days = computed(() =>
  monthGrid(cursor.value.year, cursor.value.monthIndex, weekStartsOn.value),
)
const range = computed(() => ({
  start: days.value[0]?.date ?? '',
  end: days.value[days.value.length - 1]?.date ?? '',
}))
const activities = useMonthActivitiesQuery(range)

const byDay = computed(() => {
  const grouped = new Map<string, { id: number; name: string; type: number }[]>()
  for (const activity of activities.data.value ?? []) {
    if (!activity.startTime) {
      continue
    }
    const key = activityLocalDate(activity.startTime, activity.timezone)
    if (!key) {
      continue
    }
    const list = grouped.get(key) ?? []
    list.push({ id: activity.id, name: activity.name, type: activity.activityType })
    grouped.set(key, list)
  }
  return grouped
})

const title = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
    new Date(cursor.value.year, cursor.value.monthIndex, 1),
  ),
)

/** Short weekday labels beginning on the profile's first day of the week. */
const weekdays = computed(() => {
  const start = new Date(Date.UTC(2024, 0, 7 + weekStartIndex(weekStartsOn.value)))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return new Intl.DateTimeFormat(locale.value, { weekday: 'short', timeZone: 'UTC' }).format(date)
  })
})

const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

/** Moves the visible month. */
function step(delta: number): void {
  cursor.value = shiftMonth(cursor.value.year, cursor.value.monthIndex, delta)
}
</script>

<template>
  <Card class="flex flex-col gap-2" padding="sm" :aria-label="t('home.calendar.label')">
    <div class="flex items-center justify-between gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('home.calendar.previous')"
        @click="step(-1)"
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
      </Button>
      <p class="text-center text-sm font-medium capitalize">{{ title }}</p>
      <Button variant="ghost" size="icon-sm" :aria-label="t('home.calendar.next')" @click="step(1)">
        <ChevronRight class="size-4" aria-hidden="true" />
      </Button>
    </div>

    <div class="grid grid-cols-7 overflow-hidden rounded-md border border-border text-center">
      <div
        v-for="(label, index) in weekdays"
        :key="`weekday-${index}`"
        class="border-b border-border bg-muted/40 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
        :class="index < 6 && 'border-r'"
      >
        {{ label }}
      </div>
      <div
        v-for="(day, index) in days"
        :key="day.date"
        class="flex min-h-12 flex-col items-center border-border py-1"
        :class="[
          index % 7 !== 6 && 'border-r',
          index < days.length - 7 && 'border-b',
          day.inMonth ? 'text-foreground' : 'text-muted-foreground/45',
          day.date === todayKey && 'bg-muted',
        ]"
      >
        <span class="text-xs leading-none">{{ day.day }}</span>
        <span class="mt-0.5 flex flex-wrap justify-center gap-px">
          <RouterLink
            v-for="activity in byDay.get(day.date) ?? []"
            :key="activity.id"
            :to="{ name: 'activity', params: { id: activity.id } }"
            class="text-primary hover:text-primary/80"
            :aria-label="t('home.calendar.openActivity', { name: activity.name })"
            :title="activity.name"
          >
            <component
              :is="calendarActivityIcon(activity.type)"
              class="size-3"
              aria-hidden="true"
            />
          </RouterLink>
        </span>
      </div>
    </div>
  </Card>
</template>
