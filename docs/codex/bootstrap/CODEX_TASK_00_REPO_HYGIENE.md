# Codex Task 00 — прибрати generated context noise

## Mode

Implementation. This is repository hygiene only; do not change product behavior.

## Goal

Reduce future Codex context, Git diff noise and repository size by stopping generated Playwright/browser-audit outputs from being tracked while preserving reusable source scripts and the compact human audit summary.

## Read first

```text
AGENTS.md
.gitignore
package.json
apps/web/package.json
apps/web/playwright.config.ts
docs/frontend-browser-audit.md
output/playwright/
.playwright-cli/
```

Inspect only filenames and small metadata in generated directories. Do not read every YAML or image.

## Required work

1. Inventory tracked files under:
   ```text
   .playwright-cli/
   output/playwright/
   apps/web/artifacts/
   apps/web/test-results/
   ```
2. Separate reusable source scripts from generated output.
3. If reusable audit scripts currently live under `output/`, move only those scripts to a stable source directory such as:
   ```text
   apps/web/scripts/browser-audit/
   ```
4. Remove generated YAML snapshots, screenshots, reports, temporary JSON and CLI state from Git tracking.
5. Add appropriate ignore rules:
   ```gitignore
   .playwright-cli/
   **/.playwright-cli/
   **/playwright-cli.json
   output/
   ```
   Keep existing ignores.
6. Update any command in `docs/frontend-browser-audit.md` that points to a moved reusable script.
7. Do not delete or ignore:
   ```text
   artifacts/openapi.json
   artifacts/feed-rehearsal-representative.json
   docs/frontend-browser-audit.md
   ```
   unless you find a concrete reason and report it before changing.
8. Do not modify application source, Prisma schema, migrations, seed data or tests.

## Safety

- Use `git ls-files` to distinguish tracked from untracked files.
- Do not run a repository-wide browser audit.
- Do not regenerate screenshots.
- Do not rewrite Git history.
- Removing files from the current Git index is allowed; history cleanup is out of scope.

## Validation budget

Run only:

```bash
git status --short
git diff --check
git check-ignore -v .playwright-cli/example.yml output/playwright/example.png
```

If a reusable script was moved, run only its `--help` or syntax check. Do not run full E2E.

## Completion output

Return:

1. number of generated tracked files removed by category;
2. reusable scripts moved;
3. ignore rules added;
4. docs links updated;
5. validation results.
