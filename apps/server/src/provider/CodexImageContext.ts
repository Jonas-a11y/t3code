import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import {
  createTranscriptJsonReader,
  createTranscriptJsonSelector,
} from "../project/AgentSessionJson.ts";

class CodexImageContextError extends Schema.TaggedError<CodexImageContextError>()(
  "CodexImageContextError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return "Could not read Codex's image context. Disable automatic image compaction or retry with a supported Codex session.";
  }
}

const Content = Schema.Array(Schema.Struct({ type: Schema.String }));
const ResponseItem = Schema.Struct({
  type: Schema.String,
  content: Schema.optionalKey(Schema.NullOr(Content)),
  output: Schema.optionalKey(Schema.Union([Schema.String, Content])),
});
const Record = Schema.Struct({
  type: Schema.String,
  payload: Schema.Struct({
    type: Schema.optionalKey(Schema.String),
    content: Schema.optionalKey(Schema.NullOr(Content)),
    output: Schema.optionalKey(Schema.Union([Schema.String, Content])),
    replacement_history: Schema.optionalKey(Schema.NullOr(Schema.Array(ResponseItem))),
  }),
});
const selectRecord = createTranscriptJsonSelector(Record);
const decodeRecord = Schema.decodeUnknownSync(Record);
const decodeItem = Schema.decodeUnknownSync(ResponseItem);
const decodeCheckpoint = Schema.decodeUnknownSync(
  Schema.Struct({ replacement_history: Schema.Array(ResponseItem) }),
);

function imageCount(item: typeof ResponseItem.Type) {
  const content =
    item.type === "message"
      ? item.content
      : (item.type === "function_call_output" || item.type === "custom_tool_call_output") &&
          Array.isArray(item.output)
        ? item.output
        : undefined;
  return content?.filter((block) => block.type === "input_image").length ?? 0;
}

// Codex's RPC history is the visible transcript; its rollout checkpoint contains retained context.
export const readCodexImageContext = Effect.fn("CodexImageContext.read")(
  function* (path: string) {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: "r" });
    let cursor = BigInt((yield* file.stat).size);
    let lineEnd = cursor;
    let count = 0;
    // Both helpers run per chunk or record under the enclosing read span.
    const readBytes = Effect.fnUntraced(function* (position: bigint, size: number) {
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const length = yield* file.read(bytes.subarray(offset), {
          position: position + BigInt(offset),
        });
        if (length === 0)
          return yield* new CodexImageContextError({
            path,
            cause: "The Codex rollout changed while reading.",
          });
        offset += length;
      }
      return bytes;
    });
    const consume = Effect.fnUntraced(function* (start: bigint, end: bigint) {
      if (start === end) return undefined;
      const reader = createTranscriptJsonReader(() => undefined, selectRecord);
      const decoder = new TextDecoder();
      for (let position = start; position < end;) {
        const size = Number(end - position > 65_536n ? 65_536n : end - position);
        const bytes = yield* readBytes(position, size);
        yield* Effect.try({
          try: () => reader.write(decoder.decode(bytes, { stream: true })),
          catch: (cause) => new CodexImageContextError({ path, cause }),
        });
        position += BigInt(size);
      }
      return yield* Effect.try({
        try: () => {
          reader.write(decoder.decode());
          const record = decodeRecord(reader.finish());
          if (record.type === "compacted") {
            return (
              count +
              decodeCheckpoint(record.payload).replacement_history.reduce(
                (total, item) => total + imageCount(item),
                0,
              )
            );
          }
          if (record.type === "response_item") count += imageCount(decodeItem(record.payload));
          return undefined;
        },
        catch: (cause) => new CodexImageContextError({ path, cause }),
      });
    });
    // Locate lines backwards; parse forwards in chunks without retaining base64 image data.
    while (cursor > 0n) {
      const size = Number(cursor > 65_536n ? 65_536n : cursor);
      cursor -= BigInt(size);
      const bytes = yield* readBytes(cursor, size);
      for (let index = bytes.length - 1; index >= 0; index--) {
        if (bytes[index] !== 10) continue;
        const position = cursor + BigInt(index);
        const checkpointCount = yield* consume(position + 1n, lineEnd);
        if (checkpointCount !== undefined) return checkpointCount;
        lineEnd = position;
      }
    }
    return (yield* consume(0n, lineEnd)) ?? count;
  },
  Effect.scoped,
  (effect, path) =>
    effect.pipe(
      Effect.mapError((cause) =>
        cause._tag === "CodexImageContextError"
          ? cause
          : new CodexImageContextError({ path, cause }),
      ),
    ),
);
