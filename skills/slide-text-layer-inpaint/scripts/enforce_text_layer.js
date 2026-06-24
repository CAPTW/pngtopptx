#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REQUIRED_FILES = [
  "text_regions.json",
  "text_mask.png",
  "pseudo_text_mask.png",
  "inpaint_mask.png",
  "mask_overlay.png",
  "clean_background.png",
  "inpainting_report.json",
  "inpainting_report.md",
];

const SUPPORTED_TEXT_REGION_SCHEMA_VERSIONS = new Set([
  "slide-text-layer-inpaint.text_regions.v1",
]);

const COORDINATE_UNITS = "source_px";
const ALLOWED_REPAIR_METHODS = new Set(["redraw", "inpaint", "manual_review", "native_reconstruct"]);
const REDRAW_BACKGROUND_TYPES = new Set(["flat_color", "panel", "table_cell"]);
const RISK_RANK = { low: 0, medium: 1, high: 2 };

const VALID_CLASSES = new Set([
  "semantic_text",
  "pseudo_text",
  "micro_text",
  "decorative_glyph",
  "unknown_text",
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function usage() {
  return `Usage:
  node scripts/enforce_text_layer.js --slide work/slide01
  node scripts/enforce_text_layer.js --slide work/slide01 --image src/slide01.png --strict
  node scripts/enforce_text_layer.js --work work --slides 1,2,3

Validates the slide-text-layer-inpaint artifact contract:
  text_regions.json
  text_mask.png
  pseudo_text_mask.png
  inpaint_mask.png
  mask_overlay.png
  clean_background.png
  inpainting_report.json
  inpainting_report.md

Rules enforced:
  - OCR evidence is not treated as truth.
  - semantic_text requires correctedText.
  - pseudo_text and decorative_glyph cannot carry corrected/native text.
  - unknown_text fails unless exception-approved with a reason.
  - inpainting reports must declare background-cleanup-only policy.
  - strict mode requires background_regions.json and residual_text_report.json.
  - flat/panel/table text regions must use redraw rather than generic inpaint.
  - residual text risk must not exceed --max-residual-risk.
  - strict mode requires source image integrity metadata.
  - when --image is provided, sourceImageHash and coordinateSpace must match that image.

Options:
  --slide <dir>       Validate one work/slideXX directory. Can be repeated.
  --image <path>      Source image for integrity checks. Valid only with one slide.
  --strict            Require current metadata; legacy artifacts without metadata fail.
  --require-residual-check
                      Require residual_text_report.json even outside strict mode.
  --max-residual-risk <low|medium|high>
                      Maximum accepted residual text risk. Default: medium.
  --work <dir>        Work root used with --slides.
  --slides <list>     Comma list such as 1,2,5 or slide01,slide02.
  --json              Emit machine-readable JSON.
  --help              Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    slides: [],
    json: false,
    help: false,
    strict: false,
    requireResidualCheck: false,
    maxResidualRisk: "medium",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--require-residual-check") {
      args.requireResidualCheck = true;
    } else if (arg === "--max-residual-risk") {
      const value = argv[++i];
      if (!value || !Object.prototype.hasOwnProperty.call(RISK_RANK, value)) {
        throw new Error("--max-residual-risk requires one of: low, medium, high");
      }
      args.maxResidualRisk = value;
    } else if (arg === "--slide") {
      const value = argv[++i];
      if (!value) throw new Error("--slide requires a directory");
      args.slides.push(value);
    } else if (arg === "--image") {
      const value = argv[++i];
      if (!value) throw new Error("--image requires a source image path");
      args.image = value;
    } else if (arg === "--work") {
      const value = argv[++i];
      if (!value) throw new Error("--work requires a directory");
      args.work = value;
    } else if (arg === "--slides") {
      const value = argv[++i];
      if (!value) throw new Error("--slides requires a list");
      args.slideList = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (args.work && args.slideList) {
    for (const item of args.slideList.split(",").map((s) => s.trim()).filter(Boolean)) {
      const name = /^slide\d+$/i.test(item) ? item : `slide${String(Number(item)).padStart(2, "0")}`;
      if (!/^slide\d+$/i.test(name)) throw new Error(`invalid slide id: ${item}`);
      args.slides.push(path.join(args.work, name));
    }
  }

  if (args.image && args.slides.length > 1) {
    throw new Error("--image can only be used when validating exactly one slide");
  }

  return args;
}

function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function isPng(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    return buffer.equals(PNG_SIGNATURE);
  } finally {
    fs.closeSync(fd);
  }
}

function readImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      format: "png",
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) break;
      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
          format: "jpeg",
        };
      }
      offset += length;
    }
  }

  throw new Error(`unsupported source image format for dimension checks: ${filePath}`);
}

function loadSourceImageInfo(imagePath) {
  const resolved = path.resolve(imagePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`source image not found: ${resolved}`);
  }
  const dimensions = readImageDimensions(resolved);
  return {
    path: resolved,
    sha256: fileSha256(resolved),
    width: dimensions.width,
    height: dimensions.height,
    format: dimensions.format,
  };
}

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${filePath}: invalid JSON: ${error.message}`);
    return null;
  }
}

