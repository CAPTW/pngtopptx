# Examples

This directory contains small public validation cases for the `pngtopptx`
slide reconstruction toolkit. These are intentionally committed exceptions to the repository's
normal generated-output hygiene.

## Generated Cooling Loop

[`generated-cooling-loop/`](generated-cooling-loop/) is a synthetic 16:9 dense
technical slide converted into an editable PPTX.

Open [`generated-cooling-loop/index.html`](generated-cooling-loop/index.html)
in a browser to visually inspect the source, comparison contact sheet, and
validation notes without opening PowerPoint.

Use it to inspect the intended success criterion:

- the PPTX opens without package validation errors;
- the source screenshot is not embedded as a full-slide image;
- titles, panels, tables, rules, badges, callouts, and many labels are editable
  native PowerPoint objects;
- strict pixel visual QA is documented, including known limitations.
