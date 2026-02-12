import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginManifest,
  PluginSettingTab,
  Setting,
  MarkdownPostProcessorContext,
} from "obsidian";
import { GoogleAuth, TokenData } from "./google-auth";
import { GoogleTasksApi, GoogleTask, TaskNode } from "./google-tasks-api";

/* ================================================================
   Settings
   ================================================================ */

interface PluginSettings {
  clientId: string;
  clientSecret: string;
  tokens: TokenData | null;
  autoRefreshInterval: number; // seconds, 0 = disabled
}

const DEFAULT_SETTINGS: PluginSettings = {
  clientId: "",
  clientSecret: "",
  tokens: null,
  autoRefreshInterval: 0,
};

/* ================================================================
   Plugin
   ================================================================ */

export default class ObsidianGoogleTasksPlugin extends Plugin {
  settings: PluginSettings;
  auth: GoogleAuth;
  api: GoogleTasksApi;
  private autoRefreshIntervalId: number | null = null;
  private activeBlocks: Map<HTMLElement, { source: string; ctx: MarkdownPostProcessorContext }> = new Map();

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    await this.loadSettings();

    this.auth = new GoogleAuth(this.settings.clientId, this.settings.clientSecret);
    if (this.settings.tokens) {
      this.auth.setTokens(this.settings.tokens);
    }
    this.api = new GoogleTasksApi(this.auth);

