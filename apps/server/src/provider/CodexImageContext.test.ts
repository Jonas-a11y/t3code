import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { readCodexImageContext } from "./CodexImageContext.ts";

it.effect("counts retained images and later tool images without reading earlier windows", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const path = `${directory}/rollout.jsonl`;
      const image = { type: "input_image", image_url: "data:image/png;base64,AA==" };
      const message = { type: "message", role: "user", content: [image, image] };
      const output = { type: "function_call_output", output: [image] };
      const reasoning = { type: "reasoning", summary: [], content: null };
      const checkpoint = {
        type: "compacted",
        payload: { replacement_history: [message, output, reasoning] },
      };
      const records = [
        "an earlier window need not be parsed",
        JSON.stringify(checkpoint),
        JSON.stringify({ type: "response_item", payload: output }),
        JSON.stringify({ type: "response_item", payload: reasoning }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "function_call_output", output: 'text mentioning "input_image"' },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "x".repeat(70_000) }],
          },
        }),
      ];
      yield* fs.writeFileString(path, `${records.join("\n")}\n`);
      assert.equal(yield* readCodexImageContext(path), 4);
      yield* fs.writeFileString(path, `${records.slice(2).join("\n")}\n`);
      assert.equal(yield* readCodexImageContext(path), 1);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses an unreadable or unsupported Codex image context", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const path = `${directory}/rollout.jsonl`;
      assert.equal(
        (yield* Effect.flip(readCodexImageContext(path)))._tag,
        "CodexImageContextError",
      );
      yield* fs.writeFileString(path, `${JSON.stringify({ type: "compacted", payload: {} })}\n`);
      assert.equal(
        (yield* Effect.flip(readCodexImageContext(path)))._tag,
        "CodexImageContextError",
      );
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
