export const LASER_TYPES = `# Laser types: diode, CO2, fiber, MOPA fiber

How to tell which machine the user has, which cut fields matter on it, and
what the numbers roughly mean. **Numbers here are orders of magnitude for
plausibility checks, not a recipe.** Real values depend on laser power, lens,
focus, material batch, air assist and the user's goal, and must be tested on
scrap. The user's own material library and existing layers are the best
reference; LightBurn requires the operator to review every API-written value.

## Identify the machine

\`get_project\` → \`device.laser\`:

| Field | Meaning |
|---|---|
| \`controller\` | e.g. \`Ruida\` (mostly CO2), \`GRBL\` / \`Marlin\` / \`Smoothie\` (mostly diode, some CO2), \`JCZFiber\` / \`EzCad\` (galvo fiber), \`Trocen\`, \`GCode\`, ... |
| \`galvo\` | true = galvo scanner (fiber/MOPA/UV/galvo CO2); false = gantry |
| \`mopa_source\` | 1 or 2 = a MOPA source with adjustable pulse width |
| \`laser1_fiber\` / \`laser2_fiber\` | gantry with a fiber source (rare) |
| \`sources\` / \`sources_enabled\` | 2 = dual-source machine (e.g. CO2 + fiber, or two tubes) |
| \`uv\` | UV source (355 nm) |

LightBurn does not label CO2 vs diode. Infer from controller + device name
(\`get_status\`) + speed unit (\`get_units\`), and ask when unsure.

## Diode (blue, ~450 nm; typically 5-40 W optical)

- Usually a GRBL-family gantry, speeds in **mm/min**, power as % of
  "S-value max" (often 1000) in the device settings.
- Good at: engraving wood, leather, cardboard, dark/coated anodised aluminium,
  slate, painted metal; cutting thin plywood, MDF, cardboard, felt, dark
  acrylic.
- Cannot: cut clear acrylic or glass (the beam passes through), mark bare
  metal without a marking spray, work on white/transparent materials well.
- Typical magnitudes: engraving 3000-10000 mm/min at 20-60 %; cutting 3 mm
  plywood ~ 100-400 mm/min at 100 % with several passes (depends heavily on
  optical power). Line interval 0.05-0.1 mm. Air assist helps cutting a lot.
- Fields that matter: speed, max_power, num_passes, interval, bi_directional,
  overscan, dither_mode for images. \`min_power\` is mostly ignored for vectors.
  Frequency is PWM and normally left alone.

## CO2 (10.6 µm; glass DC tubes 40-150 W, RF tubes 30-100 W)

- Mostly Ruida (speeds in **mm/s**), also Trocen, GRBL-based desktop units
  (mm/min), and galvo CO2 for marking.
- Good at: cutting wood, plywood, MDF, acrylic (clear included, with polished
  edges), paper, fabric, leather, rubber, foam; engraving glass, stone,
  anodised aluminium, coated metals, wood photos.
- Cannot: mark bare metal (needs marking spray such as Cermark), cut PVC/vinyl
  (chlorine gas, destroys the machine), polycarbonate (burns), fibreglass.
- Typical magnitudes (60-100 W glass tube): cutting 3 mm plywood 10-25 mm/s at
  50-80 %; 3 mm acrylic 5-15 mm/s; engraving wood 200-400 mm/s at 10-30 %;
  acrylic engraving 300+ mm/s at 10-20 %. Line interval 0.08-0.15 mm.
- Fields that matter: speed, min_power and max_power (Ruida uses both; keep
  min ≥ ~10 % on glass tubes), num_passes, air assist (\`gantry.run_blower\`),
  \`gantry.enable_ppi\`/\`ppi\` for clean paper/wood cutting, cut_through,
  lead in/out for acrylic, overscan for fills, kerf (0.1-0.3 mm).
- Ruida quirk: \`connected\` toggles, job progress is not reported.

## Fiber, Q-switched (1064 nm; 20-50 W; e.g. Raycus, Max, IPG)

- Galvo scanner (\`galvo: true\`), controller \`JCZFiber\`/EzCad boards,
  speeds in **mm/s**, field size set by the F-theta lens (e.g. 110 or 175 mm).
- Fixed pulse width (~100 ns), frequency adjustable within the source's range
  (often 20-80 kHz; some 30-60 kHz). The API exposes \`frequency\` +
  \`override_frequency\`; \`q_pulse_width\` is **not** meaningful
  (\`mopa_source: 0\`).
- Good at: marking and deep engraving metals (steel, stainless, aluminium,
  brass, titanium, gold/silver), annealing stainless (dark mark without
  removing material), removing coatings/paint, marking many plastics (ABS,
  PC, some PE), engraving leather. Slate, some stone.
- Weak at: wood and paper (scorches rather than engraves), clear glass and
  clear acrylic (transparent at 1064 nm), copper (reflective; needs high peak
  power).
- Typical magnitudes (30 W, 110 mm lens): surface marking 500-2000 mm/s at
  50-100 %, 20-60 kHz, interval 0.01-0.05 mm; deep engraving 200-800 mm/s,
  100 %, 20-40 kHz, interval 0.01-0.03 mm, many passes with \`cross_hatch\`
  or \`angle_per_pass\`; annealing stainless 100-300 mm/s, 20-40 %, high
  frequency, slightly defocused. All to be tested.
- Fields that matter: speed, max_power (min usually equal), frequency +
  override_frequency, interval, angle/cross_hatch, num_passes,
  global_passes, z_offset (defocus), and the \`galvo\` block (timing
  constants, jump settings, wobble). See the galvo document.

## MOPA fiber (1064 nm; 20-100 W; e.g. JPT M7, Raycus MOPA)

- Everything from the Q-switched section, plus an **adjustable pulse width**
  (\`q_pulse_width\`, ns; typically 2-500 ns) and a much wider frequency range
  (roughly 1-4000 kHz depending on the source and pulse width). Enabled when
  \`device.laser.mopa_source\` is 1 or 2.
- What it buys: control of peak power vs. heat input. Short pulses (2-20 ns)
  at high frequency give cold, crisp marks (e.g. deep black on anodised
  aluminium, fine marks on plastics without melting); long pulses (200-500 ns)
  behave like a Q-switched source; medium pulses plus tuned frequency and
  speed produce **colour marking on stainless and titanium** (oxide layer
  thickness), which is extremely sensitive and must be dialled in per machine.
- Each source limits frequency per pulse width (a short pulse cannot run at
  low frequency with full energy). LightBurn clamps some combinations; the
  user's source manual lists the valid ranges.
- Typical magnitudes: black anodised-aluminium marking ~ 500-1500 mm/s, 100 %,
  2-6 ns, 200-1000 kHz, interval 0.01-0.02 mm; stainless colours ~ 100-500
  mm/s, 20-60 %, 30-200 ns, 20-400 kHz with one or two passes. Starting
  points only, must be tested.

## UV (355 nm, 3-10 W)

- Galvo; marks glass, clear acrylic, PET, silicone, PCB coatings and many
  plastics cold. Low power → slow. Fields like fiber without pulse width.

## Dual-source machines

- \`sources: 2\` (e.g. a gantry with CO2 + fiber, or two galvo sources):
  \`laser1_enabled\` / \`laser2_enabled\` choose which fires on a layer,
  \`*_power_2\` sets the second source. On galvos \`alt_source\` selects the
  alternate source.

## Reading a layer with the machine in mind

1. Identify the machine (above) and read \`get_units\`.
2. Judge speed and power against the magnitudes for that type and the user's
   stated material and goal (cut vs. engrave vs. mark).
3. Flag combinations that rarely make sense: a scan layer at cutting speed, a
   fiber frequency stored with the override off, min_power 0 on a glass CO2,
   a cut layer with 10 passes "to be safe", a 0.3 mm interval on a photo.
4. Compare with the user's material library (\`get_material_library\`) when
   one is loaded; it reflects their machine better than any table.
5. Say what you would change and why, change it only when asked, and always
   close with the review reminder.
`;
