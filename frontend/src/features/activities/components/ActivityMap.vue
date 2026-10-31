<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LocateFixed, Pause, Play, X } from '@lucide/vue'

import type { GeoPoint, MapInstance } from '@/composables/useMapProvider'

import { useMapProvider } from '@/composables/useMapProvider'
import { useAppConfig } from '@/features/config/composables/useAppConfig'
import { useRenderProvidersReady } from '@/providers'
import type { ReplayMap } from '@/features/activities/replay/mountReplayMap'
import {
  REPLAY_SPEED_SCALE,
  REPLAY_SPEEDS,
  replayStep,
  smoothFrameDelta,
  type ReplaySpeed,
} from '@/features/activities/utils/replay'
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
const { config } = useAppConfig()
const container = ref<HTMLElement | null>(null)
const replayHost = ref<HTMLElement | null>(null)
const playing = ref(false)
const open = ref(false)
const tilted = ref(false)
const speed = ref<ReplaySpeed>(1)
let replayMap: ReplayMap | null = null
let replayMount = 0

/** Labeled rate times fifteen, so 1x plays the recording at fifteen times its pace. */
function clockSpeed(): number {
  return speed.value * REPLAY_SPEED_SCALE
}

/** Slider position, kept in step with `scrubFraction` and the playback clock. */
const scrubModel = ref(0)
const played = computed(() => `${scrubModel.value * 100}%`)
let instance: MapInstance | null = null
let frame = 0
let origin = 0
let lastTickAt = 0
let smoothedDeltaS = 1 / 60
let smoothedElapsedMs = 0

/** Restarts the smoothed playback clock at `now`. */
function resetPlaybackClock(now: number): void {
  lastTickAt = now
  smoothedDeltaS = 1 / 60
  smoothedElapsedMs = 0
}

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

/** Moves the route marker. While following, the chase camera sits behind it. */
function moveCursor(fraction: number, followCamera: boolean, snap = false): void {
  const point = pointAtFraction(props.points, fraction)
  if (!point) {
    return
  }
  instance?.setCursor(point)
  if (!followCamera) {
    return
  }
  if (replayMap) {
    replayMap.follow(props.points, fraction, snap, props.timesMs)
    return
  }
  instance?.panTo(point)
}

/** Reads the slider and moves the cursor to that point. */
function onSliderInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  seek(Number(raw))
}

/**
 * Jumps the cursor, the charts, and the slider to a fraction.
 *
 * @param fraction - Position from 0 to 1.
 */
function seek(fraction: number): void {
  if (!Number.isFinite(fraction)) {
    return
  }
  const next = Math.min(1, Math.max(0, fraction))
  scrubModel.value = next
  if (playing.value) {
    origin = next
    resetPlaybackClock(performance.now())
    if (next >= 1) {
      pause()
    }
  }
  emit('replay', next)
  if (next >= 1 && tilted.value) {
    open.value = false
    restoreOverview()
    return
  }
  moveCursor(next, true, true)
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
  const rawDelta = lastTickAt > 0 ? (now - lastTickAt) / 1000 : 1 / 60
  lastTickAt = now
  smoothedDeltaS = smoothFrameDelta(smoothedDeltaS, rawDelta)
  smoothedElapsedMs += smoothedDeltaS * 1000
  const step = replayStep({
    elapsedMs: smoothedElapsedMs,
    speed: clockSpeed(),
    length: props.points.length,
    timesMs: props.timesMs,
    startFraction: origin,
  })
  scrubModel.value = step.fraction
  emit('replay', step.fraction)
  moveCursor(step.fraction, true, false)
  if (step.done) {
    playing.value = false
    open.value = false
    restoreOverview()
    return
  }
  frame = requestAnimationFrame(tick)
}

/** Starts playback from the current cursor, or from the start at the end. */
async function play(): Promise<void> {
  open.value = true
  const current = scrubModel.value
  origin = current >= 1 ? 0 : current
  if (current >= 1) {
    scrubModel.value = 0
    emit('replay', 0)
    moveCursor(0, false)
  }
  playing.value = true
  await mountTilted()
  if (!playing.value || !open.value) {
    return
  }
  moveCursor(scrubModel.value, true, true)
  resetPlaybackClock(performance.now())
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
      elapsedMs: smoothedElapsedMs,
      speed: clockSpeed(),
      length: props.points.length,
      timesMs: props.timesMs,
      startFraction: origin,
    })
    origin = step.fraction
    resetPlaybackClock(performance.now())
  }
  speed.value = next
}

/** Steps to the next playback rate, wrapping after the fastest. */
function cycleSpeed(): void {
  const index = REPLAY_SPEEDS.indexOf(speed.value)
  setSpeed(REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length] ?? 1)
}

/** Hides the playback bar and stops the clock. */
function closePlayer(): void {
  pause()
  open.value = false
}

/** Drops the tilted map so the flat map shows again. */
function closeTilted(): void {
  replayMount += 1
  replayMap?.destroy()
  replayMap = null
  tilted.value = false
}

/** Shows the whole Leaflet track after leaving the chase camera. */
function restoreOverview(): void {
  closeTilted()
  void nextTick(() => {
    instance?.recenter()
  })
}

