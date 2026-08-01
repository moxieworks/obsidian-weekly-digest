import { App, TFile } from "obsidian";

interface DailyNotesConfig {
  folder: string;
  format: string;
}

async function readDailyNotesConfig(app: App): Promise<DailyNotesConfig> {
  try {
    const raw = await app.vault.adapter.read(".obsidian/daily-notes.json");
    const config = JSON.parse(raw);
    return {
      folder: typeof config.folder === "string" ? config.folder : "",
      format: typeof config.format === "string" ? config.format : "YYYY-MM-DD",
    };
  } catch {
    return { folder: "", format: "YYYY-MM-DD" };
  }
}

/**
 * Parses a date from a filename using a format string containing YYYY, MM, DD tokens.
 * Returns null if the filename doesn't match or produces an invalid date.
 */
export function parseDate(filename: string, format: string): Date | null {
  const yearIdx = format.indexOf("YYYY");
  const monthIdx = format.indexOf("MM");
  const dayIdx = format.indexOf("DD");

  if (yearIdx === -1 || monthIdx === -1 || dayIdx === -1) return null;

  // Escape regex metacharacters in the format string, then replace tokens with capture groups
  const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped
    .replace("YYYY", "(\\d{4})")
    .replace("MM", "(\\d{2})")
    .replace("DD", "(\\d{2})");

  const match = filename.match(new RegExp(`^${regexStr}$`));
  if (!match) return null;

  // Map capture groups to token names by their position in the original format
  const positions = [
    { key: "YYYY" as const, idx: yearIdx },
    { key: "MM" as const, idx: monthIdx },
    { key: "DD" as const, idx: dayIdx },
  ].sort((a, b) => a.idx - b.idx);

  const values: Record<string, number> = {};
  positions.forEach(({ key }, i) => {
    values[key] = parseInt(match[i + 1], 10);
  });

  const year = values["YYYY"];
  const month = values["MM"] - 1; // Date months are 0-indexed
  const day = values["DD"];

  if (!year || isNaN(month) || !day) return null;

  const date = new Date(year, month, day);
  // Reject invalid dates like Feb 30
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

export async function findRecentDailyNotes(
  app: App,
  count = 7
): Promise<{ file: TFile; date: Date }[]> {
  const config = await readDailyNotesConfig(app);
  const folderNorm = config.folder.replace(/\/$/, "");
  const allMarkdown = app.vault.getMarkdownFiles();

  const inFolder = allMarkdown.filter((f) => {
    const parentPath = f.parent?.path ?? "";
    if (folderNorm === "") {
      // Vault root: parent path is "" in Obsidian
      return parentPath === "" || parentPath === "/";
    }
    return parentPath === folderNorm;
  });

  const withDates: { file: TFile; date: Date }[] = [];
  for (const file of inFolder) {
    const date = parseDate(file.basename, config.format);
    if (date) withDates.push({ file, date });
  }

  withDates.sort((a, b) => b.date.getTime() - a.date.getTime());
  return withDates.slice(0, count);
}
