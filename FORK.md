# Unofficial fork

This is a fork of [Endurain](https://github.com/endurain-project/endurain) v0.20.1. It is not the official project, and it is not endorsed by the Endurain maintainers.

Endurain® is a registered trademark of João Vitória Silva.

## What this fork changes

The activity summary cards were omitting aggregates that the activity already stored and that the charts already showed.

- A walk or hike showed heart rate and hid elevation gain.
- A run or ride showed elevation and hid heart rate.
- Windsurf and sailing showed heart rate and hid elevation.

`buildActivityMetrics` now includes average heart rate, max heart rate, and elevation gain when those values are stored. A walk shows both heart rate and elevation. Swimming still has no elevation tile. Empty values, and values hidden by privacy, stay off the card. Gym and strength sessions are unchanged.

The change is proposed upstream in [endurain-project/endurain#847](https://github.com/endurain-project/endurain/pull/847).

## Temporary image

`ghcr.io/aicon/endurain:0.20.1-place`

Same container as upstream v0.20.1, plus the summary-card change above. The activity header shows the recording device between the date and the place when the imported file names one. A village or hamlet is stored as the settlement, so the place reads as the settlement and the country, not the country alone.

It does not replace `ghcr.io/endurain-project/endurain`. Drop this image when you move back to an official release.