function readOptionalJson(filePath, errors) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath, errors);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function riskRank(value) {
  return RISK_RANK[value] ?? RISK_RANK.high;
}

function validateRegion(region, index, errors, warnings, counts) {
  const rid = String(region && region.id ? region.id : `#${index + 1}`);
  if (!region || typeof region !== "object" || Array.isArray(region)) {
    errors.push(`${rid}: region must be an object`);
    return;
  }

  const cls = region.class;
  counts[cls || "missing"] = (counts[cls || "missing"] || 0) + 1;
  if (!VALID_CLASSES.has(cls)) {
    errors.push(`${rid}: invalid class ${JSON.stringify(cls)}`);
  }

  const bbox = region.bbox;
  if (!bbox || typeof bbox !== "object" || Array.isArray(bbox)) {
    errors.push(`${rid}: missing bbox`);
  } else {
    for (const key of ["x", "y", "w", "h"]) {
      if (!isNumber(bbox[key])) {
        errors.push(`${rid}: bbox.${key} must be numeric`);
      }
    }
    if (isNumber(bbox.w) && bbox.w <= 0) errors.push(`${rid}: bbox.w must be positive`);
    if (isNumber(bbox.h) && bbox.h <= 0) errors.push(`${rid}: bbox.h must be positive`);
  }

  if (region.evidence && region.evidence.ocrText && !region.evidence.notes) {
    warnings.push(`${rid}: OCR evidence present without evidence.notes`);
  }

  if (cls === "semantic_text") {
    if (typeof region.correctedText !== "string" || region.correctedText.trim() === "") {
      errors.push(`${rid}: semantic_text requires non-empty correctedText`);
    }
    const evidence = region.evidence && typeof region.evidence === "object" ? region.evidence : {};
    const previousClass = region.originalClass || region.previousClass || evidence.originalClass || evidence.previousClass;
    if (previousClass === "pseudo_text" && region.promotionApproved !== true) {
      errors.push(`${rid}: pseudo_text cannot be promoted to semantic_text without promotionApproved`);
    }
  }

  if (cls === "pseudo_text" || cls === "decorative_glyph") {
    if (typeof region.correctedText === "string" && region.correctedText.trim() !== "") {
      errors.push(`${rid}: ${cls} must not have correctedText`);
    }
    if (typeof region.nativeText === "string" && region.nativeText.trim() !== "") {
      errors.push(`${rid}: ${cls} must not have nativeText`);
    }
    if (region.nativeReconstruction && region.nativeReconstruction.required === true) {
      errors.push(`${rid}: ${cls} must not require native reconstruction`);
    }
  }

  if (cls === "unknown_text") {
    if (!(region.exceptionApproved === true && typeof region.exceptionReason === "string" && region.exceptionReason.trim())) {
      errors.push(`${rid}: unknown_text must be resolved or exception-approved with exceptionReason`);
    }
  }
}

