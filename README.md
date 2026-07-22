# Rivals Connections

An interactive Season 9 Marvel Rivals team-up network and six-hero composition builder.

## What it does

- Draws every provider → recipient team-up from the Season 9 data.
- Highlights both incoming and outgoing connections on hover or keyboard focus.
- Ranks the best six-hero teams around any selected released hero.
- Separates exact 2 Vanguard / 2 Duelist / 2 Strategist teams from open-role teams.
- Treats Deadpool as a one-slot flexible role and excludes The Hood from playable teams.
- Exports as a static site for GitHub Pages.

## Run locally

```bash
npm install
npm run dev
```

## Publish on GitHub Pages

Push the project to the `main` branch on GitHub. The included Pages workflow builds and publishes the site automatically. In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Add a season

Season definitions live in `app/data/seasons.ts`. Add the new CSV text and a new entry in the exported `seasons` array. The season selector updates from that array automatically.

The original Season 9 spreadsheet remains in the repository as the reference source.
