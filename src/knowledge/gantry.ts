export const GANTRY = `# Gantry lasers in LightBurn (CO2, diode, gantry fiber)

Applies when cut entries carry \`profile: "gantry"\` with a \`params.gantry\`
block: Ruida, Trocen, GRBL, Marlin, Smoothie and similar controllers.

## How a gantry behaves

- The head physically moves, so it accelerates and decelerates. Corners and
  short segments run slower than the set speed; controllers that support it
  (Ruida, Trocen) reduce power towards \`min_power\` there to keep the burn
  even. GRBL-family diodes mostly use \`max_power\` only.
- Real cutting speed is limited by acceleration: a 5 mm circle never reaches
  300 mm/s. Fill (scan) layers use \`overscan\` so the head is at speed before
  the beam fires.
- Speeds: Ruida in mm/s, GRBL usually mm/min. Always read \`get_units\`.

## The \`params.gantry\` block

| Field | Meaning | Notes |
|---|---|---|
| \`run_blower\` | Air assist on for this layer | Cutting: on. Fine engraving on wood: often off or low to avoid blowing debris into the grain |
| \`auto_blower\`, \`blower_speed_override\`, \`blower_speed_percent\` | Air assist control on machines with a proportional valve | |
| \`cut_through_start\` / \`cut_through_end\`, \`through_power\`, \`through_power_2\` | Dwell at the start/end of each cut to pierce thick material | Thick acrylic/wood; adds time |
| \`start_delay\` / \`end_delay\` | Pauses at path start/end (not dot delays) | Rarely needed |
| \`lead_in\` / \`lead_out\`, \`lead_angle\`, \`lead_length\`, \`lead_style\` (\`line\`/\`arc\`) | Start the cut outside the contour | Avoids a pierce mark on the finished edge (acrylic, visible edges) |
| \`enable_ppi\`, \`ppi\` | Pulses per inch: the beam fires as discrete pulses along the path | Cleaner cuts in paper, wood, cardboard; reduces charring; needs a controller that supports it |
| \`dot_mode\`, \`dot_time\`, \`dot_spacing\` | Fire dots instead of a continuous line | Perforations, dotted marks |
| \`force_constant_power\` | Ignore min/max power ramping | Uniform marks on materials that need full power at corners |
| \`dcc_value\` | Dynamic power compensation (controller-specific) | Leave unless the user knows it |
| \`overcut\` (mm) | Continue past the start point of a closed shape | Removes the small nub where a cut closes |

## CO2 specifics

- Glass DC tubes need a minimum power to fire (often ~10 %); keep
  \`min_power\` above it on Ruida or corners stay unburnt. RF tubes fire from
  near zero.
- Air assist is essential for cutting (clears the kerf, prevents flare-ups);
  reduce it for engraving if debris marks the surface.
- Focus: cutting with the focus slightly into the material (~1/3 of thickness)
  helps thick cuts; engraving uses surface focus.
- Materials: never PVC/vinyl, polycarbonate, fibreglass. Clear acrylic cuts and
  engraves well (frosted). Glass engraves (micro-fractures); use wet paper or
  dish soap to reduce chipping.
- Typical Ruida layer: cut 3 mm plywood ~ 15 mm/s, min 60 / max 70 % on a
  60 W tube; engrave ~ 300 mm/s, 12-18 %, interval 0.1 mm. Values vary by tube
  and lens and must be tested.

## Diode specifics

- Speeds in mm/min on GRBL. Power is a percentage of the configured S-value
  maximum; "100 %" on an under-rated module is still weak. Check the module's
  optical power (5, 10, 20, 40 W), not the "electrical" marketing number.
- Multiple passes replace power: 3 mm plywood often needs 2-5 passes at
  100 % and 150-400 mm/min on a 10 W module.
- Fill engraving on wood: 3000-8000 mm/min, 30-70 %, interval 0.07-0.1 mm,
  \`bi_directional\` on, \`overscan\` 2.5-5 %.
- Cannot cut clear acrylic or glass; marks metal only with a coating/spray.
- Blue light fluorescence: the "beam looks weak" judgement is unreliable;
  measure by test cuts.

## Gantry fiber sources

- \`laser1_fiber\` / \`laser2_fiber\` on \`device.laser\`: \`fiber_pulse_width\`
  (ns, positive integer) applies. Rare (some dual-source machines).

## Rotary and Z

- Rotary and homing settings are not exposed by the API. \`supports_z\` tells
  whether \`z_offset\` / \`z_per_pass\` can do anything.

## Typical layer recipes (shape only, values to be tested)

- **Cut**: line mode, slow, high power, air assist on, 1-3 passes, kerf
  0.1-0.2 mm, optional lead-in and cut-through for acrylic, PPI for paper.
- **Engrave fill**: scan mode, fast, low power, interval 0.08-0.12 mm,
  overscan, air assist low.
- **Photo on wood**: image cut, Jarvis/Stucki dither, 254-318 DPI on wood
  (interval 0.08-0.1 mm), fast, low-mid power; test a small strip first.
- **Score / mark lines**: line mode, fast, 10-20 %.
- **Rubber stamp**: scan, negative, ramp_length 0.5-1 mm, several passes.
`;
