# render_compare r07 -> r08 (edit: wing, face; tol 0.03, max outside 0.002)
views: 15, failed: 4

## QA_3q_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0015 | 0.0071 |  |
| wing | 0.0069 | 0.0326 | edit |
| face | 0.0217 | 0.1018 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_3q_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0347 | 0.0806 |  |
| wing | 0.1644 | 0.3790 | edit |
| face | 0.2410 | 0.5183 | edit |
| outside | 0.0091 | 0.0200 | guard |
outside changed share 0.0200 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_3q_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0088 | 0.0246 |  |
| wing | 0.0370 | 0.1038 | edit |
| face | 0.0471 | 0.1405 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_back_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0008 | 0.0034 |  |
| wing | 0.0039 | 0.0173 | edit |
| face | 0.0001 | 0.0000 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_back_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0127 | 0.0331 |  |
| wing | 0.0359 | 0.0934 | edit |
| face | 0.0044 | 0.0075 | edit |
| outside | 0.0020 | 0.0052 | guard |
outside changed share 0.0052 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_back_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0126 | 0.0290 |  |
| wing | 0.0521 | 0.1202 | edit |
| face | 0.0004 | 0.0000 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_front_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0025 | 0.0103 |  |
| wing | 0.0090 | 0.0376 | edit |
| face | 0.0263 | 0.1098 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_front_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0375 | 0.0892 |  |
| wing | 0.1040 | 0.2447 | edit |
| face | 0.2508 | 0.5275 | edit |
| outside | 0.0049 | 0.0131 | guard |
outside changed share 0.0131 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_front_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0078 | 0.0320 |  |
| wing | 0.0306 | 0.1259 | edit |
| face | 0.0267 | 0.1099 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_side_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0004 | 0.0023 |  |
| wing | 0.0035 | 0.0216 | edit |
| face | 0.0100 | 0.0575 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_side_f0077: FAIL (leak outside the edit region)

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0168 | 0.0441 |  |
| wing | 0.1032 | 0.2636 | edit |
| face | 0.1816 | 0.5586 | edit |
| outside | 0.0049 | 0.0134 | guard |
outside changed share 0.0134 vs limit 0.002: LEAK, the edit changed areas it should not

## QA_side_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0043 | 0.0120 |  |
| wing | 0.0450 | 0.1255 | edit |
| face | 0.0107 | 0.0573 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_top_f0000: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0003 | 0.0030 |  |
| wing | 0.0023 | 0.0222 | edit |
| face | 0.0024 | 0.0201 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_top_f0077: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0237 | 0.0465 |  |
| wing | 0.1082 | 0.2127 | edit |
| face | 0.0868 | 0.2467 | edit |
| outside | 0.0000 | 0.0000 | guard |

## QA_top_f0168: PASS

| region | mean abs diff | changed share | role |
|---|---|---|---|
| whole | 0.0087 | 0.0198 |  |
| wing | 0.0532 | 0.1218 | edit |
| face | 0.0024 | 0.0202 | edit |
| outside | 0.0000 | 0.0000 | guard |
