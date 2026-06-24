#!/usr/bin/env python3
"""Slide ID mapping helpers for visual QA wave outputs."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


class SlideMappingError(ValueError):
    pass


@dataclass(frozen=True)
class SlideMapEntry:
    source_slide: int
    physical_slide: int
    html_slide: int
    mapping_mode: str
    inferred: bool = False
    trace_based: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "sourceSlide": self.source_slide,
            "physicalSlide": self.physical_slide,
            "htmlSlide": self.html_slide,
            "mappingMode": self.mapping_mode,
            "inferred": self.inferred,
            "traceBased": self.trace_based,
        }


def parse_slide_list(value: str | None, *, option_name: str = "slides", required: bool = False) -> list[int]:
    if not value:
        if required:
            raise SlideMappingError(f"--{option_name} is required for deterministic QA output")
        return []
    slides: list[int] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            try:
                start, end = int(start_s), int(end_s)
            except ValueError as exc:
                raise SlideMappingError(f"invalid slide range for --{option_name}: {part}") from exc
            if start <= 0 or end < start:
                raise SlideMappingError(f"invalid slide range for --{option_name}: {part}")
            slides.extend(range(start, end + 1))
        else:
            try:
                slide = int(part)
            except ValueError as exc:
                raise SlideMappingError(f"invalid slide number for --{option_name}: {part}") from exc
            if slide <= 0:
                raise SlideMappingError(f"invalid slide number for --{option_name}: {part}")
            slides.append(slide)
    return list(dict.fromkeys(slides))


def slide_dir_name(slide: int) -> str:
    return f"slide{slide:02d}"


def _positive_int(value: Any, field: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise SlideMappingError(f"{field} must be a positive integer") from exc
    if number <= 0:
        raise SlideMappingError(f"{field} must be a positive integer")
    return number


def _filter_entries(entries: list[SlideMapEntry], source_slides: list[int]) -> list[SlideMapEntry]:
    if not source_slides:
        return entries
    by_source = {entry.source_slide: entry for entry in entries}
    missing = [slide for slide in source_slides if slide not in by_source]
    if missing:
        raise SlideMappingError(f"slide map does not contain source slide(s): {','.join(str(item) for item in missing)}")
    return [by_source[slide] for slide in source_slides]


def load_slide_map(path: Path, source_slides: list[int] | None = None) -> list[SlideMapEntry]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SlideMappingError(f"unable to read slide map {path}: {exc}") from exc
    slides = data.get("slides") if isinstance(data, dict) else None
    if not isinstance(slides, list) or not slides:
        raise SlideMappingError(f"slide map {path} must contain a non-empty slides array")
    entries: list[SlideMapEntry] = []
    for index, item in enumerate(slides, start=1):
        if not isinstance(item, dict):
            raise SlideMappingError(f"slide map entry {index} must be an object")
        source = _positive_int(item.get("sourceSlide"), f"slide map entry {index}.sourceSlide")
        physical = _positive_int(item.get("physicalSlide", index), f"slide map entry {index}.physicalSlide")
        html = _positive_int(item.get("htmlSlide", physical), f"slide map entry {index}.htmlSlide")
        entries.append(
            SlideMapEntry(
                source_slide=source,
                physical_slide=physical,
                html_slide=html,
                mapping_mode="slide-map",
                inferred=False,
                trace_based=False,
            )
        )
    return _filter_entries(entries, source_slides or [])


def _parse_trace_value(value: Any) -> list[int]:
    if isinstance(value, str):
        try:
            return parse_slide_list(value, option_name="trace.slides")
        except SlideMappingError:
            return []
    if isinstance(value, (int, float)):
        try:
            return [_positive_int(value, "trace slide")]
        except SlideMappingError:
            return []
    if isinstance(value, list):
        if all(isinstance(item, (int, float, str)) for item in value):
            try:
                return [_positive_int(item, "trace slide") for item in value]
            except SlideMappingError:
                return []
        slides: list[int] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            for key in ("sourceSlide", "sourceSlideId", "source", "slide", "slideId", "id"):
                if key in item:
                    try:
                        slides.append(_positive_int(item[key], f"trace {key}"))
                        break
                    except SlideMappingError:
                        continue
        return slides
    return []


def _extract_trace_slides(data: Any) -> list[int]:
    direct_paths = [
        ("selectedSlides",),
        ("sourceSlides",),
        ("requestedSlides",),
        ("slides",),
        ("build", "slides"),
        ("pipeline", "slides"),
        ("pipeline", "selectedSlides"),
        ("render", "slides"),
        ("trace", "slides"),
    ]
    for path in direct_paths:
        current = data
        for key in path:
            if not isinstance(current, dict) or key not in current:
                current = None
                break
            current = current[key]
        slides = _parse_trace_value(current)
        if slides:
            return slides

    preferred_keys = {
        "selectedslides",
        "source_slides",
        "sourceslides",
        "requestedslides",
        "requested_slides",
        "slides",
    }

    def visit(obj: Any) -> list[int]:
        if isinstance(obj, dict):
            for key, value in obj.items():
                if str(key).lower() in preferred_keys:
                    slides = _parse_trace_value(value)
                    if slides:
                        return slides
            for value in obj.values():
                slides = visit(value)
                if slides:
                    return slides
        elif isinstance(obj, list):
            slides = _parse_trace_value(obj)
            if slides:
                return slides
            for value in obj:
                slides = visit(value)
                if slides:
                    return slides
        return []

    return visit(data)


def load_trace_mapping(path: Path) -> list[SlideMapEntry]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SlideMappingError(f"unable to read trace {path}: {exc}") from exc
    slides = _extract_trace_slides(data)
    if not slides:
        raise SlideMappingError(f"trace {path} does not contain selected source slide IDs")
    return [
        SlideMapEntry(
            source_slide=source,
            physical_slide=index,
            html_slide=index,
            mapping_mode="trace",
            inferred=True,
            trace_based=True,
        )
        for index, source in enumerate(slides, start=1)
    ]


def _sequential_source_mapping(source_slides: list[int]) -> list[SlideMapEntry]:
    return [
        SlideMapEntry(
            source_slide=source,
            physical_slide=index,
            html_slide=index,
            mapping_mode="source-slides-sequential",
            inferred=True,
            trace_based=False,
        )
        for index, source in enumerate(source_slides, start=1)
    ]


def _paired_mapping(source_slides: list[int], physical_slides: list[int]) -> list[SlideMapEntry]:
    if len(source_slides) != len(physical_slides):
        raise SlideMappingError(
            f"--source-slides has {len(source_slides)} item(s), but --physical-slides has {len(physical_slides)} item(s)"
        )
    return [
        SlideMapEntry(
            source_slide=source,
            physical_slide=physical,
            html_slide=physical,
            mapping_mode="source-physical-slides",
            inferred=False,
            trace_based=False,
        )
        for source, physical in zip(source_slides, physical_slides)
    ]


def _legacy_mapping(slides: list[int]) -> list[SlideMapEntry]:
    return [
        SlideMapEntry(
            source_slide=slide,
            physical_slide=slide,
            html_slide=slide,
            mapping_mode="legacy-physical-slides",
            inferred=False,
            trace_based=False,
        )
        for slide in slides
    ]


def resolve_slide_mapping(
    *,
    slides: str | None = None,
    source_slides: str | None = None,
    physical_slides: str | None = None,
    slide_map: Path | None = None,
    trace: Path | None = None,
) -> list[SlideMapEntry]:
    parsed_source = parse_slide_list(source_slides, option_name="source-slides")
    parsed_physical = parse_slide_list(physical_slides, option_name="physical-slides")

    if slide_map:
        return load_slide_map(slide_map, parsed_source)
    if parsed_source and parsed_physical:
        return _paired_mapping(parsed_source, parsed_physical)
    if parsed_source:
        return _sequential_source_mapping(parsed_source)
    if trace:
        return load_trace_mapping(trace)

    parsed_slides = parse_slide_list(slides, option_name="slides")
    if parsed_slides:
        return _legacy_mapping(sorted(parsed_slides))
    raise SlideMappingError("provide --slides, --source-slides, --slide-map, or --trace")


def mapping_metadata(entries: list[SlideMapEntry]) -> dict[str, Any]:
    return {
        "sourceSlides": [entry.source_slide for entry in entries],
        "physicalSlides": [entry.physical_slide for entry in entries],
        "htmlSlides": [entry.html_slide for entry in entries],
        "mappingMode": entries[0].mapping_mode if entries else None,
        "inferred": any(entry.inferred for entry in entries),
        "traceBased": any(entry.trace_based for entry in entries),
        "entries": [entry.to_json() for entry in entries],
    }
