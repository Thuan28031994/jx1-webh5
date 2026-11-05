# Deploy production — thuanlam.qzz.io

Single deploy path: the GitHub Actions workflow
`.github/workflows/deploy-thuanlam-pages.yml` builds from source, runs the
Playwright regression suite on the packaged artifact, and direct-uploads it
with Wrangler to Cloudflare Pages project `vli-thuan-2026`
(`thuanlam.qzz.io`). See `docs/CLOUDFLARE-PAGES-AUTO-DEPLOY.md` for the full
procedure.

## Never re-enable the Pages GitHub integration

The Cloudflare Pages project must NOT be linked to GitHub with automatic
deployments. Its build command and output directory are empty, so a linked
deploy publishes the repository root unchanged: `/` returns 404 and the
game files sit unreachable under `/game/`. That is exactly what took
production down 2026-10-23 → 2026-11-05 (13 days): the linked deploy
finished after the workflow upload and took over production.

Keep `deployments_enabled` and `production_deployments_enabled` false on the
project (set via the Cloudflare API). One deploy path only. Re-running the
workflow alone does not heal a linked takeover, because the linked deploy
finishes in ~30 seconds while the workflow takes minutes.