function validateBackgroundRegions(backgroundDoc, result) {
  if (!backgroundDoc) return new Map();
  if (backgroundDoc.schemaVersion !== "slide-text-layer-inpaint.background_regions.v1") {
    result.errors.push("background_regions.json: invalid or missing schemaVersion");
  }
  if (!Array.isArray(backgroundDoc.regions)) {
    result.errors.push("background_regions.json: regions must be an array");
    return new Map();
  }
  const byId = new Map();
  const validTypes = new Set([
    "flat_color",
    "gradient",
    "panel",
    "table_cell",
    "rule_line",
    "icon_area",
    "chart_area",
    "photo_texture",
    "complex_unknown",
  ]);
  const validRecommendations = new Set(["redraw", "inpaint", "native_reconstruct", "manual_review"]);
  for (const item of backgroundDoc.regions) {
    if (!item || typeof item !== "object") {
      result.errors.push("background_regions.json: each region must be an object");
      continue;
    }
    const id = String(item.textRegionId || "");
    if (!id) result.errors.push("background_regions.json: region missing textRegionId");
    if (!validTypes.has(item.backgroundType)) {
      result.errors.push(`${id || "background region"}: invalid backgroundType ${JSON.stringify(item.backgroundType)}`);
    }
    if (!validRecommendations.has(item.recommendedRepair)) {
      result.errors.push(`${id || "background region"}: invalid recommendedRepair ${JSON.stringify(item.recommendedRepair)}`);
    }
    byId.set(id, item);
  }
  return byId;
}

function validateInpaintingReport(report, result, backgroundById) {
  if (!report) return;
  if (report.schemaVersion !== "slide-text-layer-inpaint.inpainting_report.v1") {
    result.errors.push("inpainting_report.json: invalid or missing schemaVersion");
  }
  const policy = report.policy || {};
  if (!(policy.backgroundCleanupOnly === true || policy.inpaintingOnly === true)) {
    result.errors.push("inpainting_report.json: policy.backgroundCleanupOnly or policy.inpaintingOnly must be true");
  }
  if (policy.nativeReconstructionReplacement !== false) {
    result.errors.push("inpainting_report.json: policy.nativeReconstructionReplacement must be false");
  }
  if (report.policyStatus === "fail" || report.status === "fail") {
    result.errors.push("inpainting_report.json: status is fail");
  }
  if (Array.isArray(report.errors) && report.errors.length > 0) {
    result.errors.push(`inpainting_report.json: contains errors: ${report.errors.join("; ")}`);
  }

  const methodsUsed = report.methodsUsed || {};
  for (const key of Object.keys(methodsUsed)) {
    const normalized = key === "manualReview" ? "manual_review" : key === "nativeReconstruct" ? "native_reconstruct" : key;
    if (!ALLOWED_REPAIR_METHODS.has(normalized)) {
      result.errors.push(`inpainting_report.json: unsupported repair method in methodsUsed: ${key}`);
    }
  }

  if (!Array.isArray(report.regions)) {
    result.warnings.push("inpainting_report.json: regions array missing; strict repair-method checks are limited");
    return;
  }

  for (const region of report.regions) {
    if (!region || typeof region !== "object") continue;
    const id = String(region.id || "");
    const method = region.repairMethod;
    if (!ALLOWED_REPAIR_METHODS.has(method)) {
      result.errors.push(`${id || "report region"}: invalid repairMethod ${JSON.stringify(method)}`);
    }
    const background = backgroundById.get(id);
    const backgroundType = region.backgroundType || (background && background.backgroundType);
    const recommended = background && background.recommendedRepair;
    if ((REDRAW_BACKGROUND_TYPES.has(backgroundType) || recommended === "redraw") && method === "inpaint") {
      result.errors.push(`${id}: ${backgroundType} background must use redraw, not generic inpaint`);
    }
    if (backgroundType === "complex_unknown" && region.status === "pass") {
      const notes = typeof region.notes === "string" ? region.notes.trim() : "";
      const evidence = region.evidence && typeof region.evidence === "object" ? region.evidence : null;
      if (method === "inpaint" || (!notes && !evidence)) {
        result.errors.push(`${id}: complex_unknown cannot be marked pass without review or reconstruction evidence`);
      }
    }
  }
}

