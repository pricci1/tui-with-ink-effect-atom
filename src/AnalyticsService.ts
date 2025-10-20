import { Context, Effect, Layer } from "effect";

export class AnalyticsService extends Context.Tag("AnalyticsService")<
  AnalyticsService,
  {
    readonly track: (
      event: string,
      props?: Record<string, unknown>,
    ) => Effect.Effect<void>;
    readonly getStats: () => Effect.Effect<{ totalEvents: number }>;
  }
>() {}

export const AnalyticsServiceLive = Layer.effect(
  AnalyticsService,
  Effect.gen(function* () {
    let eventCount = 0;

    return {
      track: (event, props = {}) =>
        Effect.sync(() => {
          eventCount++;
          if (props.verbose) {
            console.log(`[Analytics] ${event}:`, props);
          }
        }),

      getStats: () =>
        Effect.sync(() => ({
          totalEvents: eventCount,
        })),
    };
  }),
);
