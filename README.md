# RHEX: Royal Home of Excellence Ltd.

Corporate website for Royal Home of Excellence (RHEX), Abuja, Nigeria. www.rhexlimited.org

Plain static HTML, CSS and JavaScript. There is no build step and nothing to install.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Structure

- `index.html`: the single-page site (hero, about, vision/mission, CEO, team, services, case study, why us, projects, contact)
- `assets/css/styles.css`: styles and brand tokens (`:root`), with light and dark themes
- `assets/js/main.js`: theme toggle, particles, scroll reveals, gallery filter and lightbox, and the WhatsApp contact form
- `assets/img/`: logo, team photos and project gallery, all taken from the RHEX corporate profile

## Brand

| Token | Value |
| --- | --- |
| `--orange` | `#F9A01B` |
| `--orange-deep` | `#E49125` |
| `--charcoal` | `#2F323E` |
| `--gold` | `#D4AF37` |

Theme preference is stored in `localStorage` under `rhex-theme`. Without a saved preference, the site follows the system setting.

## Deploy

Any static host works, including GitHub Pages, Netlify and Vercel. Serve the repository root.
