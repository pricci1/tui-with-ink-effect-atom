import { Schema } from "effect";

export const MessageTypeSchema = Schema.Literal("user", "assistant", "system");
export const MessageSchema = Schema.Struct({
  id: Schema.String,
  type: MessageTypeSchema,
  content: Schema.String,
  timestamp: Schema.Number,
});
export type Message = Schema.Schema.Type<typeof MessageSchema>;

export const ConfigSchema = Schema.Struct({
  username: Schema.String,
  verbose: Schema.Boolean,
});
export type Config = Schema.Schema.Type<typeof ConfigSchema>;
