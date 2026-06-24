#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function usage() {
  console.log(`Usage:
  node generate_visual_qa_summary.js --project <path> --slides 1,2,3 --out-json out/visual_qa_summary.json --out-md out/visual_qa_summary.md

Options:
  --project <path>   Project root.
  --slides <list>    Comma-separated slide numbers or ranges.
  --out-json <path>  Summary JSON path. Default: out/visual_qa_summary.json
  --out-md <path>    Summary Markdown path. Default: out/visual_qa_summary.md
  --help             Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    outJson: "out/visual_qa_summary.json",
    outMd: "out/visual_qa_summary.md",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--project") {
      args.project = argv[++i];
    } else if (arg === "--slides") {
      args.slides = argv[++i];
    } else if (arg === "--out-json") {
      args.outJson = argv[++i];
    } else if (arg === "--out-md") {
      args.outMd = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function parseSlides(value) {
  if (!value) throw new Error("--slides is required");
  const slides = [];
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-", 2);
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
        throw new Error(`Invalid slide range: ${part}`);
      }
      for (let slide = start; slide <= end; slide += 1) slides.push(slide);
    } else {
      const slide = Number.parseInt(part, 10);
      if (!Number.isInteger(slide) || slide <= 0) throw new Error(`Invalid slide number: ${part}`);
      slides.push(slide);
    }
  }
  return Array.from(new Set(slides)).sort((a, b) => a - b);
}

function slideDirName(slide) {
  return `slide${String(slide).padStart(2, "0")}`;
}

function resolvePath(project, value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(project, value);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function issueCounts(issues) {
  const counts = { blocking: 0, noticeable: 0, minor: 0 };
  for (const issue of issues || []) {
    if (Object.prototype.hasOwnProperty.call(counts, issue.severity)) counts[issue.severity] += 1;
  }
  return counts;
}

function repairWaves(rows) {
  const candidates = rows
    .filter((row) => row.status === "fail" || row.status === "needs_polish")
    .sort((a, b) => {
      const score = { blocking: 3, noticeable: 2, minor: 1, pass: 0 };
      return (score[b.severity] || 0) - (score[a.severity] || 0) || b.issueCount - a.issueCount || a.slide - b.slide;
    });
  const waves = [];
  for (let i = 0; i < candidates.length; i += 5) {
    waves.push(candidates.slice(i, i + 5).map((row) => row.slide));
  }
  return waves;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (!args.project) throw new Error("--project is required");
  const project = path.resolve(args.project);
  const slides = parseSlides(args.slides);
  const outJson = resolvePath(project, args.outJson);
  const outMd = resolvePath(project, args.outMd);

  const rows = [];
  const commonIssueTypes = {};
  const commonFixStrategies = {};
  const counts = { pass: 0, fail: 0, needs_polish: 0, missing: 0 };
  const issueSeverityCounts = { blocking: 0, noticeable: 0, minor: 0 };
  let cropRecommendations = 0;

  for (const slide of slides) {
    const visualDir = path.join(project, "work", slideDirName(slide), "visual_qa");
    const metricsPath = path.join(visualDir, "visual_metrics.json");
    const fixesPath = path.join(visualDir, "visual_polish_fixes.json");
    const metrics = readJson(metricsPath);
    const fixes = readJson(fixesPath);
    const issues = (fixes && Array.isArray(fixes.issues) ? fixes.issues : metrics && Array.isArray(metrics.issues) ? metrics.issues : []);
    const status = metrics ? metrics.overallStatus || metrics.status || "fail" : "missing";
    const severity = metrics ? metrics.severity || "blocking" : "blocking";
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    else counts.missing += 1;
    for (const issue of issues) {
      const type = issue.type || "other";
      commonIssueTypes[type] = (commonIssueTypes[type] || 0) + 1;
      if (issue.fixStrategy) {
        commonFixStrategies[issue.fixStrategy] = (commonFixStrategies[issue.fixStrategy] || 0) + 1;
      }
      if (issue.cropAllowed) cropRecommendations += 1;
      if (Object.prototype.hasOwnProperty.call(issueSeverityCounts, issue.severity)) {
        issueSeverityCounts[issue.severity] += 1;
      }
    }
    rows.push({
      slide,
      status,
      severity,
      issueCount: issues.length,
      issueCounts: issueCounts(issues),
      metricsPath,
      fixesPath,
      hasMetrics: Boolean(metrics),
      hasFixes: Boolean(fixes),
    });
  }

  const severityScore = { blocking: 3, noticeable: 2, minor: 1, pass: 0 };
  const worstSlides = rows
    .slice()
    .sort((a, b) => (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0) || b.issueCount - a.issueCount || a.slide - b.slide)
    .slice(0, 10);
  const summary = {
    createdAt: new Date().toISOString(),
    project,
    slidesRequested: slides,
    counts,
    passed: counts.pass,
    needsPolish: counts.needs_polish,
    failed: counts.fail,
    issueSeverityCounts,
    blockingIssues: issueSeverityCounts.blocking,
    noticeableIssues: issueSeverityCounts.noticeable,
    minorIssues: issueSeverityCounts.minor,
    commonIssueTypes: Object.fromEntries(Object.entries(commonIssueTypes).sort((a, b) => b[1] - a[1])),
    commonFixStrategies: Object.fromEntries(Object.entries(commonFixStrategies).sort((a, b) => b[1] - a[1])),
    cropRecommendations,
    worstSlides,
    recommendedNextRepairWaves: repairWaves(rows),
    slides: rows,
  };

  ensureDir(outJson);
  fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const md = [];
  md.push("# Visual QA Summary", "");
  md.push(`- Generated: ${summary.createdAt}`);
  md.push(`- Slides requested: ${slides.join(", ")}`);
  md.push(`- Passed: ${counts.pass}`);
  md.push(`- Failed: ${counts.fail}`);
  md.push(`- Needs polish: ${counts.needs_polish}`);
  md.push(`- Missing metrics: ${counts.missing}`, "");
  md.push("## Issue Severity Counts", "");
  md.push(`- Blocking issues: ${issueSeverityCounts.blocking}`);
  md.push(`- Noticeable issues: ${issueSeverityCounts.noticeable}`);
  md.push(`- Minor issues: ${issueSeverityCounts.minor}`, "");
  md.push("## Common Issue Types", "");
  const issueEntries = Object.entries(summary.commonIssueTypes);
  if (issueEntries.length) {
    for (const [type, count] of issueEntries) md.push(`- ${type}: ${count}`);
  } else {
    md.push("- None recorded.");
  }
  md.push("", "## Common Fix Strategies", "");
  const strategyEntries = Object.entries(summary.commonFixStrategies);
  if (strategyEntries.length) {
    for (const [strategy, count] of strategyEntries) md.push(`- ${strategy}: ${count}`);
  } else {
    md.push("- None recorded.");
  }
  md.push("", "## Crop Recommendations", "");
  md.push(`- Small non-text crop candidates: ${summary.cropRecommendations}`);
  md.push("", "## Worst Slides", "");
  if (worstSlides.length) {
    for (const row of worstSlides) {
      md.push(`- Slide ${row.slide}: ${row.status}/${row.severity}, ${row.issueCount} issue(s)`);
    }
  } else {
    md.push("- None.");
  }
  md.push("", "## Recommended Next Repair Waves", "");
  if (summary.recommendedNextRepairWaves.length) {
    summary.recommendedNextRepairWaves.forEach((wave, idx) => {
      md.push(`- Wave ${idx + 1}: ${wave.map((slide) => `slide ${slide}`).join(", ")}`);
    });
  } else {
    md.push("- No repair waves recommended.");
  }
  md.push("", "## Slide Table", "");
  md.push("| Slide | Status | Severity | Issues | Metrics | Fixes |");
  md.push("| --- | --- | --- | ---: | --- | --- |");
  for (const row of rows) {
    md.push(`| ${row.slide} | ${row.status} | ${row.severity} | ${row.issueCount} | ${row.hasMetrics ? "yes" : "missing"} | ${row.hasFixes ? "yes" : "missing"} |`);
  }

  ensureDir(outMd);
  fs.writeFileSync(outMd, `${md.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", outJson, outMd, counts }, null, 2));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  usage();
  process.exitCode = 1;
}
