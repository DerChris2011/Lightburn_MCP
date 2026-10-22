export const WORKFLOWS = `# Workflows for assistants using this server

Step sequences that avoid the common failure modes. The prompts offered by
this server follow these.

## Summarise a project

1. \`get_project\` – filename, modified, shape_count, workspace (mm), device
   and \`device.laser\` (galvo? controller? MOPA? sources?).
2. \`get_units\`.
3. \`get_cuts\` (compact, in_use_only) – the layers that actually output.
4. \`get_layers\` only if colours/names are needed.
5. Report: machine type, project size, each used layer with mode, speed
   (with unit), power, passes, enabled flag, sub-layer count. Mention disabled
   layers and tool layers separately.

## Review cut settings for plausibility

1. Do the summary above.
2. Read \`lightburn://knowledge/laser-types\` for the machine class.
3. For each used layer, \`get_cut\` when details matter (frequency override,
   air assist, interval, image dither).
4. If a material library is loaded (\`get_material_library\`), compare the
   layer with the closest entry: same material and thickness → differences in
   speed/power/passes are the finding.
5. State findings as "looks unusual because…", give a suggested value range
   with the unit, and ask before changing. Never present a value as correct
   for their machine.

## Change settings on request

1. \`get_cut index\` – read the current entry first (profile, mode, units).
2. Build the smallest partial body. For frequency include
   \`override_frequency: true\`. Put machine fields in the block that matches
   \`profile\`. Address sub-layers by \`index\`.
3. \`update_cut\`. On 409 ask the user to close the Cut Settings Editor; on 400
   quote LightBurn's reason and fix the body rather than retrying blindly.
4. Repeat back what changed, in the display units, and end with the review
   reminder. One undo step exists in LightBurn ("Change cut settings").

## Apply a library material

1. \`get_material_library\` – list materials and thicknesses; note the
   \`profile\` of the entry's cut vs. the target layer.
2. \`apply_material_to_cut\` with \`index\` and either \`entry_guid\` or
   \`material\` + \`thickness\`. If it refuses because of ambiguity, show the
   candidates and ask. If it refuses because the entry has more sub-layers
   than the target, explain that LightBurn must create the sub-layers first or
   offer \`update_cut\` with the base layer only.
3. Review reminder.

## Import generated artwork (SVG)

1. Build the SVG with **millimetre units**: \`width="80mm" height="50mm"
   viewBox="0 0 80 50"\` so 1 user unit = 1 mm. Without units LightBurn
   assumes 96 DPI pixels (configurable in its settings) and sizes will be off.
2. Use strokes for cut lines and closed paths for fills. LightBurn maps SVG
   colours to its layer palette: black → C00, blue \`#0000FF\` → C01, red
   \`#FF0000\` → C02, green \`#00E000\` → C03, and so on; unknown colours go to
   the nearest palette entry. Pick colours deliberately so the user can
   assign cut vs. engrave by layer; say which colour went where.
3. Convert text to paths when exact fonts matter; LightBurn can import SVG
   text but substitutes missing fonts.
4. \`upload_file\` with \`content\` and \`filename\` ending in \`.svg\`; use
   \`x\`, \`y\`, \`origin\` to place it (workspace mm from the workpiece origin)
   and \`group_shapes: true\` so the user can move or delete it as one object.
5. Report the import result. If it is "accepted" without confirmation, tell
   the user to check the workspace. Then \`get_layers\` / \`get_cuts\` to show
   which layers the shapes landed on and whether those layers have sensible
   settings; offer to set them.

## Open a file as a new project

- \`open_file\` replaces the current project; LightBurn prompts to save unsaved
  changes. Prefer \`upload_file\` unless the user clearly wants to replace the
  project.

## Watch a running job

- \`get_state_snapshot\` for position, job state/progress, overrides. Explain
  the Ruida and galvo caveats (no progress on Ruida; "running at 100 %" on
  galvos while the controller is still marking). The API cannot stop a job;
  the user must use the machine or LightBurn.

## When something fails

| Message | Do |
|---|---|
| "does not appear to be running" | Ask the user to start LightBurn; the API lives inside it |
| "rejected the token" / 401 | Offer the \`pair\` tool; explain the consent dialog and 30 s window |
| "needs the … capability" | Explain scopes; \`pair\` again with the needed capability |
| "editor is open" / 409 | Ask to close the Cut Settings Editor |
| 400 with a reason | Fix the body (wrong machine block, read-only field, out-of-range power) |
| import "import_failed" | Check the SVG (units, nesting, unsupported features) and retry |
`;
