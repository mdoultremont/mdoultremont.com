# Repository guide

- Keep deployable applications under `apps/`: the portfolio in `apps/web`
  (`mdoultremont.com`) and the private apps in `apps/tools`
  (`tools.mdoultremont.com`).
- Put code shared by more than one app under `packages/`.
- Run `pnpm dev`, `pnpm check`, and `pnpm build` from the repository root.
- Keep Pages CMS configuration in the repository-root `.pages.yml`. Update it
  when changing files or fields under `apps/web/content`.
- Keep content paths valid from the repository root, which is where Pages CMS
  resolves them.
- Treat the JSON files under `apps/web/content` as production content.

## GitHub issue lifecycle

- When opening a pull request for work created by `to-tickets`, include a `Closes #<number>` line for the parent issue and every completed child ticket. GitHub closes those issues when the pull request merges.
- Keep issue dependency and parent relationships in the issues themselves; use the pull request description for merge-time closing references.

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues. Before issue operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. Before exploring the codebase, read `docs/agents/domain.md`.
