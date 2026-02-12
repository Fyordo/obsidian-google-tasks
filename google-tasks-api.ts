import { requestUrl } from "obsidian";
import { GoogleAuth } from "./google-auth";

const BASE_URL = "https://tasks.googleapis.com/tasks/v1";

/* ---- Types ---- */

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;       // RFC 3339 date
  updated: string;
  parent?: string;
  position: string;
  links?: { type: string; description: string; link: string }[];
}

export interface GoogleTaskList {
  id: string;
  title: string;
}

/* ---- Tree structure for rendering subtasks ---- */

export interface TaskNode {
  task: GoogleTask;
  children: TaskNode[];
}

/* ---- API client ---- */

export class GoogleTasksApi {
  private auth: GoogleAuth;

  constructor(auth: GoogleAuth) {
    this.auth = auth;
  }

  private async request<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
    const token = await this.auth.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    
    const options: any = {
      url: `${BASE_URL}${endpoint}`,
      method,
      headers,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const resp = await requestUrl(options);

    if (resp.json?.error) {
      throw new Error(
        `Google Tasks API error: ${resp.json.error.message ?? resp.json.error}`,
      );
    }

    return resp.json as T;
  }

  /** Get all task lists for the current user */
  async getTaskLists(): Promise<GoogleTaskList[]> {
    const data = await this.request<{ items?: GoogleTaskList[] }>(
      "/users/@me/lists",
    );
    return data.items ?? [];
  }

  /**
   * Get tasks from a specific list.
   * @param taskListId  list id, defaults to the primary list (`@default`)
   * @param showCompleted  whether to include completed tasks
   */
  async getTasks(
    taskListId = "@default",
    showCompleted = true,
  ): Promise<GoogleTask[]> {
    const params = new URLSearchParams({
      showCompleted: String(showCompleted),
      showHidden: String(showCompleted), // Also show hidden completed tasks
      maxResults: "100",
    });
    const data = await this.request<{ items?: GoogleTask[] }>(
      `/lists/${encodeURIComponent(taskListId)}/tasks?${params.toString()}`,
    );
    return data.items ?? [];
  }

  /**
   * Create a new task in a list.
   */
  async createTask(
    taskListId: string,
    input: {
      title: string;
      notes?: string;
      due?: string; // RFC 3339
      parent?: string;
    },
  ): Promise<GoogleTask> {
    return await this.request<GoogleTask>(
      `/lists/${encodeURIComponent(taskListId)}/tasks`,
      "POST",
      input,
    );
  }

  /**
   * Update task status (complete/uncomplete)
   * @param taskListId  list id
   * @param taskId  task id
   * @param completed  whether the task should be marked as completed
   */
  async updateTaskStatus(
    taskListId: string,
    taskId: string,
    completed: boolean,
  ): Promise<GoogleTask> {
    const status = completed ? "completed" : "needsAction";
    const body = { status };
    
    return await this.request<GoogleTask>(
      `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      "PATCH",
      body,
    );
  }

  /**
   * Build a tree from a flat task list (respecting parent → child).
   */
  static buildTree(tasks: GoogleTask[]): TaskNode[] {
    const map = new Map<string, TaskNode>();
    const roots: TaskNode[] = [];

    // create nodes
    for (const t of tasks) {
      map.set(t.id, { task: t, children: [] });
    }

    // link parents
    for (const t of tasks) {
      const node = map.get(t.id)!;
      if (t.parent && map.has(t.parent)) {
        map.get(t.parent)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
