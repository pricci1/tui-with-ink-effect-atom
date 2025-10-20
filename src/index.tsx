import { render } from "ink";
import { Effect, Schema } from "effect";
import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { ConfigSchema, type Config } from "./schemas";
import { App } from "./App";

const usernameOption = Options.text("username").pipe(
  Options.withAlias("u"),
  Options.withDefault("User"),
);

const verboseOption = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDefault(false),
);

const runCommand = Command.make(
  "demo",
  { username: usernameOption, verbose: verboseOption },
  ({ username, verbose }) =>
    Effect.gen(function* () {
      const config: Config = { username, verbose };

      const validatedConfig = yield* Schema.decodeUnknown(ConfigSchema)(config);

      if (verbose) {
        yield* Effect.log(
          `Starting TUI Demo with config: ${JSON.stringify(validatedConfig)}`,
        );
      }

      // Set terminal title
      process.stdout.write(
        `\x1b]0;Effect TUI Demo - ${validatedConfig.username}\x07`,
      );

      const { waitUntilExit } = render(
        <App
          config={validatedConfig}
          onExit={() => {
            process.exit(0);
          }}
        />,
      );

      yield* Effect.promise(() => waitUntilExit());
    }),
);

const cli = Command.run(runCommand, {
  name: "demo-tui",
  version: "v1.0.0",
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
