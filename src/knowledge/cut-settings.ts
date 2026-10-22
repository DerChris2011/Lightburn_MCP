export const CUT_SETTINGS = `# LightBurn cut settings explained

What each field in a cut entry means, machine-independent. Machine-specific
blocks are covered in the galvo and gantry documents.

## Mode

| \`mode\` | What LightBurn does | Typical use |
|---|---|---|
| \`cut\` (Line) | Follows the outline of every shape | Cutting through, outlining, marking lines |
| \`scan\` (Fill) | Rasters the inside of closed shapes line by line | Engraving filled areas, hatching, metal marking on galvos |
| \`offset\` (Offset Fill) | Fills with concentric inward offsets | Faster fills on some shapes, fewer scan artefacts |
| \`image\` | Only on image cuts (\`kind: "image"\`) | Photos and bitmaps |
| \`tool\` | Tool layers T1/T2; never output | Reference geometry |

Open shapes cannot be filled: a scan layer with only open paths outputs
nothing. "Fill + Line" in the UI is a layer with a scan base layer and a cut
sub-layer (or the reverse).

## Sub-layers

A normal cut has a base layer (\`mode\`/\`params\`) and may have extra
\`sub_layers\`, each with its own mode and params and an \`index\` starting at 1.
They run in order for the same shapes: a classic engraving layer is
"scan at high speed, then cut the outline". The API can edit sub-layers but
cannot add or remove them.

## Power

- \`max_power\` (%) is the power at full speed. \`min_power\` (%) is the power
  used when the head slows down at corners and when starting/stopping (gantry
  controllers that support it, notably Ruida). Setting min close to max gives
  uniform burn; a lower min reduces corner over-burn.
- On most GRBL diodes only \`max_power\` is used for vectors; \`min_power\`
  applies to grayscale images.
- On galvos the head does not slow down; min and max are usually equal.
- Glass CO2 tubes need a minimum fraction of power to ionise (often around
  10 %); below that nothing fires. A min_power of 0 on a Ruida CO2 gives
  unlit corners.
- \`default_speed\`, \`default_power1/2\` mean "use the device defaults".

## Speed and passes

- \`speed\` in the display speed unit. Lower speed = more energy per length
  = deeper cut or darker mark, and more charring.
- \`num_passes\` repeats the layer. \`z_per_pass\` lowers the focus each pass
  (needs a Z axis and "Relative Z moves" enabled). \`z_offset\` shifts the
  focus for the whole layer (e.g. defocus for wider engraving lines).
- Galvo \`global_passes\` repeats the whole sub-layer stack; total passes =
  global_passes × num_passes.

## Line / fill geometry

- \`kerf\`: offset applied to the cut path to compensate the beam width
  (positive = outward on outer contours). Typical kerf is 0.05-0.3 mm on
  CO2/diode, much less on fiber.
- \`interval\` (scan): distance between fill lines in distance units. Equivalent
  to lines per inch: \`DPI = 25.4 / interval_mm\`. Common: 0.08-0.1 mm (CO2
  wood), 0.05-0.1 mm (diode), 0.01-0.05 mm (fiber marking).
- \`angle\`: scan line angle. \`cross_hatch\` adds a second pass at 90°.
  \`angle_per_pass\` rotates the pattern each pass (galvo deep engraving).
- \`bi_directional\`: scan both ways (faster; can show banding if the machine
  has backlash). \`overscan\` / \`overscan_percent\`: extra travel beyond the
  fill so the head is at speed when the laser fires (gantry).
- \`scan_opt\`: \`individual\` (each shape alone), \`by_group\`, \`merge_all\`
  (treat overlapping shapes as one, avoids double-burn).
- \`flood_fill\`: skips empty space inside fills; faster for sparse designs,
  can misalign on some machines.

## Special line features

- \`ramp_length\` / \`ramp_outer\`: ramped (sloped) edges for rubber stamps.
- \`perforate\`, \`perf_len\`, \`perf_skip\`: dashed cutting.
- \`tabs\`: bridges that hold cut parts in the sheet (count or spacing, size,
  optional reduced \`cut_power\`).
- \`dot_width\`, \`use_dot_correction\`: compensates dot size for fine fills.

## Cut-level flags

- \`negative\`: inverts fills (engraves the background instead).
- \`pass_through\`: images are sent without re-sampling (keeps the image's own
  DPI and dither; use for pre-dithered 1-bit images).
- \`enable_cleanup\`: extra pass that clears residue in fills (device-specific).
- \`sort_within_layer\`: optimise order inside the layer.
- \`priority\`: output order of layers (lower first). Cut after engrave is the
  usual rule so parts don't move before being engraved.

## Image cuts

- \`dpi\` (read-only via API; set in the UI) and \`dither_mode\`: \`Threshold\`,
  \`Ordered\`, \`Atkinson\`, \`Dither\` (Floyd-Steinberg), \`Stucki\`, \`Jarvis\`,
  \`Newsprint\`, \`Halftone\`, \`Grayscale\`, \`Sketch\`... Use the strings
  \`get_cut\` reports.
- Grayscale maps brightness to power (needs a controller that varies power
  smoothly: Ruida, galvos, most GRBL diodes); dithers map brightness to dot
  density at fixed power and are the safe default for wood and anodised
  aluminium.
- \`cells_per_inch\` / \`halftone_angle\` apply to Halftone and Newsprint.
- Writable through the API: \`speed\`, \`max_power\`, \`dither_mode\` and the
  source/pulse fields. DPI is not.

## Frequency

- \`frequency\` (Hz) with \`override_frequency\`: pulse repetition rate on
  pulsed sources (fiber, some RF CO2, UV). On DC glass CO2 tubes and most diodes
  it is the PWM frequency and rarely changed. See the laser-types document.
`;
