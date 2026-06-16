import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildChoiceOptId,
  buildChoiceMenuId,
  buildChoiceUndoId,
  parseChoiceId,
  choiceButtonRows,
  choiceMenuRow,
} from "../src/messenger/discord-choice.js";
import type { ChoiceRequest } from "../src/messenger/base.js";

test("parseChoiceId — option / menu / undo / confirm / cancel", () => {
  assert.deepEqual(parseChoiceId(buildChoiceOptId("q1", 3)), {
    id: "q1",
    action: { kind: "opt", index: 3 },
  });
  assert.deepEqual(parseChoiceId(buildChoiceMenuId("q1")), {
    id: "q1",
    action: { kind: "menu" },
  });
  assert.deepEqual(parseChoiceId(buildChoiceUndoId("q1")), {
    id: "q1",
    action: { kind: "undo" },
  });
  assert.deepEqual(parseChoiceId("chief:choice:q1:c2"), {
    id: "q1",
    action: { kind: "confirm" },
  });
  assert.deepEqual(parseChoiceId("chief:choice:q1:cancel"), {
    id: "q1",
    action: { kind: "cancel" },
  });
});

test("parseChoiceId rejects foreign / malformed", () => {
  assert.equal(parseChoiceId("chief:confirm:q1:y"), null);
  assert.equal(parseChoiceId("chief:choice:q1"), null);
  assert.equal(parseChoiceId("chief:choice:q1:optX"), null);
  assert.equal(parseChoiceId("nope"), null);
});

test("≤5 options render as buttons; index (not value) encoded", () => {
  const req: ChoiceRequest = {
    id: "q1",
    question: "pick",
    options: [
      { value: "a:b", label: "A" },
      { value: "c", label: "C" },
    ],
  };
  const rows = choiceButtonRows(req).map((r) => r.toJSON());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].components.length, 2);
  // colon-containing value is safe because the index is encoded.
  assert.equal(rows[0].components[0].custom_id, "chief:choice:q1:opt0");
  assert.equal(rows[0].components[1].custom_id, "chief:choice:q1:opt1");
});

test("6+ options render as a select menu", () => {
  const req: ChoiceRequest = {
    id: "q2",
    question: "pick",
    options: Array.from({ length: 7 }, (_, i) => ({
      value: `v${i}`,
      label: `L${i}`,
    })),
  };
  const row = choiceMenuRow(req).toJSON();
  const menu = row.components[0] as { custom_id: string; options: unknown[] };
  assert.equal(menu.custom_id, "chief:choice:q2:menu");
  assert.equal(menu.options.length, 7);
});