    /* ---- code-block processor: ```g-tasks ---- */
    this.registerMarkdownCodeBlockProcessor(
      "g-tasks",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.renderTasksBlock(source.trim(), el, ctx);
      },
    );

    /* ---- ribbon icon ---- */
    this.addRibbonIcon("check-in-circle", "Google Tasks: refresh", async () => {
      new Notice("Google Tasks: refreshing all open blocks…");
      // Re-render by triggering workspace layout refresh
      this.app.workspace.updateOptions();
    });

    /* ---- settings tab ---- */
    this.addSettingTab(new GoogleTasksSettingTab(this.app, this));

    /* ---- start auto-refresh if enabled ---- */
    this.startAutoRefresh();
  }

  onunload() {
    this.stopAutoRefresh();
  }

  /* ---- settings persistence ---- */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Persist current tokens into the settings file */
  async persistTokens() {
    this.settings.tokens = this.auth.getTokens();
    await this.saveSettings();
  }

  /* ---- auto-refresh ---- */

  startAutoRefresh() {
    this.stopAutoRefresh();
    
    if (this.settings.autoRefreshInterval <= 0) {
      return; // auto-refresh disabled
    }

    const intervalMs = this.settings.autoRefreshInterval * 1000;
    this.autoRefreshIntervalId = window.setInterval(() => {
      this.refreshAllBlocks();
    }, intervalMs);
  }

  stopAutoRefresh() {
    if (this.autoRefreshIntervalId !== null) {
      window.clearInterval(this.autoRefreshIntervalId);
      this.autoRefreshIntervalId = null;
    }
  }

  refreshAllBlocks() {
    for (const [el, { source, ctx }] of this.activeBlocks.entries()) {
      this.renderTasksBlock(source, el, ctx);
    }
  }

  /* ==============================================================
     Render the ```g-tasks block
     ============================================================== */

  private async renderTasksBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ) {
    // Register this block for auto-refresh
    this.activeBlocks.set(el, { source, ctx });

    el.empty();
    const container = el.createDiv({ cls: "ogt-container" });

    /* ---- not configured ---- */
    if (!this.settings.clientId || !this.settings.clientSecret) {
      container.createDiv({ cls: "ogt-auth-prompt" }).innerHTML =
        "Google Tasks не настроен.<br>Откройте <b>Настройки → Obsidian Google Tasks</b> и введите Client ID / Client Secret.";
      return;
    }

    /* ---- not authenticated ---- */
    if (!this.auth.isAuthenticated()) {
      container.createDiv({ cls: "ogt-auth-prompt" }).innerHTML =
        "Вы не авторизованы.<br>Откройте <b>Настройки → Obsidian Google Tasks</b> и нажмите «Войти через Google».";
      return;
    }

    /* ---- parse block parameters ---- */
    const params = parseBlockParams(source, ctx.sourcePath);

    /* ---- loading ---- */
    const loadingEl = container.createDiv({ cls: "ogt-loading" });
    loadingEl.innerHTML = '<span class="ogt-spinner"></span> Загрузка задач…';

    try {
      /* ---- resolve list ID ---- */
      let targetListId = "@default";
      let listTitle = "Google Tasks";

      if (params.listId) {
        // Fetch all lists to resolve name → ID
        const allLists = await this.api.getTaskLists();
        
        // Try exact ID match first
        let foundList = allLists.find((l) => l.id === params.listId);
        
        // If not found, try case-insensitive name match
        if (!foundList) {
          const lowerQuery = params.listId.toLowerCase();
          foundList = allLists.find((l) => l.title.toLowerCase() === lowerQuery);
        }

        if (foundList) {
          targetListId = foundList.id;
          listTitle = foundList.title;
        } else {
          // List not found — show error
          container.empty();
          container.createDiv({
            cls: "ogt-error",
            text: `Список "${params.listId}" не найден`,
          });
          return;
        }
      }

      /* ---- fetch tasks ---- */
      // Always fetch all tasks (including completed) from API
      let tasks = await this.api.getTasks(targetListId, true);

      /* ---- filter by completion status ---- */
      if (params.showCompleted === "false") {
        // Show only incomplete tasks
        tasks = tasks.filter((task) => task.status !== "completed");
      } else if (params.showCompleted === "true") {
        // Show only completed tasks
        tasks = tasks.filter((task) => task.status === "completed");
      }
      // else "all" — show everything

      /* ---- filter by date range ---- */
      if (params.from || params.to) {
        tasks = tasks.filter((task) => {
          if (!task.due) return false; // skip tasks without due date
          const dueDate = new Date(task.due);
          if (params.from && dueDate < params.from) return false;
          if (params.to && dueDate > params.to) return false;
          return true;
        });
      }

      container.empty();

      /* header */
      const header = container.createDiv({ cls: "ogt-header" });
      let titleText = listTitle;
      if (params.from || params.to) {
        titleText += " (фильтр)";
      }
      header.createSpan({ cls: "ogt-title", text: titleText });

      const actionsEl = header.createDiv({ cls: "ogt-header-actions" });

      const addBtn = actionsEl.createEl("button", {
        cls: "ogt-add-btn",
        text: "+",
      });
      addBtn.setAttr("aria-label", "Создать задачу");
      addBtn.addEventListener("click", () => {
        new AddTaskModal(this.app, this, targetListId, params, () => {
          this.renderTasksBlock(source, el, ctx);
        }).open();
      });

      const refreshBtn = actionsEl.createEl("button", {
        cls: "ogt-refresh-btn",
        text: "↻ Обновить",
      });
      refreshBtn.addEventListener("click", () => this.renderTasksBlock(source, el, ctx));

      /* empty */
      if (tasks.length === 0) {
        container.createDiv({ cls: "ogt-empty", text: "Нет задач" });
        return;
      }

      /* build tree & render */
      const tree = GoogleTasksApi.buildTree(tasks);
      const list = container.createEl("div", { cls: "ogt-list" });
      this.renderNodes(list, tree, 0, targetListId);

      // persist tokens in case they were refreshed
      await this.persistTokens();
    } catch (err: unknown) {
      container.empty();
      const msg = err instanceof Error ? err.message : String(err);
      container.createDiv({ cls: "ogt-error", text: `Ошибка: ${msg}` });
    }
  }

  /** Attach click handlers to internal links */
  private attachLinkHandlers(el: HTMLElement) {
    const links = el.querySelectorAll("a.internal-link");
    links.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const href = link.getAttribute("data-href");
        if (href) {
          // Open the note in Obsidian
          this.app.workspace.openLinkText(href, "", false);
        }
      });
    });
  }

  /** Recursively render task tree nodes */
  private renderNodes(parentEl: HTMLElement, nodes: TaskNode[], depth: number, listId: string) {
    for (const node of nodes) {
      const { task } = node;

      // skip tasks with empty titles (Google sometimes returns empty items)
      if (!task.title?.trim()) continue;

      const row = parentEl.createDiv({ cls: "ogt-task" });
      row.dataset.depth = String(depth);

      /* checkbox */
      const cb = row.createEl("input", { cls: "ogt-checkbox" }) as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = task.status === "completed";
      
      // Make checkbox interactive
      cb.addEventListener("change", async (e) => {
        const newChecked = cb.checked;
        const oldStatus = task.status;
        
        cb.disabled = true; // Disable during API call
        
        try {
          await this.api.updateTaskStatus(listId, task.id, newChecked);
          
          // Update local state
          task.status = newChecked ? "completed" : "needsAction";
          
          // Update visual state
          if (newChecked) {
            titleEl.addClass("is-completed");
          } else {
            titleEl.removeClass("is-completed");
          }
          
          new Notice(newChecked ? "Задача выполнена" : "Задача возобновлена");
        } catch (err: unknown) {
          // Revert on error
          cb.checked = oldStatus === "completed";
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Ошибка: ${msg}`, 5000);
        } finally {
          cb.disabled = false;
        }
      });

      /* body */
      const body = row.createDiv({ cls: "ogt-task-body" });

      const titleEl = body.createDiv({ cls: "ogt-task-title" });
      if (task.status === "completed") titleEl.addClass("is-completed");
      titleEl.innerHTML = parseSimpleMarkdown(task.title);
      this.attachLinkHandlers(titleEl);

      /* notes */
      if (task.notes) {
        const notesEl = body.createDiv({ cls: "ogt-task-notes" });
        notesEl.innerHTML = parseSimpleMarkdown(task.notes);
        this.attachLinkHandlers(notesEl);
      }

      /* due date */
      if (task.due) {
        const dueDate = new Date(task.due);
        const dueEl = body.createDiv({ cls: "ogt-task-due" });
        dueEl.textContent = formatDate(dueDate);
        if (task.status !== "completed" && dueDate < new Date()) {
          dueEl.addClass("is-overdue");
        }
      }

      /* open button */
      const openBtn = row.createEl("button", { cls: "ogt-open-btn" });
      openBtn.innerHTML = "↗";
      openBtn.title = "Открыть в Google Tasks";
      openBtn.addEventListener("click", () => {
        const url = `https://tasks.google.com/task/${encodeURIComponent(task.id)}?list=${encodeURIComponent(listId)}`;
        window.open(url, "_blank");
      });

      /* delete button */
      const deleteBtn = row.createEl("button", { cls: "ogt-delete-btn" });
      deleteBtn.innerHTML = "✕";
      deleteBtn.title = "Удалить задачу";
      deleteBtn.addEventListener("click", async () => {
        const confirmed = window.confirm(`Удалить задачу "${task.title}"?`);
        if (!confirmed) return;

        deleteBtn.setAttr("disabled", "true");

        try {
          await this.api.deleteTask(listId, task.id);
          new Notice("Задача удалена.");
          // Убираем строку из интерфейса
          row.detach();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`Ошибка при удалении: ${msg}`, 5000);
          deleteBtn.removeAttribute("disabled");
        }
      });

      /* subtasks */
      if (node.children.length > 0) {
        this.renderNodes(parentEl, node.children, depth + 1, listId);
      }
    }
  }
}

