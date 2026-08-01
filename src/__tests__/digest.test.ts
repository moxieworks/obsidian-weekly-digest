import { parseDate } from "../daily-notes-finder";
import { analyzeNotes } from "../digest-analyzer";
import { getISOWeek, generateDigestMarkdown } from "../digest-writer";

// ── parseDate ─────────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses YYYY-MM-DD", () => {
    const d = parseDate("2024-01-15", "YYYY-MM-DD");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(15);
  });

  it("parses DD-MM-YYYY", () => {
    const d = parseDate("15-01-2024", "DD-MM-YYYY");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(15);
  });

  it("parses MM-DD-YYYY", () => {
    const d = parseDate("01-15-2024", "MM-DD-YYYY");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(15);
  });

  it("parses YYYY/MM/DD with slash separator", () => {
    const d = parseDate("2024/03/07", "YYYY/MM/DD");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(7);
  });

  it("returns null for non-matching filename", () => {
    expect(parseDate("meeting-notes", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("2024-1-5", "YYYY-MM-DD")).toBeNull();
  });

  it("returns null for invalid calendar date", () => {
    expect(parseDate("2024-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("2024-13-01", "YYYY-MM-DD")).toBeNull();
  });

  it("returns null for unsupported format (no YYYY/MM/DD tokens)", () => {
    expect(parseDate("2024-01-15", "Do MMMM YYYY")).toBeNull();
  });
});

// ── analyzeNotes ──────────────────────────────────────────────────────────────

describe("analyzeNotes", () => {
  it("returns zeroed analysis for empty input", () => {
    const r = analyzeNotes([]);
    expect(r.tags.size).toBe(0);
    expect(r.tasksDone).toBe(0);
    expect(r.tasksOpen).toBe(0);
    expect(r.links.size).toBe(0);
    expect(r.dayStats).toEqual([]);
    expect(r.clusters).toEqual([]);
  });

  it("counts tags with mention count and distinct days", () => {
    const r = analyzeNotes([
      { filename: "a", content: "Hello #work and #work and #personal" },
      { filename: "b", content: "#work #project/alpha" },
    ]);
    expect(r.tags.get("#work")).toEqual({ count: 3, days: 2 });
    expect(r.tags.get("#personal")).toEqual({ count: 1, days: 1 });
    expect(r.tags.get("#project/alpha")).toEqual({ count: 1, days: 1 });
  });

  it("skips tags inside fenced code blocks", () => {
    const r = analyzeNotes([
      { filename: "a", content: "Real #tag\n```\n#code-tag\n```\nAlso #tag" },
    ]);
    expect(r.tags.get("#tag")?.count).toBe(2);
    expect(r.tags.has("#code-tag")).toBe(false);
  });

  it("skips tags inside inline code", () => {
    const r = analyzeNotes([
      { filename: "a", content: "Use `#inline-code` for examples but #real counts" },
    ]);
    expect(r.tags.has("#inline-code")).toBe(false);
    expect(r.tags.get("#real")?.count).toBe(1);
  });

  it("counts done tasks (case-insensitive x)", () => {
    const r = analyzeNotes([
      { filename: "a", content: "- [x] done one\n- [X] done two\n- [ ] open one" },
    ]);
    expect(r.tasksDone).toBe(2);
    expect(r.tasksOpen).toBe(1);
  });

  it("counts open tasks", () => {
    const r = analyzeNotes([
      { filename: "a", content: "- [ ] task A\n- [ ] task B\n- [x] task C" },
    ]);
    expect(r.tasksOpen).toBe(2);
    expect(r.tasksDone).toBe(1);
  });

  it("counts tasks across multiple notes", () => {
    const r = analyzeNotes([
      { filename: "a", content: "- [x] done\n- [ ] open" },
      { filename: "b", content: "- [x] done again" },
    ]);
    expect(r.tasksDone).toBe(2);
    expect(r.tasksOpen).toBe(1);
  });

  it("does not count tasks inside fenced code blocks", () => {
    const r = analyzeNotes([
      {
        filename: "a",
        content:
          "- [x] real task\n```\n- [x] fake task\n- [ ] fake open\n```\n- [ ] real open",
      },
    ]);
    expect(r.tasksDone).toBe(1);
    expect(r.tasksOpen).toBe(1);
  });

  it("ignores indented non-task lines", () => {
    const r = analyzeNotes([
      { filename: "a", content: "  - [ ] indented task\n  - [x] indented done" },
    ]);
    expect(r.tasksOpen).toBe(1);
    expect(r.tasksDone).toBe(1);
  });

  it("extracts wiki links with mention count and distinct days", () => {
    const r = analyzeNotes([
      { filename: "a", content: "See [[Project Alpha]] and [[Weekly Goals]]" },
      { filename: "b", content: "Also [[Project Alpha]] is important" },
    ]);
    expect(r.links.get("Project Alpha")).toEqual({ count: 2, days: 2 });
    expect(r.links.get("Weekly Goals")).toEqual({ count: 1, days: 1 });
  });

  it("strips aliases from links", () => {
    const r = analyzeNotes([
      { filename: "a", content: "[[Project Alpha|the project]] is great" },
    ]);
    expect(r.links.get("Project Alpha")).toEqual({ count: 1, days: 1 });
    expect(r.links.has("the project")).toBe(false);
  });

  it("strips heading anchors from links — same-note duplicates count once for days", () => {
    const r = analyzeNotes([
      { filename: "a", content: "[[Project Alpha#Goals]] and [[Project Alpha#Status]]" },
    ]);
    expect(r.links.get("Project Alpha")).toEqual({ count: 2, days: 1 });
  });

  it("accumulates links across multiple notes", () => {
    const r = analyzeNotes([
      { filename: "a", content: "[[MeetingNotes]]" },
      { filename: "b", content: "[[MeetingNotes]] [[MeetingNotes]]" },
    ]);
    expect(r.links.get("MeetingNotes")).toEqual({ count: 3, days: 2 });
  });

  it("records per-day stats", () => {
    const r = analyzeNotes([
      { filename: "2024-01-15", content: "- [x] done\n- [ ] open\n#work [[Alpha]]" },
      { filename: "2024-01-16", content: "- [ ] todo\n#personal [[Beta]]" },
    ]);
    expect(r.dayStats).toHaveLength(2);
    expect(r.dayStats[0].tasksDone).toBe(1);
    expect(r.dayStats[0].tasksOpen).toBe(1);
    expect(r.dayStats[1].tasksDone).toBe(0);
    expect(r.dayStats[1].tasksOpen).toBe(1);
  });

  it("clusters pages that co-occur on 2+ days", () => {
    const r = analyzeNotes([
      { filename: "a", content: "[[Alpha]] [[Beta]]" },
      { filename: "b", content: "[[Alpha]] [[Beta]]" },
      { filename: "c", content: "[[Gamma]]" },
      { filename: "d", content: "[[Gamma]]" },
    ]);
    expect(r.clusters.length).toBeGreaterThanOrEqual(1);
    const bigCluster = r.clusters[0];
    expect(bigCluster.pages).toContain("Alpha");
    expect(bigCluster.pages).toContain("Beta");
  });

  it("does not cluster pages that co-occur on only one day", () => {
    const r = analyzeNotes([
      { filename: "a", content: "[[Solo]]" },
      { filename: "b", content: "[[Other]]" },
    ]);
    // Solo and Other never appear together, so no cluster joins them
    const joined = r.clusters.some(
      (c) => c.pages.includes("Solo") && c.pages.includes("Other")
    );
    expect(joined).toBe(false);
  });
});

// ── getISOWeek ────────────────────────────────────────────────────────────────

describe("getISOWeek", () => {
  it("2024-01-01 is W1 of 2024", () => {
    const { year, week } = getISOWeek(new Date(2024, 0, 1));
    expect(year).toBe(2024);
    expect(week).toBe(1);
  });

  it("2023-01-01 is W52 of 2022", () => {
    const { year, week } = getISOWeek(new Date(2023, 0, 1));
    expect(year).toBe(2022);
    expect(week).toBe(52);
  });

  it("2024-12-30 is W1 of 2025", () => {
    const { year, week } = getISOWeek(new Date(2024, 11, 30));
    expect(year).toBe(2025);
    expect(week).toBe(1);
  });
});

// ── generateDigestMarkdown ────────────────────────────────────────────────────

describe("generateDigestMarkdown", () => {
  const baseAnalysis = {
    tags: new Map([
      ["#work", { count: 5, days: 5 }],
      ["#personal", { count: 2, days: 2 }],
    ]),
    tasksDone: 8,
    tasksOpen: 2,
    links: new Map([
      ["Project Alpha", { count: 10, days: 5 }],
      ["Meeting Notes", { count: 3, days: 2 }],
    ]),
    dayStats: [],
    clusters: [],
  };

  const dates = [new Date(2024, 0, 15), new Date(2024, 0, 16), new Date(2024, 0, 17)];

  it("includes the ISO week in the title", () => {
    const md = generateDigestMarkdown(baseAnalysis, dates[0], dates);
    expect(md).toMatch(/# Weekly Digest 2024-W0\d/);
  });

  it("lists tags sorted by frequency descending", () => {
    const md = generateDigestMarkdown(baseAnalysis, dates[0], dates);
    const workIdx = md.indexOf("#work");
    const personalIdx = md.indexOf("#personal");
    expect(workIdx).toBeLessThan(personalIdx);
  });

  it("shows tags as a table with mention count and days", () => {
    const md = generateDigestMarkdown(baseAnalysis, dates[0], dates);
    expect(md).toContain("| #work | 5 | 5 |");
    expect(md).toContain("| #personal | 2 | 2 |");
  });

  it("shows task totals with completion rate in the scorecard", () => {
    const md = generateDigestMarkdown(baseAnalysis, dates[0], dates);
    expect(md).toContain("**8**");
    expect(md).toContain("**2**");
    expect(md).toContain("**80%**");
  });

  it("lists linked pages as a table sorted by frequency", () => {
    const md = generateDigestMarkdown(baseAnalysis, dates[0], dates);
    const alphaIdx = md.indexOf("Project Alpha");
    const meetingIdx = md.indexOf("Meeting Notes");
    expect(alphaIdx).toBeLessThan(meetingIdx);
    expect(md).toContain("[[Project Alpha]] | 10 | 5");
  });

  it("includes date range in header", () => {
    const md = generateDigestMarkdown(baseAnalysis, dates[0], dates);
    expect(md).toContain("Jan 15");
    expect(md).toContain("Jan 17");
  });

  it("handles empty analysis gracefully", () => {
    const empty = {
      tags: new Map(),
      tasksDone: 0,
      tasksOpen: 0,
      links: new Map(),
      dayStats: [],
      clusters: [],
    };
    const md = generateDigestMarkdown(empty, dates[0], []);
    expect(md).toContain("*No tags found.*");
    expect(md).toContain("*No links found.*");
    expect(md).toContain("*No clusters detected.*");
    expect(md).not.toContain("done");
  });

  it("omits task count from header when there are no tasks", () => {
    const noTasks = { ...baseAnalysis, tasksDone: 0, tasksOpen: 0 };
    const md = generateDigestMarkdown(noTasks, dates[0], dates);
    expect(md).not.toContain("tasks");
  });

  it("renders per-day scorecard rows when dayStats are provided", () => {
    const withDays = {
      ...baseAnalysis,
      dayStats: [
        { filename: "2024-01-15", tasksDone: 3, tasksOpen: 1, tags: [], links: [] },
        { filename: "2024-01-16", tasksDone: 5, tasksOpen: 1, tags: [], links: [] },
      ],
      clusters: [],
    };
    const twoDateRange = [new Date(2024, 0, 15), new Date(2024, 0, 16)];
    const md = generateDigestMarkdown(withDays, twoDateRange[0], twoDateRange);
    expect(md).toContain("| Jan 15 | 3 | 1 | 75% |");
    expect(md).toContain("| Jan 16 | 5 | 1 | 83% |");
  });

  it("renders focus cluster table when clusters are present", () => {
    const withClusters = {
      ...baseAnalysis,
      clusters: [
        { pages: ["Project Alpha", "Alice", "Project Beta"], daysActive: 6, totalMentions: 20 },
      ],
    };
    const md = generateDigestMarkdown(withClusters, dates[0], dates);
    expect(md).toContain("[[Project Alpha]]");
    expect(md).toContain("[[Alice]]");
    expect(md).toContain("| 6 |");
  });
});
