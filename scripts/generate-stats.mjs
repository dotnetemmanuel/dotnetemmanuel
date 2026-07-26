#!/usr/bin/env node
// Generates the profile stat cards in assets/ from the GitHub GraphQL API. No dependencies.

import { writeFile, mkdir } from "node:fs/promises";

const USER = process.env.STATS_USER ?? "dotnetemmanuel";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = new URL("../assets/", import.meta.url);

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required (a PAT with repo scope also counts private contributions).");
  process.exit(1);
}

// Retro 82 palette, matched to banner.svg and the README badges.
const C = {
  bg: "#00172E",
  panel: "#011F3C",
  border: "#134E5A",
  accent: "#FAA968",
  text: "#F6DCAC",
  muted: "#8CBFB8",
  dim: "#3F8F8A",
};
const SERIES = ["#FAA968", "#028391", "#8CBFB8", "#E97B3C", "#F85525"];

const MONO = "ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace";
const CW = 0.6; // monospace advance width as a fraction of font-size, used for layout math

const W = 880;
const PAD = 22;

// Scratch repos and course work say nothing about what gets built, so keep them off the cards.
const BORING = /sandbox|uppgift|^notes$|-notes$|dotfiles|^test|demo$/i;
// A drive-by commit on someone else's repo is not a contribution worth a chip.
const MIN_EXTERNAL_COMMITS = 2;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const textW = (s, size) => s.length * size * CW;
const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

