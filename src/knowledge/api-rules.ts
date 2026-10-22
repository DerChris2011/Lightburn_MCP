export const API_RULES = `# LightBurn REST API: rules and pitfalls for assistants

These are the mistakes an assistant makes most often when working through this
server. Read this before interpreting or changing any value.

## Units: read them, never assume

- Call \`get_units\` first. It returns two **independent** fields: \`units\` for
  speeds (\`mm/s\`, \`mm/min\`, \`in/s\`, \`in/min\`) and \`distance_units\` for
  distances (\`mm\`, \`in\`). LightBurn supports mixed modes such as inch
  distances with metric speeds, so never infer one from the other.
- Cut values (speed, kerf, z_offset, interval, ...) are reported and written
  in the user's display units. Positions (\`get_position\`) and the project
  \`workspace\` are **always millimetres**.
- A diode on GRBL is usually set to mm/min, a CO2 on Ruida to mm/s, a galvo
  to mm/s. "300" means something very different in each. Say the unit when
  you quote a value.

## Which cuts matter

- \`get_cuts\` returns a fixed list for LightBurn: 30 cut layers, 2 tool layers,
  1 internal entry, then 30 image cuts. The entry's \`index\` (0..62) is what
  \`get_cut\` and \`update_cut\` take; \`layer_index\` is the layer slot on the
  desktop (C00..C29, T1, T2). Image cuts share the layer slot with the normal
  cut of the same colour but have their own \`index\` (33..62).
- Use each entry's \`in_use\` / \`shape_count\` to find the cuts the project
  really uses. Prefer these over joining \`get_layers\`; the per-layer count
  cannot separate a vector cut from an image on the same layer.
- Tool layers (T1, T2) are never output and cannot be edited. The internal
  entry with \`layer_index: -1\` cannot be edited either.
- \`enabled: false\` on a used layer means it is skipped when the job runs.
  That is often intentional (reference geometry). Mention it, don't "fix" it
  unasked.

## Galvo or gantry: the \`profile\` field

- Every LightBurn cut carries \`profile\`: \`galvo\`, \`gantry\` or \`unknown\`.
  Normal cuts contain exactly one matching block, \`params.galvo\` or
  \`params.gantry\`. Writing the other block is rejected with 400.
- The profile comes from the **selected device**, not from the project. The
  same project reports different blocks on different devices. Never cache the
  shape; read the cut before you change it.
- \`global_passes\` exists on galvo only; sending it to a gantry device is a 400.

## Frequency and pulse width

- Writing \`params.frequency\` does nothing unless \`params.override_frequency\`
  is \`true\`. Set both together, and tell the user when a layer has a frequency
  stored but the override off.
- \`q_pulse_width\` (ns) only applies when \`device.laser.mopa_source\` is not 0.
  \`fiber_pulse_width\` (ns) only applies to gantry fiber sources
  (\`laser1_fiber\` / \`laser2_fiber\`). The fields are always present in the
  response; check \`get_project\` to know whether they mean anything.
- Dual-source fields (\`min_power_2\`, \`max_power_2\`, \`laser1_enabled\`,
  \`laser2_enabled\`) matter only when \`device.laser.sources\` is 2.

## State is not what it looks like

- \`connected: false\` is the normal resting state on Ruida and similar
  controllers; the link opens only during a transfer. Never report it as a
  fault. \`device_name\` tells which profile is selected.
- On Ruida, \`job.state\` is always \`idle\` and \`progress\` is never present:
  the controller runs the job on its own. "idle" does not mean the machine is
  free. On galvo controllers "running at 100 %" usually means the data was
  transferred and the machine may still be marking.
- An absent field means "unknown", not zero.

## Writing

- \`update_cut\` is a **partial** update: send only what should change. The
  whole body is validated first; on any error nothing changes. A success is one
  undo step ("Change cut settings") in LightBurn.
- 409 means the Cut Settings Editor is open in LightBurn. Ask the user to close
  it and retry. 404 means the index is out of range. 400 carries the reason.
- Changes never affect a job already sent to the machine; they apply the next
  time the project is output.
- After every change, end with: *Review these settings in LightBurn before
  running the job.* The operator decides, not the assistant.

## Importing

- \`upload_file\` merges into the current project; \`open_file\` replaces it
  (LightBurn asks about unsaved changes). Both return "accepted" immediately;
  the result arrives as a \`file_imported\` event, which this server waits for
  when the pairing has the \`state\` capability.
- For \`open_file\`, success is only reliable for native \`.lbrn\`/\`.lbrn2\`
  files. Other formats report false even when they opened; the server then
  reads the project to confirm.
- Placement: \`x\`/\`y\` are workspace millimetres from the workpiece origin,
  \`origin\` names the point of the import's bounding box that sits there.
  Without them the import lands at the current view centre.

## Capabilities and pairing

- A pairing is scoped to the capabilities requested at the time. A tool that
  needs more returns an explanation; the fix is to pair again with the needed
  capability, which shows a new consent dialog in LightBurn.
- The \`project\` capability includes the camera overlay image. Say so when a
  user wonders what they granted.
- Every 401 looks the same: expired, revoked, wrong capability, or another
  LightBurn window took over the port. The server retries once, then asks to
  re-pair.
`;
