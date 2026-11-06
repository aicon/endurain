<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'

import { cn } from '@/lib/utils'

import type { MetricPillVariants } from '.'
import { metricPillValueVariants } from '.'

interface Props {
  /** Short uppercase caption, e.g. "Distance". */
  label: string
  /** Formatted primary value, e.g. "12.4". */
  value: string | number
  /** Optional unit suffix shown next to the value, e.g. "km". */
  unit?: string
  /** Optional leading icon, shown before the caption with a gap. */
  icon?: Component
  /** Semantic colour for the value (defaults to neutral ink). */
  accent?: MetricPillVariants['accent']
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div data-slot="metric-pill" :class="cn('min-w-[100px] rounded-input', props.class)">
    <p class="mb-1 flex items-center gap-1.5 text-caption">
      <component :is="icon" v-if="icon" class="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <span>{{ label }}</span>
    </p>
    <p :class="metricPillValueVariants({ accent })">
      {{ value }}
      <span v-if="unit" class="text-hint font-normal">{{ unit }}</span>
    </p>
  </div>
</template>
