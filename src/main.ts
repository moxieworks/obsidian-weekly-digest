import { Plugin, Notice, PluginSettingTab, App, Setting } from "obsidian";
import { findRecentDailyNotes } from "./daily-notes-finder";
import { analyzeNotes } from "./digest-analyzer";
import { generateDigestMarkdown, writeDigestNote } from "./digest-writer";

interface PluginSettings {
  digestFolder: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
  digestFolder: "",
};

export default class WeeklyDigestPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addCommand({
      id: "generate-weekly-digest",
      name: "Generate Weekly Digest",
      callback: () => {
        this.generateDigest();
      },
    });

    this.addSettingTab(new WeeklyDigestSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async generateDigest(): Promise<void> {
    const notice = new Notice("Scanning daily notes…", 0);
    try {
      const dailyNotes = await findRecentDailyNotes(this.app);

      if (dailyNotes.length === 0) {
        notice.hide();
        // B4: clearer message when format/folder is misconfigured
        new Notice(
          "No daily notes found in the expected format. Check your folder and date format settings."
        );
        return;
      }

      const contents = await Promise.all(
        dailyNotes.map(async ({ file, date }) => ({
          filename: file.basename,
          content: await this.app.vault.read(file),
          date,
        }))
      );

      const analysis = analyzeNotes(
        contents.map(({ filename, content }) => ({ filename, content }))
      );

      const referenceDate = dailyNotes[0].date;
      const markdown = generateDigestMarkdown(
        analysis,
        referenceDate,
        contents.map((c) => c.date)
      );

      const { wasUpdate } = await writeDigestNote(
        this.app,
        markdown,
        referenceDate,
        this.settings.digestFolder
      );

      notice.hide();
      // B1: distinct notice for update vs create
      if (wasUpdate) {
        new Notice("Existing digest updated — previous content replaced.");
      } else {
        new Notice(
          `Weekly digest created (${dailyNotes.length} note${dailyNotes.length !== 1 ? "s" : ""} scanned).`
        );
      }
    } catch (err) {
      notice.hide();
      new Notice("Failed to generate digest. Check the developer console for details.");
      console.error("[weekly-digest]", err);
    }
  }
}

class WeeklyDigestSettingTab extends PluginSettingTab {
  private plugin: WeeklyDigestPlugin;

  constructor(app: App, plugin: WeeklyDigestPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Digest folder")
      .setDesc(
        "Folder where weekly digest notes are saved. Leave empty to save to the vault root."
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. Reviews/Weekly")
          .setValue(this.plugin.settings.digestFolder)
          .onChange(async (value) => {
            this.plugin.settings.digestFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
