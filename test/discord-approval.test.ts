import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildApprovalId,
  parseApprovalId,
  approvalRow,
  confirmRejectRow,
} from "../src/messenger/discord-approval.js";

test("buildApprovalId / parseApprovalId round-trip", () => {
  for (const action of ["y", "n", "n2", "cancel"] as const) {
    const id = buildApprovalId("abc12345", action);
    assert.equal(id, `chief:confirm:abc12345:${action}`);
    assert.deepEqual(parseApprovalId(id), { id: "abc12345", action });
  }
});

test("parseApprovalId rejects foreign / malformed customIds", () => {
  assert.equal(parseApprovalId("chief:stop:acme:1"), null); // other button
  assert.equal(parseApprovalId("chief:confirm:abc"), null); // no action
  assert.equal(parseApprovalId("chief:confirm:abc:bogus"), null); // bad action
  assert.equal(parseApprovalId("random"), null);
});

test("approvalRow renders ✅/❌ buttons, disabled flag respected (recovery ③)", () => {
  const live = approvalRow("id1").toJSON();
  assert.equal(live.components.length, 2);
  assert.equal(live.components[0].custom_id, "chief:confirm:id1:y");
  assert.equal(live.components[1].custom_id, "chief:confirm:id1:n");
  assert.notEqual(live.components[0].disabled, true);

  const disabled = approvalRow("id1", true).toJSON();
  assert.equal(disabled.components[0].disabled, true);
  assert.equal(disabled.components[1].disabled, true);
});

test("confirmRejectRow renders the 2-step confirm buttons (recovery ①)", () => {
  const row = confirmRejectRow("id1").toJSON();
  assert.equal(row.components[0].custom_id, "chief:confirm:id1:n2");
  assert.equal(row.components[1].custom_id, "chief:confirm:id1:cancel");
});