/** Opens the pitched camera over the current point. */
async function mountTilted(): Promise<void> {
  if (replayMap) {
    replayMap.follow(props.points, scrubModel.value, true, props.timesMs)
    return
  }
  if (!open.value) {
    return
  }
  tilted.value = true
  await nextTick()
  const host = replayHost.value
  if (!host || !open.value) {
    tilted.value = false
    return
  }
  const generation = ++replayMount
  const { mountReplayMap } = await import('@/features/activities/replay/mountReplayMap')
  if (generation !== replayMount || !open.value) {
    return
  }
  try {
    const mapHandle = await mountReplayMap(host, {
      points: props.points,
      tileUrl: config.value.map.tileUrl,
      attribution: config.value.map.attribution,
      fraction: scrubModel.value,
      timesMs: props.timesMs,
    })
    if (generation !== replayMount || !open.value) {
      mapHandle.destroy()
      tilted.value = false
      return
    }
    replayMap = mapHandle
    mapHandle.follow(props.points, scrubModel.value, true, props.timesMs)
  } catch (error) {
    replayMap = null
    tilted.value = false
    console.error('Could not open the tilted replay map', error)
  }
}

/** Re-fits the map to the whole track after the user has panned or zoomed. */
function recenter(): void {
  pause()
  restoreOverview()
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
    closeTilted()
  },
)
watch(open, (isOpen) => {
  if (!isOpen) {
    pause()
    restoreOverview()
  }
})
watch(
  () => props.scrubSignal,
  () => {
    if (playing.value) {
      pause()
    }
  },
)
watch(
  () => props.scrubFraction,
  (value) => {
    if (playing.value || value == null) {
      return
    }
    scrubModel.value = value
  },
)

onBeforeUnmount(() => {
  pause()
  closeTilted()
  instance?.destroy()
  instance = null
})
</script>

<template>
  <!-- Fills its parent, which controls the height (e.g. a gallery slide).
       `isolate` creates a stacking context so Leaflet's internal panes and
       controls (z-index up to 1000) stay contained and never paint over the
       sticky navbar (z-40) or bottom nav while scrolling. -->
  <div class="map-clip relative isolate size-full overflow-hidden">
    <div
      ref="container"
      class="size-full"
      role="img"
      :aria-label="$t('activities.map.label')"
      @pointerdown="onMapPointerDown"
    />
    <!-- MapLibre sets `position: relative` on the element it owns. That class
         must not sit on this overlay: it would drop the camera out of the
         frame and leave the flat Leaflet map in view. -->
    <div
      v-if="tilted"
      class="replay-host absolute inset-0 z-[1050]"
      @pointerdown="onMapPointerDown"
    >
      <div ref="replayHost" class="size-full" />
    </div>
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
    <button
      v-if="replay && points.length > 1 && open"
      type="button"
      class="absolute right-3 bottom-3 z-[1100] flex size-10 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-mid"
      :aria-label="$t('activities.replay.close')"
      @click="closePlayer"
    >
      <X class="size-4" />
    </button>
    <button
      v-if="replay && points.length > 1 && !open"
      type="button"
      class="absolute right-3 bottom-3 z-[1100] flex size-10 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-mid"
      :aria-label="$t('activities.replay.play')"
      @click="void play()"
    >
      <Play class="size-4" />
    </button>
    <div
      v-if="replay && points.length > 1 && open"
      class="absolute bottom-6 left-1/2 z-[1100] flex w-[70%] max-w-3xl -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-900/30 px-3 py-2.5 text-white shadow-lg backdrop-blur-sm"
      role="group"
      :aria-label="$t('activities.replay.label')"
    >
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10"
        :aria-label="playing ? $t('activities.replay.pause') : $t('activities.replay.play')"
        @click="playing ? pause() : void play()"
      >
        <Pause v-if="playing" class="size-4" />
        <Play v-else class="size-4" />
      </button>
      <input
        v-model.number="scrubModel"
        type="range"
        min="0"
        max="1"
        step="0.001"
        class="replay-range w-full min-w-0 flex-1 cursor-pointer"
        :style="{ '--replay': played }"
        :aria-label="$t('activities.replay.timeline')"
        :aria-valuemin="0"
        :aria-valuemax="1"
        :aria-valuenow="scrubModel"
        :aria-valuetext="$t('activities.replay.timeline')"
        @input="onSliderInput"
      />
      <button
        type="button"
        class="min-w-12 shrink-0 text-right text-sm font-medium tabular-nums transition-colors hover:text-white/80"
        :aria-label="$t('activities.replay.speed', { speed })"
        @click="cycleSpeed"
      >
        {{ speed }}x
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-clip {
  clip-path: inset(0 round var(--radius-card, 12px));
}

:deep(.leaflet-container) {
  background: transparent;
  overflow: hidden;
  border-radius: var(--radius-card, 12px);
  clip-path: inset(0 round var(--radius-card, 12px));
}

:deep(.leaflet-pane),
:deep(.leaflet-tile-pane),
:deep(.leaflet-map-pane) {
  border-radius: inherit;
}

.replay-host {
  animation: replay-fade-in 0.45s ease;
  background-color: #d8e2eb;
}

@keyframes replay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.replay-host :deep(.maplibregl-map),
.replay-host :deep(.maplibregl-canvas-container),
.replay-host :deep(.maplibregl-canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background-color: #d8e2eb;
}

.replay-host :deep(.maplibregl-ctrl-bottom-right) {
  right: 3.35rem;
  bottom: 0.7rem;
}

.replay-host :deep(.maplibregl-ctrl-attrib) {
  margin: 0;
  min-height: 24px;
  background: rgb(255 255 255 / 0.78);
}

.replay-host :deep(.maplibregl-ctrl-attrib-button) {
  width: 24px;
  height: 24px;
  cursor: pointer;
}

.replay-range {
  appearance: none;
  height: 1.25rem;
  background: transparent;
}

.replay-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    #ffffff var(--replay),
    rgb(161 161 170 / 0.7) var(--replay)
  );
}

.replay-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
}

.replay-range::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: rgb(161 161 170 / 0.7);
}

.replay-range::-moz-range-progress {
  height: 4px;
  border-radius: 9999px;
  background: #ffffff;
}

.replay-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
}
</style>
