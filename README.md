> [!NOTE]
> **This repository is an unofficial fork** of [endurain-project/endurain](https://github.com/endurain-project/endurain) at v0.20.2. It is **not** the official Endurain project and is **not endorsed** by the Endurain maintainers. What this fork adds is listed in [FORK.md](./FORK.md). Endurain® is a registered trademark of João Vitória Silva. See [`TRADEMARK.md`](./TRADEMARK.md).

<div align="center">

## If you like the new features and fixes in this fork, you can support my development work directly here: [Ko-fi](https://ko-fi.com/aiconwg). Thank you for keeping this version alive!

<a href="https://ko-fi.com/aiconwg"><img height="56" src="https://storage.ko-fi.com/cdn/kofi2.png?v=6" alt="Ko-fi"></a>

</div>

<img src="logo/section-rule.svg" alt="" width="100%" height="8">

<div align="center">
  <img src="logo/brand_logo_dark_theme.png" width="128" height="128">

  # Endurain

  <a href="https://translate.codeberg.org/engage/endurain/"><img src="https://translate.codeberg.org/widget/endurain/svg-badge.svg" alt="Translation status"></a>
  [![License](https://img.shields.io/badge/license-AGPL%20v3-blue)](./LICENSE)
  [![Release](https://img.shields.io/github/v/release/endurain-project/endurain?label=release&color=blue)](https://github.com/endurain-project/endurain/releases)
  [![Stars](https://img.shields.io/github/stars/endurain-project/endurain?label=stars&logo=github)](https://github.com/endurain-project/endurain)
  [![Trademark Policy](https://img.shields.io/badge/trademark-Endurain%E2%84%A2-blue)](./TRADEMARK.md)

  **A self-hosted fitness tracking service**  
  Visit Endurain's [Mastodon profile](https://fosstodon.org/@endurain), [Bluesky profile](https://bsky.app/profile/endurain.bsky.social), [Discord server](https://discord.gg/6VUjUq2uZR) and [LinkedIn page](https://www.linkedin.com/company/endurain).

  <img src="screenshot_01.png" alt="Endurain Screenshot">
</div>

## 🚀 Try the Demo

Experience Endurain without installation:

**Demo URL:** [https://demo.endurain.com](https://demo.endurain.com)

- **Username:** `admin`
- **Password:** `admin`
- **Reset Schedule:** Daily at midnight (Europe/Lisbon timezone)

> ⚠️ **Note:** The demo environment resets every day. Do not store important data.

## Table of Contents

- [Endurain documentation](https://docs.endurain.com)
- [What is Endurain?](#what-is-endurain)
- [Endurain screenshots](https://docs.endurain.com/gallery/)
- [Contributing](#contributing)
- [Help Translate](#help-translate)
- [License](#license)

## What is Endurain?

Endurain is a self-hosted fitness tracking service designed to give users full control over their data and hosting environment. It's similar to Strava but focused on privacy and customization. Built with:

- **Frontend:** Vue.js 3 with TypeScript, Tailwind CSS and shadcn-vue components, with Pinia and TanStack Query for state management
- **Backend:** Python FastAPI, Alembic, SQLAlchemy, stravalib and python-garminconnect for Strava and Garmin Connect integration, gpxpy, tcxreader and fitdecode for .gpx, .tcx and .fit file import respectively
- **Database:** PostgreSQL for efficient data management
- **Integrations:** Supports Strava and Garmin Connect. Manual upload of activities using .gpx, .tcx and .fit files are also supported

To deploy Endurain, a Docker image is available, and a comprehensive example can be found in the "docker-compose.yml.example" file provided. Configuration is facilitated through environment variables, ensuring flexibility and ease of customization.

For more information please see the Endurain's [documentation](https://docs.endurain.com).

## Contributing

Contributions are welcomed! Please open an issue to discuss any changes or improvements before submitting a PR. Check out the [Contributing Guidelines](CONTRIBUTING.md) for more details.

## Help Translate

Endurain has multi-language support, and you can help translate it into more languages via [Codeberg Translate](https://translate.codeberg.org/projects/endurain/). 

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Trademark Notice

Endurain® is a trademark of João Vitória Silva.  

You are welcome to self-host Endurain and use the name and logo, including for personal, educational, research, or community (non-commercial) use.  
Commercial use of the Endurain name or logos (such as offering paid hosting, products, or services) is **not permitted without prior written permission**.

See [`TRADEMARK.md`](./TRADEMARK.md) for full details.

<div align="center">
  <sub>Built with ❤️ from Portugal | Part of the <a href="https://github.com/endurain-project">Endurain</a> ecosystem</sub>
</div>