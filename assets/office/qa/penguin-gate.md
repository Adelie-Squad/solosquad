# Production penguin — motion gate

clearance_check: wing tips vs head · body · face · feet · other tip · both fillets · desk.set (seated clips) · card plane (standing clips); min 0.008 m, 2 subframes.
motion_path: wing.L / wing.R tips + head top; pop > 2.5x median spacing, kink > 60 deg.
hinge limits: raise -8..112 deg, twist +-15 deg.

body · feet · head vs the chair and desk (seated clips): no crossing (contact allowed).

| clip | frames | wing min clearance (mm) | at | nearest | body vs chair/desk (mm) | motion_path | raise (deg) | twist (deg) | result |
|---|---|---|---|---|---|---|---|---|---|
| idle | 61 | 14.1 | f37.0 | penguin.joint.L | 7.0 | 3 tracks x 61 frames, 0 problems | 3..7 | -0..0 | PASS |
| idle_doze | 61 | 12.3 | f37.0 | penguin.joint.R | 3.9 | 3 tracks x 61 frames, 0 problems | 1..3 | -0..0 | PASS |
| thinking | 61 | 16.2 | f45.0 | penguin.joint.L | 6.1 | 3 tracks x 61 frames, 0 problems | 6..40 | -0..10 | PASS |
| typing | 61 | 19.8 | f11.0 | penguin.joint.L | 10.7 | 3 tracks x 61 frames, 0 problems | 19..33 | 4..4 | PASS |
| waiting | 61 | 16.2 | f0.0 | penguin.joint.L | 5.6 | 3 tracks x 61 frames, 0 problems | 6..104 | -8..-0 | PASS |
| done | 31 | 15.5 | f30.0 | penguin.joint.L | 4.4 | 3 tracks x 31 frames, 0 problems | 5..50 | -0..0 | PASS |
| error | 61 | 11.4 | f37.5 | penguin.joint.R | 9.3 | 3 tracks x 61 frames, 0 problems | -0..2 | -0..0 | PASS |
| stand | 61 | 13.4 | f37.0 | penguin.joint.L | — | 3 tracks x 61 frames, 0 problems | 2..6 | -0..0 | PASS |
| walk | 33 | 14.3 | f22.0 | penguin.joint.L | — | 3 tracks x 33 frames, 0 problems | 3..17 | -0..0 | PASS |
| hop | 37 | 16.2 | f36.0 | penguin.joint.L | — | 3 tracks x 37 frames, 0 problems | 6..42 | -0..0 | PASS |
| wave | 49 | 12.1 | f0.0 | penguin.joint.L | — | 3 tracks x 49 frames, 0 problems | 0..108 | -12..0 | PASS |

RESULT: PASS
