# Unofficial fork of Endurain®

This is a **non-commercial fork** of [Endurain](https://github.com/endurain-project/endurain) v0.20.2, kept under the same AGPL-3.0 license and João Vitória Silva’s trademark rules. It is **not** the official project, it is **not endorsed** by the Endurain maintainers, and it must not be presented as an official service or as paid Endurain hosting.

- Upstream: [endurain-project/endurain](https://github.com/endurain-project/endurain)
- This repository: [aicon/endurain](https://github.com/aicon/endurain)
- Image: `ghcr.io/aicon/endurain:0.20.2-place` (does not replace `ghcr.io/endurain-project/endurain`)
- Docs for the original product: [docs.endurain.com](https://docs.endurain.com)
- Trademark: [`TRADEMARK.md`](./TRADEMARK.md) (kept as the original author published it)

The original README, contributing guide, license, and trademark policy stay in this tree so upstream expectations remain visible. The README opens with the fork notice and a Ko-fi line for the fork author, then a divider. Under that divider is the original description, without the upstream feature-freeze note and without the upstream sponsors. The docs homepage no longer lists those sponsors either. This file is the only place that describes **fork-only** behaviour.

Local `master` tracks upstream `master` by rebase. The last sync was 2026-10-31. This fork is moving toward a long-lived independent repo, still based on Endurain, still crediting the original author.

## What this fork changes

The activity summary cards were omitting aggregates that the activity already stored and that the charts already showed.

- A walk or hike showed heart rate and hid elevation gain.
- A run or ride showed elevation and hid heart rate.
- Windsurf and sailing showed heart rate and hid elevation.

`buildActivityMetrics` now includes average heart rate, max heart rate, and elevation gain when those values are stored. A walk shows both heart rate and elevation. Swimming still has no elevation tile. Empty values, and values hidden by privacy, stay off the card. Gym and strength sessions are unchanged.

The activity header shows the recording device between the date and the place when the imported file names one. A GPX file uses its creator. A TCX file uses Creator/Name. A name that only identifies the exporting program, such as FitBridge, is ignored.

A village or hamlet is stored as the settlement. A row that only had a country is filled in on the next lookup, so the place reads as the settlement and the country.

The home feed card still shows the date and the place. The device is on the activity page.

Elevation gain used to add a sample only when that one sample moved more than 0.1 m. After smoothing, a one-second track climbs about 0.04 m per sample, so a real hill became 0 m while the chart still showed it. A slow descent was cut the same way. The 0.1 m limit is now the climb or drop since the last counted point. A slow rise and a slow drop are kept. A wobble smaller than 0.1 m is still ignored. Laps use the same total. An activity imported earlier keeps the old total until its file is imported again.

The elevation chart series is the altitude at that point. English already says "Elevation". Hungarian said "Szintemelkedés", which is the gain, so a hover of 131 m read as a climb of 131 m. The series is now "Magasság". "Szintemelkedés" and "Szintcsökkenés" stay on the gain and the loss. The hover box uses the card colors instead of the Chart.js black box.

Gear used to be a full card between the map and the charts: a heading, an empty-state sentence, and one button. That split the route from the charts. The same add, change, and remove actions now sit in the header, on the right of the name and the date, and only for the owner. A walk or a run shows the shoe mark, a ride shows a bike. The three-dot menu stays at the top right, level with the name, on a phone as well.

On a phone the map sticks under the top bar while the page scrolls, and the charts slide underneath it. The chart hover still moves the point on that map.

Hovering one chart draws the same moment on the other charts and moves a point along the route. Hovering the route moves the chart lines. The line is an HTML overlay and the map point only changes position, so the charts are not redrawn on each move.

The summary row shows elapsed time after moving time. Each metric caption has a small icon in front of the label.

Open-Meteo weather sits under the date and device, above the activity title. It is fetched on import and again on first open if the backfill missed it. The row uses coloured condition, humidity, and wind icons. Condition, “humidity”, and compass labels come from the locale files (English, Hungarian, and the other bundled languages via English fallback).

On the activity detail page the chart grid is heart rate, altitude, heart-rate zones, then pace or speed and the rest.

The owner three-dot menu on the activity page and the home card includes **Download activity** (`Tevékenység letöltése`). It returns the retained import file (GPX, TCX, or FIT) when Endurain still has it, otherwise a GPX 1.1 rebuilt from stored streams (track, elevation, heart rate, cadence, calories). Photos are not included.

On a phone in portrait, the home page shows only the Goals card before the activity list. Add activity, the mine/following tabs, and the calendar are not rendered on that view. Landscape phones, tablets, and desktop keep the original three-column layout.

The center column shows the mine/following tabs, then a month calendar with a bordered day grid, then the first activity. Saturday and Sunday cells are `#F5F5F5`. The current day is `#EFF1F3`. The current month opens by default, and the arrows step to other months. The first column follows the profile setting **First day of the week** (Saját profil → A hét első napja), which defaults to Monday and can be Sunday. A day with an activity shows that activity's type icon (a hike uses a mountain, a walk uses footprints, a ride uses a bike). The icon opens the activity.

The GPS track polyline on Leaflet maps, home/detail thumbnails, and the replay route line is another 25% thinner. Already-rendered thumbnails keep the previous width until that activity is imported again.

On the activity map the start is a small green play button and the finish is a small checkered disc. The hover point is drawn above both. The home-list thumbnails use the same two icons; stored thumbnails are redrawn once after the server starts.

The activity map can play the recorded GPS stream. The speed buttons still read 0.5×, 1×, 2×, 4× and 8×; playback itself runs at fifteen times the label. While the player is open the map is a pitched MapLibre chase camera on Esri World Imagery with place labels (Mapterhorn terrain, no API key). Fast straights pull out to a valley panorama; hairpins drop in close. Towns and peaks from Overpass appear as a floating board. The cursor is a heading chevron. Play starts from a flat map and eases into 3D. Closing the player, or reaching the end of the clip, restores the Leaflet overview. Home thumbnails stay Leaflet. This replay is a new feature on the fork. It is not proposed upstream, and it does not call the Relive service.

Proposed upstream:

- Summary cards, the device, and the settlement: [endurain-project/endurain#847](https://github.com/endurain-project/endurain/pull/847)
- Elevation total, the Hungarian altitude label, and the tooltip colors: [endurain-project/endurain#854](https://github.com/endurain-project/endurain/pull/854)
- Gear in the header, and one hover across the charts and the map: [endurain-project/endurain#855](https://github.com/endurain-project/endurain/pull/855)

Replay stays on this repository. Do not put this file or `.github/workflows/fork-image.yml` on those pull requests.

## Temporary image

`ghcr.io/aicon/endurain:0.20.2-place`

Same container layout as upstream v0.20.2, plus the summary-card, device, settlement, elevation-total, altitude-label, tooltip, header-gear, shared chart-cursor, elapsed-time, Open-Meteo weather, metric icons, Dreeve-style weather row, HR-first chart order, owner activity download, portrait Goals-only home, center activity calendar, thinner GPS tracks, smaller play-button start and checkered finish on the map and the list thumbnails, and in-map replay changes above. Digest `sha256:708a953d86751aa079027a9d8ac56f4ca7898b77cef862226264ebd0f5756ed3` (commit `8cb272a47`, release `0.20.2-place`, 2026-11-06). Change the compose image tag from `0.20.1-place` to `0.20.2-place`. `:latest` is not this release.

It does not replace `ghcr.io/endurain-project/endurain`. Drop this image when you move back to an official release.

## CI on this fork

Frontend lint (Prettier, oxlint, ESLint, vue-tsc, unit tests), OpenAPI type drift, and the distributed backend tests run here on `master`.

Backend unit tests, backend ruff, the documentation site, and the GitLab mirror stay skipped on this repository, as they do on purpose:

- The settlement parser still uses a JASIL private import that João’s architecture test forbids. That change is in the upstream PRs; it is not rewritten here just to green a skip.
- This repository has no GitHub Pages site for `docs.endurain.com`.
- This repository has no GitLab mirror token. João’s official mirror stays on the upstream project.
