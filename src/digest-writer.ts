import { App, TFile } from "obsidian";
import { DigestAnalysis } from "./digest-analyzer";

export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shortDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function completionPct(done: number, total: number): string | null {
  return total > 0 ? `${Math.round((done / total) * 100)}%` : null;
}

export function generateDigestMarkdown(
  analysis: DigestAnalysis,
  referenceDate: Date,
  dailyNoteDates: Date[]
): string {
  const { year, week } = getISOWeek(referenceDate);
  const title = `Weekly Digest ${year}-W${padTwo(week)}`;

  const sortedDates = [...dailyNoteDates].sort((a, b) => a.getTime() - b.getTime());
  const dateRange =
    sortedDates.length > 1
      ? `${shortDate(sortedDates[0])} – ${shortDate(sortedDates[sortedDates.length - 1])}`
      : sortedDates.length === 1
      ? shortDate(sortedDates[0])
      : "—";

  const total = analysis.tasksDone + analysis.tasksOpen;
  const pct = completionPct(analysis.tasksDone, total);
  const headerParts = [
    `${sortedDates.length} note${sortedDates.length !== 1 ? "s" : ""}`,
    total > 0 ? `${total} tasks` : null,
    pct ? `${pct} done` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lines: string[] = [
    `# ${title}`,
    "",
    `*${dateRange} · ${headerParts}*`,
    "",
  ];

  // ── Focus Clusters ────────────────────────────────────────────────────────
  lines.push("## Focus Clusters", "");
  if (analysis.clusters.length > 0) {
    lines.push("| # | Pages | Days active |", "|---|---|---|");
    for (let i = 0; i < analysis.clusters.length; i++) {
      const { pages, daysActive } = analysis.clusters[i];
      const pageLinks = pages.slice(0, 5).map((p) => `[[${p}]]`).join(" · ");
      lines.push(`| ${i + 1} | ${pageLinks} | ${daysActive} |`);
    }
  } else {
    lines.push("*No clusters detected.*");
  }
  lines.push("");

  // ── Task Scorecard ────────────────────────────────────────────────────────
  lines.push("## Task Scorecard", "");
  lines.push("| Date | ✓ | ○ | % |", "|---|---|---|---|");

  const pairs = analysis.dayStats
    .map((ds, i) => ({ ds, date: dailyNoteDates[i] }))
    .filter(({ date }) => date !== undefined)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const { ds, date } of pairs) {
    const dayTotal = ds.tasksDone + ds.tasksOpen;
    const dayPct = completionPct(ds.tasksDone, dayTotal) ?? "—";
    lines.push(`| ${shortDate(date)} | ${ds.tasksDone} | ${ds.tasksOpen} | ${dayPct} |`);
  }

  lines.push(
    `| **Total** | **${analysis.tasksDone}** | **${analysis.tasksOpen}** | **${pct ?? "—"}** |`,
    ""
  );

  // ── Tags ──────────────────────────────────────────────────────────────────
  const sortedTags = [...analysis.tags.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  lines.push("## Tags", "");
  if (sortedTags.length > 0) {
    lines.push("| Tag | Mentions | Days |", "|---|---|---|");
    for (const [tag, { count, days }] of sortedTags) {
      lines.push(`| ${tag} | ${count} | ${days} |`);
    }
  } else {
    lines.push("*No tags found.*");
  }
  lines.push("");

  // ── Most Mentioned ────────────────────────────────────────────────────────
  const sortedLinks = [...analysis.links.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  lines.push("## Most Mentioned", "");
  if (sortedLinks.length > 0) {
    lines.push("| Page | Mentions | Days |", "|---|---|---|");
    for (const [page, { count, days }] of sortedLinks) {
      lines.push(`| [[${page}]] | ${count} | ${days} |`);
    }
  } else {
    lines.push("*No links found.*");
  }
  lines.push("");

  return lines.join("\n");
}

export async function writeDigestNote(
  app: App,
  markdown: string,
  referenceDate: Date,
  digestFolder = ""
): Promise<{ wasUpdate: boolean }> {
  const { year, week } = getISOWeek(referenceDate);
  const noteName = `Weekly Digest ${year}-W${padTwo(week)}`;
  const notePath = digestFolder ? `${digestFolder}/${noteName}.md` : `${noteName}.md`;

  const existing = app.vault.getAbstractFileByPath(notePath);
  const wasUpdate = existing instanceof TFile;
  if (wasUpdate) {
    await app.vault.modify(existing, markdown);
  } else {
    await app.vault.create(notePath, markdown);
  }

  const created = app.vault.getAbstractFileByPath(notePath);
  if (created instanceof TFile) {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(created);
  }

  return { wasUpdate };
}
