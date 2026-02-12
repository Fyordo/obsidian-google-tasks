# Obsidian Google Tasks

An Obsidian plugin that integrates Google Tasks with your vault. View and manage your tasks directly in your notes.

## Features

- Display Google Tasks in code blocks
- Filter by date range and task list
- Create, complete, edit, and delete tasks
- Markdown formatting support in task titles and notes
- Works on desktop and mobile (Android / iOS)

## Installation

### Development Setup

1. Clone this repository into your Obsidian plugins folder:

   - **macOS**: `~/Library/Application Support/obsidian/Community Plugins/obsidian-google-tasks`
   - **Windows**: `%APPDATA%\Obsidian\Community Plugins\obsidian-google-tasks`

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the plugin:

   ```bash
   npm run build
   ```

4. In Obsidian:
   - Go to **Settings → Community plugins**
   - Enable **Developer mode** (if needed)
   - Enable **Obsidian Google Tasks**

## Google API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable **Google Tasks API**:
   - Navigate to **APIs & Services → Library**
   - Search for "Google Tasks API"
   - Click **Enable**
4. Configure **OAuth consent screen**:
   - Go to **APIs & Services → OAuth consent screen**
   - Choose **External** user type
   - Fill in required fields (app name, support email)
   - Add scope: `https://www.googleapis.com/auth/tasks`
   - Add yourself as a **test user**
5. Create **OAuth 2.0 Client ID**:
   - Go to **APIs & Services → Credentials**
   - Click **Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Copy the **Client ID** and **Client Secret**

### Configure in Obsidian

1. Open **Settings → Obsidian Google Tasks**
2. Paste your **Client ID** and **Client Secret**
3. Click **Sign in with Google**
4. Follow the authorization flow:
   - Click the button to open Google's authorization page
   - Grant permissions
   - Copy the redirect URL from your browser
   - Paste it into the plugin modal

> **Note**: For full functionality (create/edit/delete tasks), the plugin requires the `tasks` scope. If you previously authorized with `tasks.readonly`, sign out and sign in again.

## Usage

### Basic Example

Add a code block to any note:

````markdown
```g-tasks
```
````

This displays tasks from your **default Google Tasks list**.

### Parameters

You can filter tasks using parameters:

```markdown
```g-tasks
list: Work
date: today
completed: all
```
```

**Available parameters:**

- **`list`** — Task list name (case-insensitive) or list ID
- **`date`**:
  - `today` — Today's date
  - `{{filename}}` — Extract date from filename (format: `DD.MM.YYYY.md`)
- **`from` / `to`** — Custom date range (`YYYY-MM-DD HH:MM:SS`)
- **`completed`**:
  - `false` — Only incomplete tasks (default)
  - `true` — Only completed tasks
  - `all` — All tasks

### Examples

**Tasks from a specific list:**

````markdown
```g-tasks
list: Work
```
````

**Tasks for today:**

````markdown
```g-tasks
date: today
completed: false
```
````

**Tasks for a date range:**

````markdown
```g-tasks
from: 2026-02-01 00:00:00
to: 2026-02-28 23:59:59
completed: all
```
````

**Tasks from filename date:**

If your note is named `11.02.2026.md`:

````markdown
```g-tasks
date: {{filename}}
```
````

## Daily Notes Template

For daily notes in `DD.MM.YYYY.md` format, add to your template:

````markdown
## Today's Tasks

```g-tasks
date: {{filename}}
completed: all
```
````

Or for a specific list:

````markdown
## Work Tasks

```g-tasks
list: Work
date: {{filename}}
completed: false
```
````

## Task Interactions

In the rendered task list:

- **Checkbox** — Toggle task completion (syncs with Google Tasks)
- **`+` button** — Create a new task
- **`✎` button** — Edit task (title, notes, date/time)
- **`✕` button** — Delete task (with confirmation)
- **`↗` button** — Open task in Google Tasks (browser or mobile app)

## Markdown Formatting

The plugin supports basic Markdown in task titles and notes:

- **Bold**: `**text**` or `__text__`
- *Italic*: `*text*` or `_text_`
- `Code`: `` `code` ``
- **Internal links**: `[[Note Name]]` — Opens the note in Obsidian
- **External links**: `[text](https://example.com)`

**Example task in Google Tasks:**

```
Read **Obsidian API** docs and update [[Knowledge Base]]
```

Will be rendered with bold text and a clickable internal link.

## Auto Refresh

Enable automatic refresh of all visible `g-tasks` blocks:

1. Open **Settings → Obsidian Google Tasks**
2. Set **Auto refresh** interval (in seconds):
   - `0` — Disabled (default)
   - e.g., `60` — Refresh every minute

All open blocks will update automatically at the specified interval.

## Development

**Watch mode** (auto-rebuild on changes):

```bash
npm run dev
```

**Production build**:

```bash
npm run build
```

## License

MIT
