# Scrobble System

Controls what project data can be shared publicly. Each project gets a visibility setting (`public`/`unlisted`/`private`). Public repos are auto-detected by verifying remotes against forge APIs.

## Visibility Levels

| Level | Behavior |
|-------|----------|
| `public` | Included in scrobble data exports. Visible to anyone. |
| `unlisted` | Not listed publicly but accessible if you have the link. |
| `private` | Excluded from all scrobble exports. **Default for all projects.** |

## Auto-Detection of Public Repos

The scrobble preview API (`GET /api/scrobble/preview`) auto-detects public repos:

1. Runs `git remote -v` in each project's working directory.
2. Parses remote URLs to identify the forge (GitHub, GitLab/git.unturf.com, Codeberg).
3. Hits the forge's **unauthenticated** API to verify the repo is truly public:
   - **GitHub**: `GET https://api.github.com/repos/{owner}/{repo}` -- 200 = public
   - **GitLab** (git.unturf.com): `GET https://git.unturf.com/api/v4/projects/{encoded_path}` -- 200 = public
   - **Codeberg**: `GET https://codeberg.org/api/v1/repos/{owner}/{repo}` -- 200 = public
4. If verified public, `auto_detected` is set to `public_repo:{web_url}` and visibility auto-set to `public`.

Being hosted on a forge does NOT mean public. Private repos on GitHub return 404 from the unauthenticated API. This prevents false positive "public repo" badges.

## Database

Table: `project_visibility`

| Column | Notes |
|--------|-------|
| `project_id` | UNIQUE FK to projects |
| `visibility` | `public`, `unlisted`, or `private` |
| `auto_detected` | `public_repo:https://github.com/...`, `private_remote`, or NULL |
| `updated_at` | Timestamp of last change |

Manual visibility changes via the UI override auto-detection.

## Scrobble Data Boundaries

### Included

- Project names and display names
- Session counts and date ranges
- Model usage (which models, message counts)
- Token totals per project (input, output)
- Tool call frequencies (tool names + counts)
- Project visibility status

### Excluded (never shared)

- Prompt text and user messages
- Assistant response content
- Thinking blocks
- Tool call arguments and results
- File paths and file contents
- Git commit messages and diffs
- CLAUDE.md contents
- Any PII (already sanitized at ingest)

## API Endpoints

### `GET /api/scrobble/preview`

Returns all projects with visibility, auto-detection results, model summary, tool summary, included/excluded lists.

### `POST /api/projects/{name}/visibility`

Set project visibility. Body: `{ "visibility": "public" | "unlisted" | "private" }`.

## UI

Page: `src/app/scrobble/page.tsx`

- Summary counts: X public, Y unlisted, Z private
- Included/excluded info boxes
- Per-project row with:
  - Display name, visibility badge, "public repo" link (if verified)
  - Session/message/token counts
  - Visibility toggle buttons (public/unlisted/private)
- Model usage summary table
- Tool usage summary grid

## Safety Design

- **Default is private** -- nothing is shared until explicitly set.
- Auto-detection only promotes to public, never demotes manual choices.
- Verification uses unauthenticated API calls -- if we can't see it without auth, it's not public.
- No prompt content, responses, thinking, or tool arguments are ever included in scrobble data.