function validateResidualReport(report, result, options) {
  if (!report) return;
  if (report.schemaVersion !== "slide-text-layer-inpaint.residual_text_report.v1") {
    result.errors.push("residual_text_report.json: invalid or missing schemaVersion");
  }
  if (report.status === "fail") {
    result.errors.push("residual_text_report.json: status is fail");
  }
  const risk = report.residualTextRisk || "high";
  if (riskRank(risk) > riskRank(options.maxResidualRisk)) {
    result.errors.push(`residual_text_report.json: residualTextRisk ${risk} exceeds max ${options.maxResidualRisk}`);
  } else if (risk === "medium") {
    result.warnings.push("residual_text_report.json: medium residual risk requires manual review");
  }
  if (Array.isArray(report.regions)) {
    for (const region of report.regions) {
      if (!region || typeof region !== "object") {
        result.errors.push("residual_text_report.json: each region must be an object");
        continue;
      }
      const rid = region.id || "residual region";
      const regionRisk = region && region.residualRisk;
      if (riskRank(regionRisk) > riskRank(options.maxResidualRisk)) {
        result.errors.push(`${rid}: residualRisk ${regionRisk} exceeds max ${options.maxResidualRisk}`);
      } else if (regionRisk === "medium") {
        result.warnings.push(`${rid}: medium residual risk requires manual review`);
      }
    }
  }
}

function validateTextRegionMetadata(regionsDoc, result, options) {
  const version = regionsDoc.schemaVersion;
  if (!SUPPORTED_TEXT_REGION_SCHEMA_VERSIONS.has(version)) {
    result.errors.push(`text_regions.json: unsupported schemaVersion ${JSON.stringify(version)}`);
  }

  const sourceHash = regionsDoc.sourceImageHash;
  const hasSourceHash = typeof sourceHash === "string" && sourceHash.trim() !== "";
  const sourceHashLooksValid = hasSourceHash && /^[a-f0-9]{64}$/i.test(sourceHash);
  if (!hasSourceHash) {
    const msg = "text_regions.json: missing sourceImageHash";
    if (options.strict || options.sourceImage) result.errors.push(msg);
    else result.warnings.push(`${msg} (legacy mode)`);
  } else if (!sourceHashLooksValid) {
    result.errors.push("text_regions.json: sourceImageHash must be a 64-character SHA-256 hex string");
  }

  const cs = regionsDoc.coordinateSpace;
  const hasCoordinateSpace = cs && typeof cs === "object" && !Array.isArray(cs);
  if (!hasCoordinateSpace) {
    const msg = "text_regions.json: missing coordinateSpace";
    if (options.strict || options.sourceImage) result.errors.push(msg);
    else result.warnings.push(`${msg} (legacy mode)`);
  } else {
    if (!Number.isInteger(cs.width) || cs.width <= 0) {
      result.errors.push("text_regions.json: coordinateSpace.width must be a positive integer");
    }
    if (!Number.isInteger(cs.height) || cs.height <= 0) {
      result.errors.push("text_regions.json: coordinateSpace.height must be a positive integer");
    }
    if (cs.units !== COORDINATE_UNITS) {
      result.errors.push(`text_regions.json: coordinateSpace.units must be ${JSON.stringify(COORDINATE_UNITS)}`);
    }
  }

  if (!options.sourceImage) return;

  if (sourceHashLooksValid && sourceHash.toLowerCase() !== options.sourceImage.sha256.toLowerCase()) {
    result.errors.push(
      `text_regions.json: sourceImageHash mismatch for ${options.sourceImage.path}`
    );
  }

  if (hasCoordinateSpace && Number.isInteger(cs.width) && Number.isInteger(cs.height)) {
    if (cs.width !== options.sourceImage.width || cs.height !== options.sourceImage.height) {
      result.errors.push(
        `text_regions.json: coordinateSpace ${cs.width}x${cs.height} does not match source image ${options.sourceImage.width}x${options.sourceImage.height}`
      );
    }
  }
}

