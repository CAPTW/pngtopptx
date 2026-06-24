#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function usage() {
  console.log(`Usage:
  node enforce_visual_qa.js --project <path> --slides 1,2,3 --mode qa-draft|qa-strict|qa-polish --summary out/visual_qa_summary.json [--require-pptx] [--require-html]

Options:
  --project <path>   Project root.
  --slides <list>    Comma-separated slide numbers or ranges.
  --mode <mode>      qa-draft, qa-strict, or qa-polish.
  --summary <path>   Summary JSON path. Default: out/visual_qa_summary.json
  --require-pptx     Require PPTX raster artifacts.
  --require-html     Require HTML screenshot artifacts.
  --help             Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    mode: "qa-draft",
    summary: "out/visual_qa_summary.json",
    requirePptx: false,
    requireHtml: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--project") args.project = argv[++i];
    else if (arg === "--slides") args.slides = argv[++i];
    else if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--summary") args.summary = argv[++i];
    else if (arg === "--require-pptx") args.requirePptx = true;
    else if (arg === "--require-html") args.requireHtml = true;
    else throw new Error(`Unknown argument: ${arg}`);
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
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) throw new Error(`Invalid slide range: ${part}`);
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

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    return false;
  }
}

function metricIssues(metrics) {
  return Array.isArray(metrics && metrics.issues) ? metrics.issues : [];
}

function issueSignals(metrics) {
  return Array.isArray(metrics && metrics.issueSignals) ? metrics.issueSignals : [];
}

function hasBlockingIssue(metrics) {
  return metricIssues(metrics).some((issue) => issue.severity === "blocking");
}

function hasNoticeableIssue(metrics) {
  return metricIssues(metrics).some((issue) => issue.severity === "noticeable");
}

function hasExplicitBlockingCritical(metrics) {
  const criticalTypes = new Set([
    "missing_artifact",
    "missing_content",
    "full_slide_shortcut",
    "crop_shortcut",
    "content_loss",
    "missing_key_content",
    "clipping",
    "layout_break",
    "readability_loss",
    "wrong_slide",
  ]);
  return issueSignals(metrics).some((signal) => signal.severity === "blocking" && criticalTypes.has(signal.type)) ||
    metricIssues(metrics).some((issue) => issue.severity === "blocking" && criticalTypes.has(issue.type));
}

function materialPptxHtmlMismatch(metrics) {
  const calibrated = metrics && metrics.pptxHtmlConsistency;
  if (calibrated && calibrated.severity) {
    return calibrated.severity === "blocking" || calibrated.severity === "noticeable";
  }
  const comparison = metrics && metrics.comparisons && metrics.comparisons.pptx_vs_html;
  if (!comparison) return false;
  if (comparison.severity === "blocking" || comparison.severity === "noticeable") return true;
  const pixel = Number(comparison.pixel_difference_ratio || 0);
  const edge = Number(comparison.edge_difference_ratio || 0);
  const mae = Number(comparison.mean_absolute_error || 0);
  return pixel > 0.08 || edge > 0.1 || mae > 0.05;
}

function validateFixPlan(slide, fixes, metrics, mode, failures) {
  const status = metrics.status;
  const severity = metrics.severity;
  const needsFixes = status === "fail" || status === "needs_polish" || severity === "blocking" || severity === "noticeable";
  if (needsFixes && !fixes) {
    failures.push(`slide ${slide}: visual_polish_fixes.json is required for ${status}/${severity}`);
    return;
  }
  if (!fixes) return;
  if (!Array.isArray(fixes.issues)) {
    failures.push(`slide ${slide}: visual_polish_fixes.json issues must be an array`);
    return;
  }
  if (mode === "qa-polish") {
    const metricsIssues = Array.isArray(metrics.issues) ? metrics.issues : [];
    const actionableMetricsIssues = metricsIssues.filter((issue) => issue.severity === "blocking" || issue.severity === "noticeable");
    const actionableFixIssues = fixes.issues.filter((issue) => issue.severity === "blocking" || issue.severity === "noticeable");
    if (actionableFixIssues.length < actionableMetricsIssues.length) {
      failures.push(`slide ${slide}: qa-polish requires fix plans for all blocking/noticeable issues`);
    }
    for (const issue of actionableFixIssues) {
      if (!issue.recommendedFix || !issue.targetFile || !issue.region || typeof issue.region.x !== "number") {
        failures.push(`slide ${slide}: issue ${issue.id || "(missing id)"} lacks recommendedFix, targetFile, or numeric region`);
      }
      if (issue.safeToAutoApply !== false) {
        failures.push(`slide ${slide}: issue ${issue.id || "(missing id)"} must set safeToAutoApply to false`);
      }
      const fixText = `${issue.recommendedFix || ""} ${issue.targetFile || ""}`.toLowerCase();
      const negatedGateWeakening = fixText.includes("without weakening") || fixText.includes("do not weaken") || fixText.includes("not weaken");
      if (fixText.includes("weaken") && fixText.includes("gate") && !negatedGateWeakening) {
        failures.push(`slide ${slide}: issue ${issue.id || "(missing id)"} recommends weakening a gate`);
      }
      if (fixText.includes("full-slide crop") || fixText.includes("full slide crop")) {
        failures.push(`slide ${slide}: issue ${issue.id || "(missing id)"} recommends a full-slide crop`);
      }
      if (fixText.includes("save through powerpoint") || fixText.includes("direct pptx")) {
        failures.push(`slide ${slide}: issue ${issue.id || "(missing id)"} recommends direct PPTX repair/editing`);
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (!args.project) throw new Error("--project is required");
  if (!["qa-draft", "qa-strict", "qa-polish"].includes(args.mode)) throw new Error("--mode must be qa-draft, qa-strict, or qa-polish");

  const project = path.resolve(args.project);
  const slides = parseSlides(args.slides);
  const summaryPath = resolvePath(project, args.summary);
  const summary = readJson(summaryPath);
  const failures = [];
  const warnings = [];

  if (!summary) failures.push(`summary JSON missing or unreadable: ${summaryPath}`);

  for (const slide of slides) {
    const visualDir = path.join(project, "work", slideDirName(slide), "visual_qa");
    const required = [
      "source.png",
      "visual_metrics.json",
      "visual_polish_report.md",
    ];
    if (args.requirePptx) required.push("pptx_raster.png", "pptx_diff.png", "pptx_edge_diff.png");
    if (args.requireHtml) required.push("html_screenshot.png", "html_diff.png", "html_edge_diff.png");
    for (const name of required) {
      const file = path.join(visualDir, name);
      if (!fileExists(file)) failures.push(`slide ${slide}: missing ${path.relative(project, file)}`);
    }

    const metricsPath = path.join(visualDir, "visual_metrics.json");
    const fixesPath = path.join(visualDir, "visual_polish_fixes.json");
    const metrics = readJson(metricsPath);
    const fixes = readJson(fixesPath);
    if (!metrics) {
      failures.push(`slide ${slide}: visual_metrics.json missing or unreadable`);
      continue;
    }

    const status = metrics.overallStatus || metrics.status || "fail";
    const severity = metrics.severity || "blocking";
    const blocking = severity === "blocking" || status === "fail" || hasBlockingIssue(metrics);
    const noticeable = severity === "noticeable" || status === "needs_polish" || hasNoticeableIssue(metrics);

    if (args.mode === "qa-draft") {
      if (hasExplicitBlockingCritical(metrics)) {
        failures.push(`slide ${slide}: qa-draft blocks on explicit critical issue`);
      } else if (blocking || noticeable) {
        warnings.push(`slide ${slide}: ${status}/${severity} allowed in qa-draft`);
      }
    }

    if (args.mode === "qa-polish") {
      if (blocking) {
        failures.push(`slide ${slide}: qa-polish blocks on ${status}/${severity}`);
      } else if (noticeable) {
        warnings.push(`slide ${slide}: needs polish allowed in qa-polish because fix plan exists`);
      }
    }

    if (args.mode === "qa-strict") {
      if (blocking || noticeable) {
        failures.push(`slide ${slide}: qa-strict blocks on ${status}/${severity}`);
      }
      if (materialPptxHtmlMismatch(metrics)) {
        failures.push(`slide ${slide}: qa-strict blocks on material PPTX/HTML mismatch`);
      }
    }

    if (metrics.resizeApplied && !metrics.dimension_mismatch_justification) {
      failures.push(`slide ${slide}: source/render dimensions differ without recorded justification`);
    }

    validateFixPlan(slide, fixes, metrics, args.mode, failures);
  }

  const result = {
    status: failures.length ? "failed" : "ok",
    mode: args.mode,
    project,
    slides,
    summary: summaryPath,
    failures,
    warnings,
  };
  console.log(JSON.stringify(result, null, 2));
  return failures.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  usage();
  process.exitCode = 1;
}