async function gql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function collect() {
  const data = await gql(`{
    user(login: "${USER}") {
      login
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
        nodes { ...repoFields }
      }
      repositoriesContributedTo(first: 50, includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST], orderBy: {field: PUSHED_AT, direction: DESC}) {
        nodes { ...repoFields }
      }
      contributionsCollection {
        totalCommitContributions
        restrictedContributionsCount
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        commitContributionsByRepository(maxRepositories: 20) {
          repository { name nameWithOwner isPrivate stargazerCount owner { login } }
          contributions { totalCount }
        }
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date weekday contributionCount } }
        }
      }
    }
  }

  fragment repoFields on Repository {
    name
    nameWithOwner
    isPrivate
    pushedAt
    stargazerCount
    owner { login }
    primaryLanguage { name }
    languages(first: 8, orderBy: {field: SIZE, direction: DESC}) {
      edges { size node { name } }
    }
  }`);

  const u = data.user;
  const cc = u.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

  // Own repos plus repos contributed to elsewhere, so the card reflects participation, not just ownership.
  // Only public repos may be named on a public profile; private repo names must never be rendered.
  const contributed = u.repositoriesContributedTo.nodes.map((r) => ({ ...r, external: true }));
  const publicRepos = [...u.repositories.nodes, ...contributed]
    .filter((r) => !r.isPrivate && !BORING.test(r.name))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));

  // Rank the languages of the projects actually shipped in, newest first. Byte totals would rank a
  // notes dump above Cairn, and markup is excluded because the card claims programming languages.
  const MARKUP = new Set(["HTML", "CSS", "SCSS", "Sass", "Less"]);
  const langs = new Map();
  for (const repo of publicRepos) {
    const name = repo.primaryLanguage?.name;
    if (!name || MARKUP.has(name)) continue;
    const bytes = repo.languages.edges.find((e) => e.node.name === name)?.size ?? 0;
    const entry = langs.get(name) ?? { name, size: 0, repos: [] };
    entry.size += bytes;
    entry.repos.push(repo); // repos arrive newest-pushed first, so index 0 is the freshest
    langs.set(name, entry);
  }
  // Stars promote a language, otherwise recency of the newest project using it decides.
  const topLangs = [...langs.values()]
    .map((l) => ({ ...l, repos: [...l.repos].sort((a, b) => b.stargazerCount - a.stargazerCount || b.pushedAt.localeCompare(a.pushedAt)) }))
    .sort((a, b) => b.repos[0].stargazerCount - a.repos[0].stargazerCount || b.repos[0].pushedAt.localeCompare(a.repos[0].pushedAt))
    .slice(0, 5);

  // Day-of-week totals; GitHub reports weekday 0 as Sunday, so rotate to Mon..Sun.
  const byWeekday = Array(7).fill(0);
  for (const d of days) byWeekday[(d.weekday + 6) % 7] += d.contributionCount;

  const activeDays = days.filter((d) => d.contributionCount > 0);
  const weekend = byWeekday[5] + byWeekday[6];
  const total = byWeekday.reduce((a, b) => a + b, 0);
  const activeWeeks = cc.contributionCalendar.weeks.filter((w) =>
    w.contributionDays.some((d) => d.contributionCount > 0)
  ).length;

  return {
    login: u.login,
    topLangs,
    byWeekday,
    weekendPct: pct(weekend, total),
    weekdayPct: 100 - pct(weekend, total),
    avgPerActiveDay: activeDays.length ? Math.round(total / activeDays.length) : 0,
    activeWeeks,
    totalWeeks: cc.contributionCalendar.weeks.length,
    longestStreak: longestStreak(days),
    totalContributions: cc.contributionCalendar.totalContributions + cc.restrictedContributionsCount,
    // Anything under 1% renders as an unreadable sliver and a "0%" legend entry, so drop it.
    mix: (() => {
      const all = [
        { label: "Commits", value: cc.totalCommitContributions + cc.restrictedContributionsCount },
        { label: "PRs", value: cc.totalPullRequestContributions },
        { label: "Reviews", value: cc.totalPullRequestReviewContributions },
        { label: "Issues", value: cc.totalIssueContributions },
      ];
      const sum = all.reduce((a, m) => a + m.value, 0);
      return all.filter((m) => pct(m.value, sum) >= 1);
    })(),
    activeRepos: cc.commitContributionsByRepository
      .filter((r) => !r.repository.isPrivate && !BORING.test(r.repository.name))
      .map((r) => ({
        // External repos carry their owner so it is clear the work was on someone else's project.
        name: r.repository.owner.login === u.login ? r.repository.name : r.repository.nameWithOwner,
        external: r.repository.owner.login !== u.login,
        stars: r.repository.stargazerCount,
        count: r.contributions.totalCount,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

// Longest run of consecutive contributing days in the window. Preferred over the current streak,
// which reads as 0 on any ordinary day off and says nothing about the year.
function longestStreak(days) {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

function card(height, title, badge, body) {
  const badgeSvg = badge
    ? `<text x="${W - PAD}" y="34" fill="${C.dim}" font-size="11" letter-spacing="2" text-anchor="end">${esc(badge)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}">
  <rect x="0.75" y="0.75" width="${W - 1.5}" height="${height - 1.5}" rx="10" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5"/>
  <g font-family="${MONO}">
    <text x="${PAD}" y="34" fill="${C.muted}" font-size="11" letter-spacing="3">${esc(title)}</text>
    ${badgeSvg}
    <line x1="0" y1="50" x2="${W}" y2="50" stroke="${C.border}" stroke-width="1"/>
${body}
  </g>
</svg>
`;
}

// Rounded label pill; width is derived from the monospace advance so text never overflows.
function chip(x, y, label, size = 12, fg = C.text) {
  const w = textW(label, size) + 20;
  return {
    width: w,
    svg: `<g><rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="24" rx="5" fill="${C.panel}" stroke="${C.border}"/><text x="${(x + w / 2).toFixed(1)}" y="${y + 16}" fill="${fg}" font-size="${size}" text-anchor="middle">${esc(label)}</text></g>`,
  };
}

// Lays chips left to right, wrapping to a new line once maxW is exceeded. Returns the height used.
function chipRow(x, y, labels, size = 12, fg = C.text, maxW = W - PAD * 2) {
  const rowH = 32;
  let cx = x;
  let cy = y;
  const parts = [];
  for (const l of labels) {
    const w = textW(l, size) + 20;
    if (cx > x && cx + w > x + maxW) {
      cx = x;
      cy += rowH;
    }
    parts.push(chip(cx, cy, l, size, fg).svg);
    cx += w + 8;
  }
  return { svg: parts.join("\n"), height: cy - y + rowH };
}

function profileCard(d) {
  const indicators = d.topLangs
    .slice(0, 4)
    .map((l) => (l.repos[0].external ? `Contributed to ${l.repos[0].nameWithOwner} in ${l.name}` : `Built ${l.repos[0].name} using ${l.name}`));
  const evidence = [...new Set(d.topLangs.slice(0, 4).map((l) => l.repos[0].nameWithOwner))];

  const heading = "Programming Language Skills";
  let y = 84;
  const parts = [
    `<text x="${PAD}" y="${y}" fill="${C.text}" font-size="15" font-weight="700">${heading}</text>`,
    chipRow(PAD + textW(heading, 15) + 14, y - 17, d.topLangs.slice(0, 3).map((l) => l.name.toUpperCase()), 11, C.muted).svg,
  ];

  y += 34;
  parts.push(`<text x="${PAD}" y="${y}" fill="${C.dim}" font-size="11" letter-spacing="2">INDICATORS</text>`);
  y += 24;
  for (const line of indicators) {
    parts.push(
      `<text x="${PAD}" y="${y}" fill="${C.dim}" font-size="13">&#8211;</text>`,
      `<text x="${PAD + 18}" y="${y}" fill="${C.text}" font-size="13">${esc(line)}</text>`
    );
    y += 24;
  }

  y += 10;
  parts.push(`<text x="${PAD}" y="${y}" fill="${C.dim}" font-size="11" letter-spacing="2">EVIDENCE</text>`);
  y += 12;
  const chips = chipRow(PAD, y, evidence, 11, C.muted);
  parts.push(chips.svg);

  return card(y + chips.height + 14, "ENGINEER PROFILE", `${d.totalContributions} CONTRIBUTIONS / LAST 12 MONTHS`, parts.join("\n"));
}

function activityCard(d) {
  const total = d.mix.reduce((a, m) => a + m.value, 0);
  const barW = W - PAD * 2;
  let x = PAD;

  // Percentages are rounded per segment, so the last one absorbs the remainder to fill the bar exactly.
  const segs = d.mix.map((m, i) => {
    const isLast = i === d.mix.length - 1;
    const w = isLast ? PAD + barW - x : Math.round((m.value / total) * barW);
    const rect = `<rect x="${x}" y="86" width="${Math.max(w, 2)}" height="10" rx="2" fill="${SERIES[i % SERIES.length]}"/>`;
    x += w + 1;
    return rect;
  });

  let lx = PAD;
  const legend = d.mix.map((m, i) => {
    const label = `${m.label} ${pct(m.value, total)}%`;
    const g = `<g><rect x="${lx}" y="${112}" width="9" height="9" rx="2" fill="${SERIES[i % SERIES.length]}"/><text x="${lx + 15}" y="${120}" fill="${C.muted}" font-size="12">${esc(label)}</text></g>`;
    lx += textW(label, 12) + 34;
    return g;
  });

  const parts = [
    `<text x="${PAD}" y="${76}" fill="${C.dim}" font-size="11" letter-spacing="2">ACTIVITY BREAKDOWN</text>`,
    ...segs,
    ...legend,
    `<text x="${PAD}" y="${162}" fill="${C.dim}" font-size="11" letter-spacing="2">MOST ACTIVE REPOS</text>`,
  ];

  const own = d.activeRepos.filter((r) => !r.external).slice(0, 4);
  const ext = d.activeRepos.filter((r) => r.external && r.count >= MIN_EXTERNAL_COMMITS).slice(0, 3);

  const ownChips = chipRow(PAD, 176, own.map((r) => `${r.name}  ${r.count}`), 12, C.text);
  parts.push(ownChips.svg);
  let y = 176 + ownChips.height + 14;

  if (ext.length) {
    parts.push(`<text x="${PAD}" y="${y}" fill="${C.dim}" font-size="11" letter-spacing="2">OPEN-SOURCE CONTRIBUTION</text>`);
    y += 14;
    // A literal star glyph falls back to a bare asterisk in GitHub's renderer, so spell it out.
    const extChips = chipRow(
      PAD,
      y,
      ext.map((r) => `${r.name}  ${r.count} commits${r.stars ? `  ${r.stars} star${r.stars === 1 ? "" : "s"}` : ""}`),
      12,
      C.muted
    );
    parts.push(extChips.svg);
    y += extChips.height;
  }

  return card(y + 20, "RECENT ACTIVITY", "LAST 12 MONTHS", parts.join("\n"));
}

function habitsCard(d) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const max = Math.max(...d.byWeekday, 1);
  const colW = 88;
  const gap = 12;
  const baseY = 168;
  const maxH = 74;

  const bars = d.byWeekday.map((v, i) => {
    const h = Math.max(Math.round((v / max) * maxH), 3);
    const x = PAD + i * (colW + gap);
    const isWeekend = i >= 5;
    return `<g><rect x="${x}" y="${baseY - h}" width="${colW}" height="${h}" rx="3" fill="${isWeekend ? C.dim : C.accent}" opacity="${isWeekend ? 0.55 : 1}"/><text x="${x + colW / 2}" y="${baseY + 18}" fill="${isWeekend ? C.muted : C.dim}" font-size="11" text-anchor="middle">${labels[i]}</text></g>`;
  });

  const tileY = 232;
  const tile = (x, w, value, label) =>
    `<g><rect x="${x}" y="${tileY}" width="${w}" height="64" rx="6" fill="${C.panel}" stroke="${C.border}"/><text x="${x + 16}" y="${tileY + 32}" fill="${C.accent}" font-size="22" font-weight="700">${esc(value)}</text><text x="${x + 16}" y="${tileY + 50}" fill="${C.dim}" font-size="10" letter-spacing="2">${esc(label)}</text></g>`;

  const tileW = (W - PAD * 2 - 24) / 3;
  const parts = [
    `<text x="${PAD}" y="${76}" fill="${C.dim}" font-size="11" letter-spacing="2">ACTIVITY PATTERN</text>`,
    ...bars,
    `<line x1="${PAD}" y1="${baseY + 32}" x2="${W - PAD}" y2="${baseY + 32}" stroke="${C.border}"/>`,
    `<text x="${PAD}" y="${baseY + 52}" fill="${C.accent}" font-size="12">Weekdays ${d.weekdayPct}%</text>`,
    `<text x="${W - PAD}" y="${baseY + 52}" fill="${C.muted}" font-size="12" text-anchor="end">${d.weekendPct}% Weekends</text>`,
    tile(PAD, tileW, String(d.avgPerActiveDay), "AVG / ACTIVE DAY"),
    tile(PAD + tileW + 12, tileW, `${d.activeWeeks}/${d.totalWeeks}`, "ACTIVE WEEKS"),
    tile(PAD + (tileW + 12) * 2, tileW, `${d.longestStreak}d`, "LONGEST STREAK"),
  ];

  return card(tileY + 64 + PAD, "WORK HABITS & SCHEDULE", "LAST 12 MONTHS", parts.join("\n"));
}

const data = await collect();
await mkdir(OUT, { recursive: true });
await Promise.all([
  writeFile(new URL("stats-profile.svg", OUT), profileCard(data)),
  writeFile(new URL("stats-activity.svg", OUT), activityCard(data)),
  writeFile(new URL("stats-habits.svg", OUT), habitsCard(data)),
]);
console.log(`Wrote 3 cards for ${data.login}: ${data.totalContributions} contributions, ${data.longestStreak}d longest streak.`);
