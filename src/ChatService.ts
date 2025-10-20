import { Context, Effect, Layer, Stream, Queue } from "effect";
import { type Message } from "./schemas";

export class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    readonly sendMessage: (content: string) => Effect.Effect<void>;
    readonly messageStream: Stream.Stream<Message>;
    readonly dispose: () => Effect.Effect<void>;
  }
>() {}

export const ChatServiceLive = Layer.scoped(
  ChatService,
  Effect.gen(function* () {
    const messageQueue = yield* Queue.unbounded<Message>();

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.log("Cleaning up ChatService");
        yield* Queue.shutdown(messageQueue);
      }),
    );

    return {
      sendMessage: (content: string) =>
        Effect.gen(function* () {
          const userMsg: Message = {
            id: crypto.randomUUID(),
            type: "user",
            content,
            timestamp: Date.now(),
          };
          yield* Queue.offer(messageQueue, userMsg);

          // Simulate AI response delay
          yield* Effect.sleep("500 millis");

          const responses = [
            "That's interesting! Tell me more.",
            "I understand what you mean.",
            "How does that make you feel?",
            "Fascinating perspective!",
            "Could you elaborate on that?",
          ];

          const aiMsg: Message = {
            id: crypto.randomUUID(),
            type: "assistant",
            content:
              responses[Math.floor(Math.random() * responses.length)] ?? "",
            timestamp: Date.now(),
          };
          yield* Queue.offer(messageQueue, aiMsg);
        }),

      messageStream: Stream.fromQueue(messageQueue),

      dispose: () => Queue.shutdown(messageQueue),
    };
  }),
);
