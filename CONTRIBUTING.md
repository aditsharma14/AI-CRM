# Contributing

How to set up, what the checks are, and how to shape commits and pull requests. Project rules and architecture are in
[CLAUDE.md](CLAUDE.md); the detail behind them (typing, tests, e2e) is in [docs/conventions.md](docs/conventions.md).

## Setup

```sh
npm install                 # repo root: Prettier, husky (installs the pre-commit hook), lint-staged
npm install --prefix backend
npm install --prefix frontend
python -m venv AI/.venv     # then, with that venv's pip:
AI/.venv/Scripts/pip install -r AI/requirements.txt -r AI/requirements-dev.txt   # bin/pip on macOS/Linux
```

The backend needs MongoDB as a replica set (lead conversion runs in a transaction); see CLAUDE.md §6.

## Checks

| Command (repo root) | What it runs |
|---|---|
| `npm run lint` | ESLint in `backend/` and `frontend/` (zero warnings allowed), ruff in `AI/` |
| `npm run typecheck` | `tsc --checkJs` in both packages |
| `npm run format:check` | Prettier, plus `ruff format --check` |
| `npm run format` | Prettier and ruff format, writing |

Tests run per package: `npm test` in `backend/` and `frontend/`, and `npm run e2e` in `frontend/`.

**The pre-commit hook is the local gate.** It runs on staged files only and blocks the commit on any failure: ESLint
(`--fix`, zero warnings) and the package's typecheck for JS, ruff check and format for Python, and Prettier for
everything it knows. Don't bypass it with `--no-verify`; fix what it reports. CI runs the same checks plus the tests.

## Branches

`<type>/<task>-<short-description>`, with the same types as commits, for example `fix/s1.3e-convert-via-create` or
`chore/s1.4-code-quality`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, imperative, lower case, no full
stop, under about 80 characters. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`.

- **One logical change per commit.** A refactor doesn't change behaviour; a fix comes with the test that failed
  before it.
- The body says why, not what the diff already shows.
- Mechanical commits (formatting, import sorting) stay separate and go into
  [.git-blame-ignore-revs](.git-blame-ignore-revs). Enable it once per clone:
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Pull requests

Every change reaches `main` through a pull request; nobody pushes to `main`. A ruleset on `main` enforces it:

- a pull request is required (no direct pushes, no force pushes, no deleting the branch);
- the six CI jobs (`repo`, `ai`, `backend`, `frontend`, `e2e`, `docker`) must pass;
- the only merge method is **Rebase and merge**, so each commit of the branch lands on `main` as written and the
  history stays linear. Keep the branch's commits clean for that reason: they are the history.

Fill in the [template](.github/pull_request_template.md): what, why, how you tested it, screenshots for UI changes.
Keep a PR to one task and its branch short-lived. A bug you find along the way goes into [docs/known-issues.md](docs/known-issues.md), not into
the PR.