/* ================================================================
   Block parameter parsing
   ================================================================ */

interface BlockParams {
  from?: Date;
  to?: Date;
  listId?: string;
  showCompleted?: "all" | "true" | "false";
}

/**
 * Parse block parameters from the source text.
 * Supports:
 *   from: 2026-01-01 00:00:00
 *   to: 2026-01-01 23:59:59
 *   date: {{filename}}  — auto-extract date from filename (DD.MM.YYYY.md)
 *   date: today         — use today's date
 *   list: My List Name  — filter by list name or ID
 *   completed: all/true/false — filter completed tasks (default: false)
 */
function parseBlockParams(source: string, filePath: string): BlockParams {
  const params: BlockParams = {
    showCompleted: "false", // default: hide completed tasks
  };

  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "key: value"
    const match = trimmed.match(/^(from|to|date|list|completed)\s*:\s*(.+)$/i);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (key === "list") {
      // Store list name/id for later resolution
      params.listId = value;
    } else if (key === "completed") {
      // Parse completed mode
      const lower = value.toLowerCase();
      if (lower === "all" || lower === "both") {
        params.showCompleted = "all";
      } else if (lower === "true" || lower === "yes" || lower === "1") {
        params.showCompleted = "true";
      } else {
        params.showCompleted = "false";
      }
    } else if (key === "date") {
      // Special handling for "date" parameter
      let targetDate: Date | null = null;

      if (value === "{{filename}}" || value === "filename") {
        // Extract date from filename (DD.MM.YYYY.md format)
        targetDate = extractDateFromFilename(filePath);
      } else if (value === "today") {
        targetDate = new Date();
      } else {
        // Try parsing as explicit date
        targetDate = parseFlexibleDate(value);
      }

      if (targetDate) {
        // Set from/to to cover the entire day
        params.from = new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate(),
          0,
          0,
          0,
        );
        params.to = new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate(),
          23,
          59,
          59,
        );
      }
    } else {
      // Regular from/to parsing
      const date = parseFlexibleDate(value);
      if (!date) continue;

      if (key === "from") {
        params.from = date;
      } else if (key === "to") {
        params.to = date;
      }
    }
  }

  return params;
}

