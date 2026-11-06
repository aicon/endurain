# Unofficial fork

This is a fork of [Endurain](https://github.com/endurain-project/endurain) v0.20.2. It is not the official project, and it is not endorsed by the Endurain maintainers.

Endurain® is a registered trademark of João Vitória Silva.

Local `master` tracks upstream `master` by rebase. The last sync was 2026-10-31.

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

The summary row shows elapsed time after moving time. Each metric caption has a small icon in front of the label. Open-Meteo weather is a line under the date and device, above the activity title. It is fetched on first open if the import backfill missed it.

The activity map can play the recorded GPS stream. The speed buttons still read 0.5×, 1×, 2×, 4× and 8×; playback itself runs at fifteen times the label. While the player is open the map is a pitched MapLibre chase camera on Esri World Imagery with place labels (Mapterhorn terrain, no API key). Fast straights pull out to a valley panorama; hairpins drop in close. Towns and peaks from Overpass appear as a floating board. The cursor is a heading chevron. Play starts from a flat map and eases into 3D. Closing the player, or reaching the end of the clip, restores the Leaflet overview. Home thumbnails stay Leaflet. This replay is a new feature on the fork. It is not proposed upstream, and it does not call the Relive service.

Proposed upstream:

- Summary cards, the device, and the settlement: [endurain-project/endurain#847](https://github.com/endurain-project/endurain/pull/847)
- Elevation total, the Hungarian altitude label, and the tooltip colors: [endurain-project/endurain#854](https://github.com/endurain-project/endurain/pull/854)
- Gear in the header, and one hover across the charts and the map: [endurain-project/endurain#855](https://github.com/endurain-project/endurain/pull/855)

Replay stays on this repository. Do not put this file or `.github/workflows/fork-image.yml` on those pull requests.

## Temporary image

`ghcr.io/aicon/endurain:0.20.2-place`

Same container layout as upstream v0.20.2, plus the summary-card, device, settlement, elevation-total, altitude-label, tooltip, header-gear, shared chart-cursor, elapsed-time, Open-Meteo weather, metric icons, and in-map replay changes above. Digest `sha256:24ceb54e468de09e8a14b86a2939a43208e3d81174c9a7c2df4a2952649b2f1f` (commit `0f3b79e`, 2026-11-06). Change the compose image tag from `0.20.1-place` to `0.20.2-place`.

It does not replace `ghcr.io/endurain-project/endurain`. Drop this image when you move back to an official release.

Backend lint, backend tests, the documentation site, and the GitLab mirror do not run on this fork. They fail here: the settlement parser uses a private import, this repository has no GitHub Pages site, and it has no GitLab token. OpenAPI drift and the distributed backend tests still run.