function validateSlide(slideDir, options = {}) {
  const result = {
    slideDir,
    ok: true,
    errors: [],
    warnings: [],
    files: {},
    counts: {},
  };

  if (!fs.existsSync(slideDir) || !fs.statSync(slideDir).isDirectory()) {
    result.errors.push(`slide directory not found: ${slideDir}`);
    result.ok = false;
    return result;
  }

  for (const name of REQUIRED_FILES) {
    const filePath = path.join(slideDir, name);
    if (!fs.existsSync(filePath)) {
      result.errors.push(`missing required artifact: ${name}`);
      continue;
    }
    result.files[name] = { sha256: fileSha256(filePath) };
    if (name.endsWith(".png") && !isPng(filePath)) {
      result.errors.push(`${name}: not a valid PNG file`);
    }
  }

  if (options.strict && !fs.existsSync(path.join(slideDir, "background_regions.json"))) {
    result.errors.push("missing required strict artifact: background_regions.json");
  }
  const residualRequired = options.strict || options.requireResidualCheck;
  if (residualRequired && !fs.existsSync(path.join(slideDir, "residual_text_report.json"))) {
    result.errors.push("missing required residual artifact: residual_text_report.json");
  }

  const regionsPath = path.join(slideDir, "text_regions.json");
  const regionsDoc = fs.existsSync(regionsPath) ? readJson(regionsPath, result.errors) : null;
  if (regionsDoc) {
    validateTextRegionMetadata(regionsDoc, result, options);
    if (!regionsDoc.policy || regionsDoc.policy.ocrIsEvidenceOnly !== true) {
      result.errors.push("text_regions.json: policy.ocrIsEvidenceOnly must be true");
    }
    if (!Array.isArray(regionsDoc.regions)) {
      result.errors.push("text_regions.json: regions must be an array");
    } else {
      const seen = new Set();
      regionsDoc.regions.forEach((region, index) => {
        const rid = region && region.id ? String(region.id) : `#${index + 1}`;
        if (seen.has(rid)) result.errors.push(`${rid}: duplicate region id`);
        seen.add(rid);
        validateRegion(region, index, result.errors, result.warnings, result.counts);
      });
    }
  }

  const backgroundDoc = readOptionalJson(path.join(slideDir, "background_regions.json"), result.errors);
  const backgroundById = validateBackgroundRegions(backgroundDoc, result);

  const reportPath = path.join(slideDir, "inpainting_report.json");
  const report = fs.existsSync(reportPath) ? readJson(reportPath, result.errors) : null;
  validateInpaintingReport(report, result, backgroundById);

  const residualDoc = readOptionalJson(path.join(slideDir, "residual_text_report.json"), result.errors);
  validateResidualReport(residualDoc, result, options);

  result.ok = result.errors.length === 0;
  return result;
}

function printHuman(results) {
  let ok = true;
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS ${result.slideDir}`);
    } else {
      ok = false;
      console.log(`FAIL ${result.slideDir}`);
    }
    for (const error of result.errors) console.log(`  error: ${error}`);
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    const countText = Object.entries(result.counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    if (countText) console.log(`  regions: ${countText}`);
  }
  return ok;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    console.error(usage());
    return 2;
  }

  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (!args.slides.length) {
    console.error("error: provide --slide or --work with --slides");
    console.error(usage());
    return 2;
  }

  let sourceImage = null;
  if (args.image) {
    try {
      sourceImage = loadSourceImageInfo(args.image);
    } catch (error) {
      console.error(`error: ${error.message}`);
      return 2;
    }
  }

  const options = {
    strict: args.strict,
    sourceImage,
    requireResidualCheck: args.requireResidualCheck,
    maxResidualRisk: args.maxResidualRisk,
  };
  const results = args.slides.map((slideDir) => validateSlide(path.resolve(slideDir), options));
  if (args.json) {
    console.log(JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2));
  } else {
    printHuman(results);
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}
