export const GALVO = `# Galvo lasers in LightBurn (fiber, MOPA, UV, galvo CO2)

Applies when \`get_project\` reports \`device.laser.galvo: true\` and cut entries
carry \`profile: "galvo"\` with a \`params.galvo\` block.

## How a galvo differs from a gantry

- Two mirrors steer the beam over a fixed field (set by the lens: e.g. 110 ×
  110 mm or 175 × 175 mm); nothing moves except the mirrors, so speeds of
  hundreds to thousands of mm/s are normal and the head never "slows down at
  corners". \`min_power\` is therefore usually equal to \`max_power\`.
- Everything is pulsed. **Frequency** (kHz) sets pulses per second; at a given
  average power, lower frequency = higher pulse energy (more ablation), higher
  frequency = gentler, more heat (annealing, colouring). Always write
  \`override_frequency: true\` with \`frequency\`.
- **Line spacing** matters more than anywhere else: \`interval\` of 0.01-0.05 mm
  with a spot size around 0.03-0.05 mm. Too coarse → visible lines; too fine →
  slow and overheated.
- Focus is critical (depth of field ~ ±1 mm). \`z_offset\` is used to defocus
  on purpose (wider spot, softer mark, annealing).
- The project stores both galvo and gantry settings; only the block matching
  the selected device is reported and editable.

## The \`params.galvo\` block

| Field | Meaning | Notes |
|---|---|---|
| \`override_timings\` | Use the layer's own timing constants instead of the device defaults | Leave false unless tuning |
| \`laser_on_tc\` (µs) | Delay from start of a vector to laser on | Too high: missing start of lines. Too low: a heavy dot at the start |
| \`laser_off_tc\` (µs) | Delay at the end of a vector before laser off | Too high: tail/burn at end. Too low: line ends early |
| \`end_tc\` (µs) | Wait after the last vector before the next jump | Prevents dragged ends |
| \`polygon_tc\` (µs) | Dwell at corners between vectors | Too low: rounded corners. Too high: burnt corners |
| \`jump_speed\` (mm/s) | Travel speed with the laser off | Higher = faster job; too high can overshoot |
| \`min_jump_delay\` / \`max_jump_delay\` (µs) | Settle time after a jump, interpolated by jump length | Reduce if jobs are slow; raise if first vectors after jumps are offset |
| \`jump_dist_limit\` (mm) | Jump length where max delay applies | |
| \`start_delay\` / \`end_delay\` | Dot delays at path start/end (dot mode) | Different meaning from the gantry fields of the same name |
| \`wobble_enable\`, \`wobble_size\` (mm), \`wobble_step\` (mm) | Oscillate the beam along the path | Widens a line (thick outlines, weld-like marks, cleaning) without slowing down |

Timing tuning is machine-specific; LightBurn's device defaults are tuned for
the board. Suggest changing them only for visible artefacts (dots at line
starts, missing line ends, rounded corners) and in small steps.

## Passes on galvos

- \`num_passes\` repeats the layer; \`global_passes\` repeats the **whole**
  sub-layer stack. Effective passes = global_passes × num_passes.
- Deep engraving: moderate speed, full power, lower frequency, many passes,
  \`cross_hatch\` or \`angle_per_pass\` (e.g. 15-45°) so ridges don't build up,
  optionally \`z_per_pass\` on machines with a motorised Z to follow the
  surface down. Clean with air or a cloth between passes on soft metals.

## Typical layer recipes (shape only, values to be tested)

- **Surface mark on stainless / anodised aluminium**: scan, high speed,
  high power, mid frequency, fine interval, 1 pass.
- **Anneal stainless (black without depth)**: scan, slow, low-mid power, high
  frequency, slight defocus, 1-2 passes; test for heat tint on thin parts.
- **Deep engrave**: scan, mid speed, 100 %, low frequency, fine interval,
  10-50+ passes with cross hatch, then a clean-up pass at higher speed.
- **Paint / coating removal**: scan, fast, mid power, interval ~0.05 mm.
- **Plastics (ABS/PC)**: lower power, higher speed; MOPA with short pulses
  gives less melt.
- **Colour on stainless (MOPA)**: scan, 100-500 mm/s, 20-60 %, specific
  pulse width and frequency combos per colour; extremely machine-specific,
  reproduce from the user's own tests.
- **Cut thin metal foil / shim (fiber ≥ 30 W)**: line mode, slow, 100 %, low
  frequency, many passes, wobble off.

## Field size, lens and rotary

- The lens defines the field and the spot size; shapes outside the field are
  clipped. The workspace in \`get_project\` reflects the lens.
- Rotary jobs on galvos split the design into segments; the API does not
  expose rotary settings.

## Safety specifics

- Fiber beams are invisible and reflect off metal: enclosure interlocks and
  1064 nm goggles are mandatory. Marking plastics and coated metals produces
  toxic fumes; extraction is not optional.
- Changes made through the API apply to the next job sent. The operator must
  review the layer in LightBurn before pressing Start.
`;
