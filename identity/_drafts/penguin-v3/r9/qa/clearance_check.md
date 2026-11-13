# clearance_check (skills/rig-motion-clearance) per clip, all frames, subframes 2, min 8 mm

Pairs: wing_tip_L/R (paddle > 7 cm from the pivot) vs head, body, face pieces, feet, the other wing, desk.set (office kit).
Distances unsigned (vertex-group parts are open shells; the stock script's normal sign flips there, see SKILL Gotchas) - penetration = BVH overlap ('CROSS').

## r07

| clip | head | body | face | feet | wing-wing | prop_00_desk.set | min | pass (>= 8 mm, no crossing) |
|---|---|---|---|---|---|---|---|---|
| hop | 119.9 | 21.7 | 145.9 | 194.0 | 423.1 | 4097.4 | 21.7 | PASS |
| wave | CROSS f67.0 | CROSS f67.0 | 68.7 | 228.7 | 390.5 | 4101.1 | 0.0 | FAIL |
| walk | 136.3 | 31.3 | 160.1 | 255.3 | 449.6 | 4174.0 | 31.3 | PASS |
| seated | 147.8 | 26.4 | 148.4 | 225.9 | 427.9 | 4229.2 | 26.4 | PASS |
| raise-max | CROSS f168.0 | CROSS f168.0 | 78.2 | 424.1 | 353.3 | 4217.3 | 0.0 | FAIL |
| seated-desk | 147.8 | 26.4 | 148.4 | 225.9 | 427.9 | 125.7 | 26.4 | PASS |
SOME FAIL

## r08

| clip | head | body | face | feet | wing-wing | prop_00_desk.set | min | pass (>= 8 mm, no crossing) |
|---|---|---|---|---|---|---|---|---|
| hop | 118.4 | 14.8 | 142.8 | 195.2 | 423.3 | 4101.6 | 14.8 | PASS |
| wave | 18.5 | 14.3 | 82.3 | 228.7 | 427.9 | 4120.4 | 14.3 | PASS |
| walk | 135.1 | 34.0 | 150.3 | 255.2 | 448.7 | 4175.0 | 34.0 | PASS |
| seated | 151.1 | 28.3 | 152.6 | 236.6 | 437.3 | 4215.8 | 28.3 | PASS |
| raise-max | 24.5 | 11.9 | 81.8 | 416.0 | 426.3 | 4176.7 | 11.9 | PASS |
| seated-desk | 151.1 | 28.3 | 152.6 | 236.6 | 437.3 | 137.5 | 28.3 | PASS |
ALL PASS

## r09

| clip | head | body | face | feet | wing-wing | prop_00_desk.set | min | pass (>= 8 mm, no crossing) |
|---|---|---|---|---|---|---|---|---|
| hop | 120.5 | 14.3 | 139.5 | 194.8 | 422.7 | 4097.4 | 14.3 | PASS |
| wave | 28.5 | 23.1 | 99.1 | 228.7 | 427.5 | 4111.1 | 23.1 | PASS |
| walk | 136.5 | 33.7 | 155.0 | 255.3 | 449.2 | 4174.1 | 33.7 | PASS |
| seated | 151.3 | 27.9 | 153.6 | 236.8 | 437.3 | 4215.5 | 27.9 | PASS |
| raise-max | 35.3 | 22.0 | 98.0 | 410.8 | 453.8 | 4172.0 | 22.0 | PASS |
| seated-desk | 151.3 | 27.9 | 153.6 | 236.8 | 437.3 | 139.0 | 27.9 | PASS |
ALL PASS

