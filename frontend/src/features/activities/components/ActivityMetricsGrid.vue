<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Clock,
  Flame,
  Gauge,
  Heart,
  Mountain,
  PersonStanding,
  Route,
  Timer,
  Zap,
} from '@lucide/vue'

import type { Activity } from '@/features/activities/types'
import type { Units } from '@/features/activities/utils/format'
import type { MetricVisibility } from '@/features/activities/utils/metrics'

import { MetricPill } from '@/components/ui/metric-pill'
import { buildActivityMetrics } from '@/features/activities/utils/metrics'

const props = defineProps<{
  activity: Activity
  units: Units
  visibility: MetricVisibility
}>()

const { t } = useI18n()

const tiles = computed(() => buildActivityMetrics(props.activity, props.units, props.visibility))

const TILE_ICONS: Record<string, Component> = {
  distance: Route,
  time: Timer,
  elapsedTime: Clock,
  pace: Gauge,
  avgSpeed: Gauge,
  elevationGain: Mountain,
  avgHr: Heart,
  maxHr: Heart,
  calories: Flame,
  avgPower: Zap,
  maxPower: Zap,
  jumps: PersonStanding,
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
    <MetricPill
      v-for="tile in tiles"
      :key="tile.key"
      :label="t(tile.labelKey)"
      :value="tile.value"
      :unit="tile.unit"
      :accent="tile.accent"
      :icon="TILE_ICONS[tile.key]"
    />
  </div>
</template>