/**
 * Extract date from filename in format DD.MM.YYYY.md
 * Example: "11.02.2026.md" → Date(2026, 1, 11)
 */
function extractDateFromFilename(filePath: string): Date | null {
  // Get just the filename without path
  const filename = filePath.split("/").pop() || filePath;

  // Match DD.MM.YYYY pattern
  const match = filename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  // Validate ranges
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  // Month is 0-indexed in JS Date
  return new Date(year, month - 1, day);
}

/**
 * Parse a flexible date string.
 * Supports:
 *   - ISO: 2026-01-01T00:00:00
 *   - Human: 2026-01-01 00:00:00
 *   - Date only: 2026-01-01 (assumes 00:00:00)
 */
function parseFlexibleDate(str: string): Date | null {
  // Replace space with 'T' for ISO parsing
  const normalized = str.replace(/\s+/g, "T").replace(/T(\d{2}):(\d{2}):(\d{2})/, "T$1:$2:$3");
  const date = new Date(normalized);
  if (!isNaN(date.getTime())) {
    return date;
  }
  return null;
}

/* ================================================================
   Markdown parsing
   ================================================================ */

/**
 * Parse simple Markdown formatting and return HTML string.
 * Supports:
 *   - **bold** or __bold__
 *   - *italic* or _italic_
 *   - [[wikilink]]
 *   - [link text](url)
 *   - `code`
 */
function parseSimpleMarkdown(text: string): string {
  let result = text;

  // Escape HTML first
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_ (but not inside words)
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");

  // Wikilinks: [[Page Name]]
  result = result.replace(/\[\[(.+?)\]\]/g, (match, linkText) => {
    return `<a class="internal-link" data-href="${linkText}">${linkText}</a>`;
  });

  // Markdown links: [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, (match, text, url) => {
    return `<a href="${url}" class="external-link" target="_blank" rel="noopener">${text}</a>`;
  });

  // Inline code: `code`
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");

  return result;
}

/* ================================================================
   Date / time formatting helpers
   ================================================================ */

/**
 * Check whether the ISO date string carries a meaningful time
 * (i.e. the UTC hours/minutes are not both zero).
 * Google Tasks API sets time to 00:00:00Z for date-only tasks,
 * but includes real time when the user sets one in the app.
 */
function hasTimeComponent(date: Date): boolean {
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
}

