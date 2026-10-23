<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LocateFixed, Pause, Play } from '@lucide/vue'

import type { GeoPoint, MapInstance } from '@/composables/useMapProvider'

import { useMapProvider } from '@/composables/useMapProvider'
import { useRenderProvidersReady } from '@/providers'
import { REPLAY_SPEEDS, replayStep, type ReplaySpeed } from '@/features/activities/utils/replay'
import { pointAtFraction } from '@/features/activities/utils/scrub'

const props = withDefaults(
  defineProps<{
    /** Ordered GPS coordinates forming the route polyline. */
    points: GeoPoint[]
    /** Whether the map responds to pan/zoom. */
    interactive?: boolean
    /** Point on the route that follows the chart cursor. `null` hides it. */
    cursor?: GeoPoint | null
    /** Reports hover along the route so the charts can follow. */
    follow?: boolean
    /** Shows the playback bar. Home thumbnails leave this off. */
    replay?: boolean
    /**
     * Epoch milliseconds for each point. `null` plays the samples evenly.
     * Ignored unless `replay` is set.
     */
    timesMs?: number[] | null
    /** Fraction already selected, so play continues from the cursor. */
    scrubFraction?: number | null
    /**
     * Bumps when the viewer scrubs the chart or the route. Playback stops so
     * the two do not fight over the cursor.
     */
    scrubSignal?: number
  }>(),
  {
    interactive: true,
    cursor: null,
    follow: false,
    replay: false,
    timesMs: null,
    scrubFraction: null,
    scrubSignal: 0,
  },
)

const emit = defineEmits<{
  trackHover: [fraction: number | null]
  replay: [fraction: number]
}>()

const ready = useRenderProvidersReady()
const container = ref<HTMLElement | null>(null)
const playing = ref(false)
const speed = ref<ReplaySpeed>(1)
let instance: MapInstance | null = null
let frame = 0
let startedAt = 0
let origin = 0

/** Resolves the start/finish emphasis points from the track ends. */
function endpoints(points: GeoPoint[]): { start?: GeoPoint; finish?: GeoPoint } {
  const first = points[0]
  const last = points[points.length - 1]
  return first && last ? { start: first, finish: last } : {}
}

/** Mounts the map once the provider is ready and the container exists. */
function mountMap(): void {
  if (instance || !container.value || !ready.value || props.points.length === 0) {
    return
  }
  const { provider } = useMapProvider()
  instance = provider.mount(container.value, {
    track: { points: props.points, ...endpoints(props.points) },
    interactive: props.interactive,
  })
  syncCursor()
}

/** Moves the route marker and listens for hover without redrawing the line. */
function syncCursor(): void {
  instance?.setCursor(props.cursor ?? null)
  instance?.setTrackHover(
    props.follow
      ? (fraction) => {
          // Panning the map under a resting pointer also fires this. Ignore it
          // while the clock is running so playback is not cancelled by itself.
          if (playing.value) {
            return
          }
          emit('trackHover', fraction)
        }
      : null,
  )
}

/** A press on the map itself stops playback so the viewer can look around. */
function onMapPointerDown(): void {
  pause()
}

/** Stops the playback clock without moving the cursor. */
function cancelClock(): void {
  if (frame !== 0) {
    cancelAnimationFrame(frame)
    frame = 0
  }
}

/** Stops playback. The cursor stays where it is. */
function pause(): void {
  playing.value = false
  cancelClock()
}

/**
 * Places the cursor for the elapsed playback clock and keeps it centered.
 *
 * @param now - `performance.now()` timestamp for this frame.
 */
function tick(now: number): void {
  frame = 0
  if (!playing.value) {
    return
  }
  const step = replayStep({
    elapsedMs: now - startedAt,
    speed: speed.value,
    length: props.points.length,
    timesMs: props.timesMs,
    startFraction: origin,
  })
  emit('replay', step.fraction)
  const point = pointAtFraction(props.points, step.fraction)
  if (point) {
    instance?.setCursor(point)
    instance?.panTo(point)
  }
  if (step.done) {
    playing.value = false
    return
  }
  frame = requestAnimationFrame(tick)
}

