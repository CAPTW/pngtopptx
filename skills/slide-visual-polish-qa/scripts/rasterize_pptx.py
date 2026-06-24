#!/usr/bin/env python3
"""Diagnostic PPTX rasterization for slide visual QA.

This script exports requested PPTX slides to PNG files for comparison only. It
must never save, repair, or modify the PPTX.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

from slide_mapping import (
    SlideMapEntry,
    SlideMappingError,
    mapping_metadata,
    resolve_slide_mapping,
    slide_dir_name,
)


class RasterError(RuntimeError):
    pass


class ToolUnavailable(RasterError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_path(project: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = project / path
    return path.resolve()

def qa_dir(out_dir: Path, slide: int) -> Path:
    path = out_dir / slide_dir_name(slide) / "visual_qa"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )


def find_soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    if platform.system().lower() == "windows":
        candidates = [
            Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "LibreOffice/program/soffice.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "LibreOffice/program/soffice.exe",
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
    return None


def find_pdftoppm() -> str | None:
    return shutil.which("pdftoppm")


def find_magick() -> str | None:
    magick = shutil.which("magick")
    if magick:
        return magick
    convert = shutil.which("convert")
    if not convert:
        return None
    try:
        result = run([convert, "-version"], timeout=10)
    except Exception:
        return None
    if "imagemagick" in f"{result.stdout}\n{result.stderr}".lower():
        return convert
    return None


def export_with_powerpoint(pptx: Path, mappings: list[SlideMapEntry], out_dir: Path, dpi: int) -> dict:
    if platform.system().lower() != "windows":
        raise ToolUnavailable("PowerPoint COM export is only available on Windows")
    try:
        import win32com.client  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on local install
        raise ToolUnavailable(f"pywin32/PowerPoint COM is unavailable: {exc}") from exc

    app = None
    presentation = None
    exported: list[dict] = []
    try:  # pragma: no cover - depends on local install
        app = win32com.client.DispatchEx("PowerPoint.Application")
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        presentation = app.Presentations.Open(str(pptx), ReadOnly=True, Untitled=False, WithWindow=False)
        slide_count = int(presentation.Slides.Count)
        width_px = int(round(float(presentation.PageSetup.SlideWidth) / 72.0 * dpi))
        height_px = int(round(float(presentation.PageSetup.SlideHeight) / 72.0 * dpi))
        for entry in mappings:
            if entry.physical_slide > slide_count:
                raise RasterError(
                    f"source slide {entry.source_slide} maps to physical slide {entry.physical_slide}, "
                    f"but deck has {slide_count} slides"
                )
            dest = qa_dir(out_dir, entry.source_slide) / "pptx_raster.png"
            presentation.Slides(entry.physical_slide).Export(str(dest), "PNG", width_px, height_px)
            if not dest.exists() or dest.stat().st_size == 0:
                raise RasterError(f"PowerPoint did not create {dest}")
            exported.append(
                {
                    "slide": entry.source_slide,
                    "sourceSlideId": entry.source_slide,
                    "physicalSlideIndex": entry.physical_slide,
                    "htmlSlideIndex": entry.html_slide,
                    "mappingMode": entry.mapping_mode,
                    "mappingInferred": entry.inferred,
                    "traceBased": entry.trace_based,
                    "path": str(dest),
                    "width": width_px,
                    "height": height_px,
                    "sha256": sha256_file(dest),
                }
            )
            write_json(
                dest.with_name("pptx_raster_metadata.json"),
                {
                    "createdAt": utc_now(),
                    "tool": "powerpoint-com",
                    "diagnosticOnly": True,
                    "pptx": str(pptx),
                    "pptxSha256": sha256_file(pptx),
                    "slide": entry.source_slide,
                    "sourceSlideId": entry.source_slide,
                    "physicalSlideIndex": entry.physical_slide,
                    "htmlSlideIndex": entry.html_slide,
                    "mappingMode": entry.mapping_mode,
                    "mappingInferred": entry.inferred,
                    "traceBased": entry.trace_based,
                    "dpi": dpi,
                    "width": width_px,
                    "height": height_px,
                    "output": str(dest),
                    "outputSha256": sha256_file(dest),
                    "modifiedPptx": False,
                },
            )
    except Exception as exc:
        raise RasterError(f"PowerPoint diagnostic export failed: {exc}") from exc
    finally:
        if presentation is not None:
            try:
                presentation.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass

    return {"tool": "powerpoint-com", "exported": exported}


def export_pdf_to_png_with_pdftoppm(pdf: Path, mappings: list[SlideMapEntry], out_dir: Path, dpi: int) -> list[dict]:
    pdftoppm = find_pdftoppm()
    if not pdftoppm:
        raise ToolUnavailable("pdftoppm was not found; install Poppler or use another rasterization path")
    exported: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="visual-qa-pdf-") as tmp_s:
        tmp = Path(tmp_s)
        for entry in mappings:
            prefix = tmp / f"source-slide{entry.source_slide:02d}"
            cmd = [
                pdftoppm,
                "-png",
                "-r",
                str(dpi),
                "-f",
                str(entry.physical_slide),
                "-l",
                str(entry.physical_slide),
                "-singlefile",
                str(pdf),
                str(prefix),
            ]
            result = run(cmd)
            if result.returncode != 0:
                raise RasterError(
                    f"pdftoppm failed for source slide {entry.source_slide} "
                    f"(physical {entry.physical_slide}): {result.stderr.strip() or result.stdout.strip()}"
                )
            src = prefix.with_suffix(".png")
            if not src.exists():
                raise RasterError(f"pdftoppm did not create expected PNG for source slide {entry.source_slide}")
            dest = qa_dir(out_dir, entry.source_slide) / "pptx_raster.png"
            shutil.copyfile(src, dest)
            exported.append(
                {
                    "slide": entry.source_slide,
                    "sourceSlideId": entry.source_slide,
                    "physicalSlideIndex": entry.physical_slide,
                    "htmlSlideIndex": entry.html_slide,
                    "mappingMode": entry.mapping_mode,
                    "mappingInferred": entry.inferred,
                    "traceBased": entry.trace_based,
                    "path": str(dest),
                    "sha256": sha256_file(dest),
                }
            )
    return exported


def export_pdf_to_png_with_magick(pdf: Path, mappings: list[SlideMapEntry], out_dir: Path, dpi: int) -> list[dict]:
    magick = find_magick()
    if not magick:
        raise ToolUnavailable("ImageMagick was not found")
    exported: list[dict] = []
    for entry in mappings:
        dest = qa_dir(out_dir, entry.source_slide) / "pptx_raster.png"
        cmd = [
            magick,
            "-density",
            str(dpi),
            f"{pdf}[{entry.physical_slide - 1}]",
            "-alpha",
            "remove",
            "-background",
            "white",
            str(dest),
        ]
        result = run(cmd)
        if result.returncode != 0:
            raise RasterError(
                f"ImageMagick failed for source slide {entry.source_slide} "
                f"(physical {entry.physical_slide}): {result.stderr.strip() or result.stdout.strip()}"
            )
        if not dest.exists() or dest.stat().st_size == 0:
            raise RasterError(f"ImageMagick did not create {dest}")
        exported.append(
            {
                "slide": entry.source_slide,
                "sourceSlideId": entry.source_slide,
                "physicalSlideIndex": entry.physical_slide,
                "htmlSlideIndex": entry.html_slide,
                "mappingMode": entry.mapping_mode,
                "mappingInferred": entry.inferred,
                "traceBased": entry.trace_based,
                "path": str(dest),
                "sha256": sha256_file(dest),
            }
        )
    return exported


def export_with_libreoffice(pptx: Path, mappings: list[SlideMapEntry], out_dir: Path, dpi: int) -> dict:
    soffice = find_soffice()
    if not soffice:
        raise ToolUnavailable("LibreOffice/soffice was not found")
    with tempfile.TemporaryDirectory(prefix="visual-qa-lo-") as tmp_s:
        tmp = Path(tmp_s)
        cmd = [
            soffice,
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(tmp),
            str(pptx),
        ]
        result = run(cmd, timeout=180)
        combined = f"{result.stdout}\n{result.stderr}".lower()
        if "repair" in combined or "corrupt" in combined:
            raise RasterError("LibreOffice reported repair/corruption during diagnostic open; refusing to continue")
        if result.returncode != 0:
            raise RasterError(f"LibreOffice PDF export failed: {result.stderr.strip() or result.stdout.strip()}")
        pdf = tmp / f"{pptx.stem}.pdf"
        if not pdf.exists():
            pdfs = list(tmp.glob("*.pdf"))
            if not pdfs:
                raise RasterError("LibreOffice did not create a PDF for diagnostic rasterization")
            pdf = pdfs[0]

        converter = "pdftoppm"
        try:
            exported = export_pdf_to_png_with_pdftoppm(pdf, mappings, out_dir, dpi)
        except ToolUnavailable:
            converter = "imagemagick"
            exported = export_pdf_to_png_with_magick(pdf, mappings, out_dir, dpi)

        for item in exported:
            dest = Path(item["path"])
            write_json(
                dest.with_name("pptx_raster_metadata.json"),
                {
                    "createdAt": utc_now(),
                    "tool": "libreoffice-pdf",
                    "pdfRasterizer": converter,
                    "diagnosticOnly": True,
                    "pptx": str(pptx),
                    "pptxSha256": sha256_file(pptx),
                    "slide": int(item["sourceSlideId"]),
                    "sourceSlideId": int(item["sourceSlideId"]),
                    "physicalSlideIndex": int(item["physicalSlideIndex"]),
                    "htmlSlideIndex": int(item["htmlSlideIndex"]),
                    "mappingMode": item["mappingMode"],
                    "mappingInferred": bool(item["mappingInferred"]),
                    "traceBased": bool(item["traceBased"]),
                    "dpi": dpi,
                    "output": str(dest),
                    "outputSha256": sha256_file(dest),
                    "modifiedPptx": False,
                },
            )
    return {"tool": "libreoffice-pdf", "exported": exported}


def write_error_reports(project: Path, out_dir: Path, mappings: list[SlideMapEntry], pptx: Path, errors: list[str]) -> None:
    slides = [entry.source_slide for entry in mappings]
    payload = {
        "createdAt": utc_now(),
        "status": "failed",
        "diagnosticOnly": True,
        "pptx": str(pptx),
        "pptxSha256": sha256_file(pptx),
        "slides": slides,
        "mapping": mapping_metadata(mappings),
        "errors": errors,
        "setup": [
            "Install LibreOffice plus Poppler pdftoppm for diagnostic PPTX rasterization.",
            "On Windows, install Microsoft PowerPoint plus pywin32 for read-only COM export.",
            "Do not save or repair the PPTX through these tools.",
        ],
    }
    write_json(project / "out" / "visual_qa_rasterize_error.json", payload)
    for entry in mappings:
        write_json(
            qa_dir(out_dir, entry.source_slide) / "pptx_raster_error.json",
            payload
            | {
                "slide": entry.source_slide,
                "sourceSlideId": entry.source_slide,
                "physicalSlideIndex": entry.physical_slide,
                "htmlSlideIndex": entry.html_slide,
                "mappingMode": entry.mapping_mode,
                "mappingInferred": entry.inferred,
                "traceBased": entry.trace_based,
            },
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rasterize PPTX slides for diagnostic visual QA only.")
    parser.add_argument("--pptx", required=True, help="Path to PPTX file.")
    parser.add_argument("--out-dir", required=True, help="Output work directory, usually work.")
    parser.add_argument("--slides", help="Legacy physical output slide numbers, for example 1,2,5-7.")
    parser.add_argument("--source-slides", help="Original source slide IDs. For wave PPTX outputs, maps sequentially to physical slides 1..N.")
    parser.add_argument("--physical-slides", help="Physical PPTX slide numbers paired with --source-slides.")
    parser.add_argument("--slide-map", help="JSON file mapping sourceSlide to physicalSlide/htmlSlide.")
    parser.add_argument("--trace", help="Renderer trace JSON containing selected source slide ordering.")
    parser.add_argument("--dpi", type=int, default=144, help="Raster DPI. Default: 144.")
    parser.add_argument("--project", default=".", help="Project root. Default: current directory.")
    args = parser.parse_args(argv)

    project = Path(args.project).expanduser().resolve()
    pptx = resolve_path(project, args.pptx)
    out_dir = resolve_path(project, args.out_dir)
    try:
        mappings = resolve_slide_mapping(
            slides=args.slides,
            source_slides=args.source_slides,
            physical_slides=args.physical_slides,
            slide_map=resolve_path(project, args.slide_map) if args.slide_map else None,
            trace=resolve_path(project, args.trace) if args.trace else None,
        )
    except SlideMappingError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    slides = [entry.source_slide for entry in mappings]

    if not pptx.exists():
        print(f"ERROR: PPTX not found: {pptx}", file=sys.stderr)
        return 2
    if args.dpi <= 0:
        print("ERROR: --dpi must be positive", file=sys.stderr)
        return 2

    errors: list[str] = []
    methods = [export_with_powerpoint, export_with_libreoffice]
    for method in methods:
        try:
            result = method(pptx, mappings, out_dir, args.dpi)
            write_json(
                project / "out" / "visual_qa_rasterize_metadata.json",
                {
                    "createdAt": utc_now(),
                    "status": "ok",
                    "pptx": str(pptx),
                    "slides": slides,
                    "mapping": mapping_metadata(mappings),
                    "dpi": args.dpi,
                    "result": result,
                },
            )
            print(json.dumps({"status": "ok", "tool": result["tool"], "slides": slides, "mapping": mapping_metadata(mappings)}, indent=2))
            return 0
        except ToolUnavailable as exc:
            errors.append(str(exc))
        except RasterError as exc:
            errors.append(str(exc))

    write_error_reports(project, out_dir, mappings, pptx, errors)
    print("ERROR: unable to rasterize PPTX diagnostically.", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
