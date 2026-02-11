import {
  App,
  Plugin,
  PluginManifest,
  Setting,
  PluginSettingTab,
  Notice,
  MarkdownPostProcessorContext,
} from "obsidian";

interface ObsidianGoogleTasksSettings {
  exampleSetting: string;
}

const DEFAULT_SETTINGS: ObsidianGoogleTasksSettings = {
  exampleSetting: "default",
};

export default class ObsidianGoogleTasksPlugin extends Plugin {
  settings: ObsidianGoogleTasksSettings;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload() {
    console.log("Loading Obsidian Google Tasks plugin");
    await this.loadSettings();

    this.addRibbonIcon("checkmark", "Obsidian Google Tasks", () => {
      new Notice("Obsidian Google Tasks activated!");
    });

    this.registerMarkdownCodeBlockProcessor(
      "g-tasks",
      async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        // TODO: заменить на реальный вызов Google Tasks API.
        // Пока показываем заглушку.
        el.empty();

        const header = el.createEl("div", { cls: "ogt-header" });
        header.createEl("span", { text: "Google Tasks (demo)" });

        const list = el.createEl("ul", { cls: "ogt-list" });

        const demoTasks = [
          "Пример задачи 1 из Google Tasks",
          "Пример задачи 2",
          "Пример задачи 3",
        ];

        for (const task of demoTasks) {
          const li = list.createEl("li", { cls: "ogt-task" });
          li.createEl("input", { type: "checkbox" });
          li.createEl("span", { text: task });
        }

        // На будущее: можно использовать `source` для параметров:
        // список, фильтры, сортировка и т.п.
      },
    );

    this.addSettingTab(new ObsidianGoogleTasksSettingTab(this.app, this));
  }

  onunload() {
    console.log("Unloading Obsidian Google Tasks plugin");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ObsidianGoogleTasksSettingTab extends PluginSettingTab {
  plugin: ObsidianGoogleTasksPlugin;

  constructor(app: App, plugin: ObsidianGoogleTasksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Google Tasks" });

    new Setting(containerEl)
      .setName("Example setting")
      .setDesc("This is a placeholder setting.")
      .addText((text) =>
        text
          .setPlaceholder("Enter a value")
          .setValue(this.plugin.settings.exampleSetting)
          .onChange(async (value) => {
            this.plugin.settings.exampleSetting = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}

