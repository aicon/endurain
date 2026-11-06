<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useMonthActivitiesQuery } from '@/features/home/composables/useHome'
import {
  activityLocalDate,
  calendarActivityIcon,
  monthGrid,
  shiftMonth,
} from '@/features/home/utils/activityCalendar'

const { t, locale } = useI18n()

const today = new Date()
const cursor = ref({ year: today.getFullYear(), monthIndex: today.getMonth() })

const days = computed(() => monthGrid(cursor.value.year, cursor.value.monthIndex))
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

/** Sunday-first narrow weekday labels in the active locale. */
const weekdays = computed(() => {
  const sunday = new Date(Date.UTC(2024, 0, 7))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sunday)
    date.setUTCDate(sunday.getUTCDate() + index)
    return new Intl.DateTimeFormat(locale.value, { weekday: 'narrow', timeZone: 'UTC' }).format(
      date,
    )
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

    <div class="grid grid-cols-7 text-center text-[10px] text-muted-foreground uppercase">
      <span v-for="(label, index) in weekdays" :key="index">{{ label }}</span>
    </div>

    <div class="grid grid-cols-7 gap-px">
      <div
        v-for="day in days"
        :key="day.date"
        class="flex min-h-9 flex-col items-center rounded-sm py-0.5"
        :class="[
          day.inMonth ? 'text-foreground' : 'text-muted-foreground/50',
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