function formatDate(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  let datePart: string;

  if (diffDays === 0) datePart = "Сегодня";
  else if (diffDays === 1) datePart = "Завтра";
  else if (diffDays === -1) datePart = "Вчера";
  else {
    datePart = date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }

  if (hasTimeComponent(date)) {
    const timePart = date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${datePart}, ${timePart}`;
  }

  return datePart;
}

/* ================================================================
   Auth Code Modal — the user pastes the redirect URL here
   ================================================================ */

class AuthCodeModal extends Modal {
  private plugin: ObsidianGoogleTasksPlugin;
  private onSuccess: () => void;

  constructor(app: App, plugin: ObsidianGoogleTasksPlugin, onSuccess: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSuccess = onSuccess;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Авторизация Google Tasks" });

    contentEl.createEl("p", {
      text: "1. Нажмите кнопку ниже — откроется страница авторизации Google.",
    });
    contentEl.createEl("p", {
      text: '2. Разрешите доступ. После этого браузер перенаправит вас на страницу, которая не загрузится (это нормально!).',
    });
    contentEl.createEl("p", {
      text: "3. Скопируйте URL из адресной строки браузера и вставьте сюда:",
    });

    /* open auth URL button */
    const openBtn = contentEl.createEl("button", {
      text: "Открыть страницу авторизации Google",
      cls: "mod-cta",
    });
    openBtn.style.marginBottom = "16px";
    openBtn.addEventListener("click", () => {
      window.open(this.plugin.auth.getAuthUrl());
    });

    /* input for redirect URL */
    const input = contentEl.createEl("textarea") as HTMLTextAreaElement;
    input.placeholder = "Вставьте URL или код сюда…";
    input.style.width = "100%";
    input.style.minHeight = "60px";
    input.style.marginBottom = "12px";
    input.style.fontFamily = "var(--font-monospace)";
    input.style.fontSize = "0.85em";

    const statusEl = contentEl.createDiv();

    /* submit */
    const submitBtn = contentEl.createEl("button", {
      text: "Подтвердить",
      cls: "mod-cta",
    });
    submitBtn.addEventListener("click", async () => {
      const rawValue = input.value.trim();
      if (!rawValue) {
        statusEl.textContent = "Вставьте URL или код.";
        statusEl.style.color = "var(--text-error)";
        return;
      }

      statusEl.textContent = "Обмен кода на токен…";
      statusEl.style.color = "var(--text-muted)";

      try {
        const code = GoogleAuth.extractCodeFromRedirectUrl(rawValue);
        await this.plugin.auth.exchangeCode(code);
        await this.plugin.persistTokens();

        new Notice("Google Tasks: авторизация прошла успешно!");
        this.onSuccess();
        this.close();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        statusEl.textContent = `Ошибка: ${msg}`;
        statusEl.style.color = "var(--text-error)";
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ================================================================
   Add Task Modal
   ================================================================ */

class AddTaskModal extends Modal {
  private plugin: ObsidianGoogleTasksPlugin;
  private listId: string;
  private params: BlockParams;
  private onCreated: () => void;

  constructor(
    app: App,
    plugin: ObsidianGoogleTasksPlugin,
    listId: string,
    params: BlockParams,
    onCreated: () => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.listId = listId;
    this.params = params;
    this.onCreated = onCreated;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Новая задача Google Tasks" });

    const titleInput = contentEl.createEl("input", {
      type: "text",
    }) as HTMLInputElement;
    titleInput.placeholder = "Название задачи";
    titleInput.style.width = "100%";
    titleInput.style.marginBottom = "8px";

    // Date input
    const dateInput = contentEl.createEl("input", {
      type: "date",
    }) as HTMLInputElement;
    dateInput.style.width = "100%";
    dateInput.style.marginBottom = "6px";

    // Pre-fill date from current filter or today
    const baseDate = this.params.from ?? new Date();
    const yyyy = baseDate.getFullYear();
    const mm = String(baseDate.getMonth() + 1).padStart(2, "0");
    const dd = String(baseDate.getDate()).padStart(2, "0");
    dateInput.value = `${yyyy}-${mm}-${dd}`;

    // Time input (optional)
    const timeInput = contentEl.createEl("input", {
      type: "time",
    }) as HTMLInputElement;
    timeInput.style.width = "100%";
    timeInput.style.marginBottom = "8px";

    const notesInput = contentEl.createEl("textarea") as HTMLTextAreaElement;
    notesInput.placeholder = "Описание (необязательно)";
    notesInput.style.width = "100%";
    notesInput.style.minHeight = "60px";
    notesInput.style.marginBottom = "12px";

    const infoEl = contentEl.createDiv({ cls: "setting-item-description" });
    infoEl.textContent =
      "Выберите дату и (опционально) время для новой задачи. По умолчанию используется дата текущего фильтра (или сегодня).";

    const statusEl = contentEl.createDiv();

    const btnRow = contentEl.createDiv();
    btnRow.style.display = "flex";
    btnRow.style.justifyContent = "flex-end";
    btnRow.style.gap = "8px";

    const cancelBtn = btnRow.createEl("button", { text: "Отмена" });
    cancelBtn.addEventListener("click", () => this.close());

    const createBtn = btnRow.createEl("button", {
      text: "Создать",
      cls: "mod-cta",
    });

    createBtn.addEventListener("click", async () => {
      const title = titleInput.value.trim();
      const notes = notesInput.value.trim();

      if (!title) {
        statusEl.textContent = "Введите название задачи.";
        statusEl.style.color = "var(--text-error)";
        return;
      }

      createBtn.setAttr("disabled", "true");
      cancelBtn.setAttr("disabled", "true");
      statusEl.textContent = "Создание задачи…";
      statusEl.style.color = "var(--text-muted)";

      try {
        let due: string | undefined;
        const dateStr = dateInput.value.trim();
        const timeStr = timeInput.value.trim();

        if (dateStr) {
          const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
          if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
            let hours: number;
            let minutes: number;
            if (timeStr) {
              const [h, min] = timeStr.split(":").map((v) => parseInt(v, 10));
              if (!Number.isNaN(h) && !Number.isNaN(min)) {
                hours = h;
                minutes = min;
              } else {
                // Если время указано криво — fallback на полдень
                hours = 12;
                minutes = 0;
              }
            } else {
              // Без времени: используем полдень, чтобы избежать сдвига даты из‑за часовых поясов
              hours = 12;
              minutes = 0;
            }
            // Локальное время пользователя → ISO (RFC3339) для Google Tasks
            const local = new Date(y, m - 1, d, hours, minutes, 0);
            due = local.toISOString();
          }
        }

        await this.plugin.api.createTask(this.listId, {
          title,
          notes: notes || undefined,
          due,
        });

        new Notice("Задача создана в Google Tasks.");
        this.onCreated();
        this.close();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        statusEl.textContent = `Ошибка: ${msg}`;
        statusEl.style.color = "var(--text-error)";
        createBtn.removeAttribute("disabled");
        cancelBtn.removeAttribute("disabled");
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ================================================================
   Settings Tab
   ================================================================ */

class GoogleTasksSettingTab extends PluginSettingTab {
  plugin: ObsidianGoogleTasksPlugin;

  constructor(app: App, plugin: ObsidianGoogleTasksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Google Tasks" });

    /* ---- credentials section ---- */
    containerEl.createEl("h3", { text: "Учётные данные Google OAuth" });

    containerEl.createEl("p", {
      cls: "setting-item-description",
    }).innerHTML =
      'Создайте проект в <a href="https://console.cloud.google.com/">Google Cloud Console</a>, ' +
      "включите <b>Google Tasks API</b>, создайте <b>OAuth 2.0 Client ID</b> (тип: Desktop App) " +
      "и вставьте данные ниже.";

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("OAuth 2.0 Client ID")
      .addText((text) =>
        text
          .setPlaceholder("xxxx.apps.googleusercontent.com")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            this.plugin.auth.updateCredentials(
              this.plugin.settings.clientId,
              this.plugin.settings.clientSecret,
            );
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Client Secret")
      .setDesc("OAuth 2.0 Client Secret")
      .addText((text) => {
        text
          .setPlaceholder("GOCSPX-…")
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            this.plugin.auth.updateCredentials(
              this.plugin.settings.clientId,
              this.plugin.settings.clientSecret,
            );
            await this.plugin.saveSettings();
          });
        // mask the secret like a password
        text.inputEl.type = "password";
      });

    /* ---- general settings ---- */
    containerEl.createEl("h3", { text: "Общие настройки" });

    new Setting(containerEl)
      .setName("Автообновление")
      .setDesc(
        "Интервал автообновления списков задач в секундах. Оставьте 0, чтобы отключить автообновление.",
      )
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.autoRefreshInterval))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.autoRefreshInterval = num;
              await this.plugin.saveSettings();
              this.plugin.startAutoRefresh(); // restart timer
              if (num > 0) {
                new Notice(`Автообновление: каждые ${num} сек.`);
              } else {
                new Notice("Автообновление отключено.");
              }
            }
          }),
      );

    /* ---- auth section ---- */
    containerEl.createEl("h3", { text: "Авторизация" });

    containerEl.createEl("p", {
      cls: "setting-item-description",
    }).innerHTML =
      "<b>Важно:</b> Для выполнения задач требуется полный доступ к Google Tasks API. " +
      "Если вы авторизовались ранее, выйдите и войдите снова для получения расширенных прав.";

    if (this.plugin.auth.isAuthenticated()) {
      new Setting(containerEl)
        .setName("Статус")
        .setDesc("Вы авторизованы в Google Tasks")
        .addButton((btn) =>
          btn.setButtonText("Выйти").onClick(async () => {
            this.plugin.auth.setTokens(null);
            await this.plugin.persistTokens();
            new Notice("Google Tasks: вы вышли из аккаунта.");
            this.display();
          }),
        );
    } else {
      new Setting(containerEl)
        .setName("Статус")
        .setDesc("Вы не авторизованы")
        .addButton((btn) =>
          btn
            .setButtonText("Войти через Google")
            .setCta()
            .onClick(() => {
              if (!this.plugin.settings.clientId || !this.plugin.settings.clientSecret) {
                new Notice("Сначала введите Client ID и Client Secret.");
                return;
              }
              new AuthCodeModal(this.app, this.plugin, () => {
                this.display(); // refresh settings view
              }).open();
            }),
        );
    }

    /* ---- usage hint ---- */
    containerEl.createEl("h3", { text: "Использование" });
    const hint = containerEl.createDiv({ cls: "setting-item-description" });
    hint.innerHTML =
      "Добавьте в любую заметку блок:<br><br>" +
      '<code style="padding:4px 8px;background:var(--background-secondary);border-radius:4px;">' +
      "```g-tasks<br>```" +
      "</code><br><br>" +
      "Опционально можно указать параметры:<br><br>" +
      "<b>Все задачи из основного списка:</b><br>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>```" +
      "</code><br>" +
      "<b>Задачи из конкретного списка:</b><br>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>list: Работа<br>```" +
      "</code><br>" +
      "<b>Задачи за конкретный день (из имени файла DD.MM.YYYY.md):</b><br>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>date: {{filename}}<br>```" +
      "</code><br>" +
      "<b>Задачи за сегодня:</b><br>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>date: today<br>```" +
      "</code><br>" +
      "<b>Фильтр по статусу выполнения:</b><br>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>completed: false  # только невыполненные<br>```" +
      "</code>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>completed: true   # только выполненные<br>```" +
      "</code>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>completed: all    # все задачи<br>```" +
      "</code><br>" +
      "<b>Комбинация параметров:</b><br>" +
      '<code style="display:block;padding:4px 8px;background:var(--background-secondary);border-radius:4px;margin:4px 0;">' +
      "```g-tasks<br>list: Работа<br>date: {{filename}}<br>completed: all<br>```" +
      "</code>";
  }
}
