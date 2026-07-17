import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { localAiResolutionBaseUrl } from "../shared/aiResolution/localAiResolutionEndpoint.ts";
import { localAiReviewBaseUrl } from "../shared/aiReview/localAiReviewEndpoint.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

afterEach(function () {
  delete process.env.LOCAL_AI_REVIEW_PORT;
  delete process.env.LOCAL_AI_RESOLUTION_PORT;
});

test("local service endpoints follow the stack slot offsets", function () {
  const resources = deriveStackResources(2);

  assert.equal(localAiReviewBaseUrl(resources), "http://127.0.0.1:3022");
  assert.equal(localAiResolutionBaseUrl(resources), "http://127.0.0.1:3024");
});

test("local service endpoints preserve explicit port overrides", function () {
  process.env.LOCAL_AI_REVIEW_PORT = "4002";
  process.env.LOCAL_AI_RESOLUTION_PORT = "4004";
  const resources = deriveStackResources(2);

  assert.equal(localAiReviewBaseUrl(resources), "http://127.0.0.1:4002");
  assert.equal(localAiResolutionBaseUrl(resources), "http://127.0.0.1:4004");
});
