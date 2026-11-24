# QA gate

## render_compare vs /tmp/r6work/qa/r9gate (edit: wing; max outside 0.002)

- QA_3q_f0000: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_3q_f0077: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_3q_f0168: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_back_f0000: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_back_f0077: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_back_f0168: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_front_f0000: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_front_f0077: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_front_f0168: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_side_f0000: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_side_f0077: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_side_f0168: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_top_f0000: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_top_f0077: PASS | outside | 0.0000 | 0.0000 | guard |
- QA_top_f0168: PASS | outside | 0.0000 | 0.0000 | guard |

## clearance_check (min 0.008 m, subframes 2)

- hop: PASS clearance_check: worst 0.01435 at frame 16.0 penguin_v3:wing_tip_L vs penguin_v3:body near (0.2179, -0.0318, 0.2782)
- wave: PASS clearance_check: worst 0.023122 at frame 57.0 penguin_v3:wing_tip_L vs penguin_v3:body near (0.2134, -0.0297, 0.3163)
- walk: PASS clearance_check: worst 0.033689 at frame 131.0 penguin_v3:wing_tip_L vs penguin_v3:body near (0.2261, -0.0379, 0.319)
- seated: PASS clearance_check: worst 0.027879 at frame 157.0 penguin_v3:wing_tip_L vs penguin_v3:body near (0.2183, -0.0172, 0.2883)
- raise-max: PASS clearance_check: worst 0.022013 at frame 168.0 penguin_v3:wing_tip_L vs penguin_v3:body near (0.2266, -0.0154, 0.4533)
- seated-desk: PASS clearance_check: worst 0.02788 at frame 179.0 penguin_v3:wing_tip_L vs penguin_v3:body near (5.2183, 0.2528, 0.7083)

RESULT: PASS
