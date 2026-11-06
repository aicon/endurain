<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Sun,
  Wind,
} from '@lucide/vue'

import type { ActivityWeather } from '@/features/activities/types'
import type { Units } from '@/features/activities/utils/format'
import {
  formatActivityWeather,
  type WeatherConditionKind,
} from '@/features/activities/utils/metrics'

const props = defineProps<{
  weather: ActivityWeather | null
  units: Units
}>()

const { t } = useI18n()

const parts = computed(() => formatActivityWeather(props.weather, props.units))

const CONDITION_ICON: Record<WeatherConditionKind, Component> = {
  clear: Sun,
  cloudy: Cloud,
  foggy: CloudFog,
  drizzle: CloudDrizzle,
  rainy: CloudRain,
  snowy: CloudSnow,
  stormy: CloudLightning,
  weather: CloudSun,
}

const CONDITION_CLASS: Record<WeatherConditionKind, string> = {
  clear: 'text-amber-500',
  cloudy: 'text-slate-500',
  foggy: 'text-slate-400',
  drizzle: 'text-sky-400',
  rainy: 'text-sky-600',
  snowy: 'text-sky-300',
  stormy: 'text-violet-500',
  weather: 'text-amber-500',
}

const conditionIcon = computed(() =>
  parts.value ? CONDITION_ICON[parts.value.conditionKind] : CloudSun,
)
const conditionClass = computed(() =>
  parts.value ? CONDITION_CLASS[parts.value.conditionKind] : CONDITION_CLASS.weather,
)

const humidityLabel = computed(() => {
  if (parts.value?.humidity == null) {
    return null
  }
  return t('activities.metrics.humidityValue', { percent: parts.value.humidity })
})

const windLabel = computed(() => {
  const wind = parts.value?.wind
  if (!wind) {
    return null
  }
  const speed = `${wind.value} ${wind.unit}`
  if (!wind.dirKey) {
    return speed
  }
  return t('activities.metrics.windValue', {
    speed,
    dir: t(wind.dirKey),
  })
})
</script>

<template>
  <p v-if="parts" class="text-hint flex flex-wrap items-center gap-x-3 gap-y-1">
    <span class="inline-flex items-center gap-1.5">
      <component
        :is="conditionIcon"
        class="size-3.5 shrink-0"
        :class="conditionClass"
        aria-hidden="true"
      />
      <span
        >{{ t(parts.conditionKey) }}, {{ parts.temperature.value }}
        {{ parts.temperature.unit }}</span
      >
    </span>
    <span v-if="humidityLabel" class="inline-flex items-center gap-1.5">
      <Droplets class="size-3.5 shrink-0 text-sky-500" aria-hidden="true" />
      <span>{{ humidityLabel }}</span>
    </span>
    <span v-if="windLabel" class="inline-flex items-center gap-1.5">
      <Wind class="size-3.5 shrink-0 text-teal-600" aria-hidden="true" />
      <span>{{ windLabel }}</span>
    </span>
  </p>
</template>
