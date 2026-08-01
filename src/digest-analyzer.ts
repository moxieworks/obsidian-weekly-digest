export interface NoteContent {
  filename: string;
  content: string;
}

export interface DayStats {
  filename: string;
  tasksDone: number;
  tasksOpen: number;
  tags: string[];
  links: string[];
}

export interface Cluster {
  pages: string[];
  daysActive: number;
  totalMentions: number;
}

export interface DigestAnalysis {
  tags: Map<string, { count: number; days: number }>;
  tasksDone: number;
  tasksOpen: number;
  links: Map<string, { count: number; days: number }>;
  dayStats: DayStats[];
  clusters: Cluster[];
}

const TAG_RE = /#([A-Za-zÀ-ž_][\wÀ-ž/-]*)/g;
const LINK_RE = /\[\[([^\]]+)\]\]/g;
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

function stripCode(content: string): string {
  return content.replace(FENCED_CODE_RE, "").replace(INLINE_CODE_RE, "");
}

function clusterPages(dayStats: DayStats[]): Cluster[] {
  const pageFreq = new Map<string, number>();
  const pageDays = new Map<string, Set<number>>();
  const coOccurrence = new Map<string, number>();

  for (let i = 0; i < dayStats.length; i++) {
    const pageSet = [...new Set(dayStats[i].links)];
    for (const link of dayStats[i].links) {
      pageFreq.set(link, (pageFreq.get(link) ?? 0) + 1);
    }
    for (const page of pageSet) {
      if (!pageDays.has(page)) pageDays.set(page, new Set());
      pageDays.get(page)!.add(i);
    }
    for (let a = 0; a < pageSet.length; a++) {
      for (let b = a + 1; b < pageSet.length; b++) {
        const key = [pageSet[a], pageSet[b]].sort().join("|||");
        coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
      }
    }
  }

  // Build adjacency for pages co-occurring on >= 2 days
  const adj = new Map<string, Set<string>>();
  for (const [key, count] of coOccurrence) {
    if (count >= 2) {
      const [a, b] = key.split("|||");
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }

  const visited = new Set<string>();
  const clusters: Cluster[] = [];
  const allPages = [...pageFreq.keys()].sort(
    (a, b) => (pageFreq.get(b) ?? 0) - (pageFreq.get(a) ?? 0)
  );

  for (const seed of allPages) {
    if (visited.has(seed)) continue;
    if (!adj.has(seed)) {
      if ((pageDays.get(seed)?.size ?? 0) >= 2) {
        visited.add(seed);
        clusters.push({
          pages: [seed],
          daysActive: pageDays.get(seed)?.size ?? 0,
          totalMentions: pageFreq.get(seed) ?? 0,
        });
      }
      continue;
    }
    // BFS
    const queue = [seed];
    const clusterPages: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      clusterPages.push(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    clusterPages.sort((a, b) => (pageFreq.get(b) ?? 0) - (pageFreq.get(a) ?? 0));
    const allDays = new Set<number>();
    for (const page of clusterPages) {
      for (const d of pageDays.get(page) ?? []) allDays.add(d);
    }
    clusters.push({
      pages: clusterPages,
      daysActive: allDays.size,
      totalMentions: clusterPages.reduce((s, p) => s + (pageFreq.get(p) ?? 0), 0),
    });
  }

  clusters.sort((a, b) => b.totalMentions - a.totalMentions);
  return clusters.slice(0, 5);
}

export function analyzeNotes(notes: NoteContent[]): DigestAnalysis {
  const tags = new Map<string, { count: number; days: number }>();
  const links = new Map<string, { count: number; days: number }>();
  let tasksDone = 0;
  let tasksOpen = 0;
  const dayStats: DayStats[] = [];

  for (const { filename, content } of notes) {
    const clean = stripCode(content);
    let dayDone = 0;
    let dayOpen = 0;

    for (const line of clean.split("\n")) {
      const trimmed = line.trimStart();
      if (/^- \[x\] /i.test(trimmed)) dayDone++;
      else if (/^- \[ \] /.test(trimmed)) dayOpen++;
    }
    tasksDone += dayDone;
    tasksOpen += dayOpen;

    const dayTagList: string[] = [];
    const seenTags = new Set<string>();
    for (const match of clean.matchAll(TAG_RE)) {
      const tag = `#${match[1]}`;
      dayTagList.push(tag);
      const existing = tags.get(tag) ?? { count: 0, days: 0 };
      tags.set(tag, {
        count: existing.count + 1,
        days: existing.days + (seenTags.has(tag) ? 0 : 1),
      });
      seenTags.add(tag);
    }

    const dayLinkList: string[] = [];
    const seenLinks = new Set<string>();
    for (const match of clean.matchAll(LINK_RE)) {
      let target = match[1].split("|")[0].split("#")[0].trim();
      if (!target) continue;
      dayLinkList.push(target);
      const existing = links.get(target) ?? { count: 0, days: 0 };
      links.set(target, {
        count: existing.count + 1,
        days: existing.days + (seenLinks.has(target) ? 0 : 1),
      });
      seenLinks.add(target);
    }

    dayStats.push({
      filename,
      tasksDone: dayDone,
      tasksOpen: dayOpen,
      tags: dayTagList,
      links: dayLinkList,
    });
  }

  return { tags, tasksDone, tasksOpen, links, dayStats, clusters: clusterPages(dayStats) };
}