/** Starts playback from the current cursor, or from the start at the end. */
function play(): void {
  const current = props.scrubFraction ?? 0
  origin = current >= 1 ? 0 : current
  if (current >= 1) {
    emit('replay', 0)
  }
  startedAt = performance.now()
  playing.value = true
  cancelClock()
  frame = requestAnimationFrame(tick)
}

/**
 * Changes the playback rate. An active clock keeps its place.
 *
 * @param next - The rate to apply.
 */
function setSpeed(next: ReplaySpeed): void {
  if (playing.value && next !== speed.value) {
    const step = replayStep({
      elapsedMs: performance.now() - startedAt,
      speed: speed.value,
      length: props.points.length,
      timesMs: props.timesMs,
      startFraction: origin,
    })
    origin = step.fraction
    startedAt = performance.now()
  }
  speed.value = next
}

/** Re-fits the map to the whole track after the user has panned or zoomed. */
function recenter(): void {
  pause()
  instance?.recenter()
}

onMounted(mountMap)
watch(ready, mountMap)
watch(() => [props.cursor, props.follow] as const, syncCursor)
watch(
  () => props.points,
  (points) => {
    pause()
    if (!instance) {
      mountMap()
      return
    }
    instance.update({
      track: { points, ...endpoints(points) },
      interactive: props.interactive,
    })
  },
)
watch(
  () => props.scrubSignal,
  () => {
    if (playing.value) {
      pause()
    }
  },
)

onBeforeUnmount(() => {
  pause()
  instance?.destroy()
  instance = null
})
</script>

<template>
  <!-- Fills its parent, which controls the height (e.g. a gallery slide).
       `isolate` creates a stacking context so Leaflet's internal panes and
       controls (z-index up to 1000) stay contained and never paint over the
       sticky navbar (z-40) or bottom nav while scrolling. -->
  <div class="relative isolate size-full overflow-hidden bg-muted">
    <div
      ref="container"
      class="size-full"
      role="img"
      :aria-label="$t('activities.map.label')"
      @pointerdown="onMapPointerDown"
    />
    <!-- z above Leaflet's controls (z-1000) so it stays clickable. -->
    <button
      v-if="interactive && points.length > 0"
      type="button"
      class="absolute top-3 right-3 z-[1100] flex size-9 items-center justify-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
      :aria-label="$t('activities.map.recenter')"
      :title="$t('activities.map.recenter')"
      @click="recenter"
    >
      <LocateFixed class="size-4" />
    </button>
    <div
      v-if="replay && points.length > 1"
      class="absolute inset-x-3 bottom-3 z-[1100] flex items-center gap-1 overflow-x-auto rounded-full border border-border bg-card/85 p-1 text-foreground shadow-sm backdrop-blur"
      role="group"
      :aria-label="$t('activities.replay.label')"
    >
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
        :aria-label="playing ? $t('activities.replay.pause') : $t('activities.replay.play')"
        @click="playing ? pause() : play()"
      >
        <Pause v-if="playing" class="size-4" />
        <Play v-else class="size-4" />
      </button>
      <div class="flex min-w-0 flex-1 justify-end gap-0.5">
        <button
          v-for="rate in REPLAY_SPEEDS"
          :key="rate"
          type="button"
          class="shrink-0 rounded-full px-2 py-1 text-caption tabular-nums transition-colors"
          :class="
            rate === speed
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-accent'
          "
          :aria-pressed="rate === speed"
          :aria-label="$t('activities.replay.speed', { speed: rate })"
          @click="setSpeed(rate)"
        >
          {{ rate }}×
        </button>
      </div>
    </div>
  </div>
</template>
