# render_compare r07 -> r09 (edit: wing, face; tol 0.03, max outside 0.002)
views: 15, failed: 4

## QA_3q_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0016 | 0.0080 |  |
| wing | 0.0075 | 0.0369 | edit |
| face | 0.0219 | 0.1027 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_3q_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0346 | 0.0810 |  |
| wing | 0.1640 | 0.3815 | edit |
| face | 0.2408 | 0.5179 | edit |
| outside | 0.0091 | 0.0200 | guard |
outside changed share 0.0200 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_3q_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0125 | 0.0288 |  |
| wing | 0.0520 | 0.1200 | edit |
| face | 0.0580 | 0.1522 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_back_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0015 | 0.0053 |  |
| wing | 0.0077 | 0.0268 | edit |
| face | 0.0001 | 0.0000 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_back_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0148 | 0.0347 |  |
| wing | 0.0418 | 0.0971 | edit |
| face | 0.0044 | 0.0076 | edit |
| outside | 0.0020 | 0.0053 | guard |
outside changed share 0.0053 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_back_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0163 | 0.0315 |  |
| wing | 0.0663 | 0.1287 | edit |
| face | 0.0005 | 0.0000 | edit |
| outside | 0.0001 | 0.0000 | guard |

## QA_front_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0028 | 0.0112 |  |
| wing | 0.0105 | 0.0419 | edit |
| face | 0.0263 | 0.1099 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_front_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0389 | 0.0915 |  |
| wing | 0.1071 | 0.2487 | edit |
| face | 0.2512 | 0.5283 | edit |
| outside | 0.0050 | 0.0132 | guard |
outside changed share 0.0132 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_front_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0113 | 0.0357 |  |
| wing | 0.0438 | 0.1385 | edit |
| face | 0.0268 | 0.1099 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_side_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0005 | 0.0031 |  |
| wing | 0.0044 | 0.0295 | edit |
| face | 0.0100 | 0.0575 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_side_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0179 | 0.0444 |  |
| wing | 0.1166 | 0.2788 | edit |
| face | 0.1940 | 0.5491 | edit |
| outside | 0.0048 | 0.0133 | guard |
outside changed share 0.0133 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_side_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0071 | 0.0157 |  |
| wing | 0.0745 | 0.1645 | edit |
| face | 0.0109 | 0.0596 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_top_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0004 | 0.0035 |  |
| wing | 0.0028 | 0.0260 | edit |
| face | 0.0024 | 0.0201 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_top_f0077: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0236 | 0.0465 |  |
| wing | 0.1112 | 0.2187 | edit |
| face | 0.0867 | 0.2462 | edit |
| outside | 0.0000 | 0.0001 | guard |

## QA_top_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0105 | 0.0221 |  |
| wing | 0.0632 | 0.1337 | edit |
| face | 0.0024 | 0.0201 | edit |
| outside | 0.0000 | 0.0000 | guard |
