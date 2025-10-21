import React, { useEffect } from "react";
import { Box, Text, useStdin } from "ink";
import { Effect, Layer, Stream, Match } from "effect";
import {
  Atom,
  useAtomValue,
  useAtomSet
} from "@effect-atom/atom-react";
import readline from "readline";
import { type Message, type Config } from "./schemas";
import { ChatService, ChatServiceLive } from "./ChatService";
import { AnalyticsService, AnalyticsServiceLive } from "./AnalyticsService";
import { HelpScreen } from "./HelpScreenComponent";

const AppLayer = Layer.mergeAll(ChatServiceLive, AnalyticsServiceLive);

const runtimeAtom = Atom.runtime(AppLayer);

interface Key {
  name: string;
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

const lastKeyEventAtom = Atom.make<Key | null>(null).pipe(Atom.keepAlive);

const inputModeAtom = Atom.make<"normal" | "help">("normal").pipe(
  Atom.keepAlive,
);

interface TextBuffer {
  lines: string[];
  cursor: { row: number; column: number };
}

const textBufferStateAtom = Atom.make<TextBuffer>({
  lines: [""],
  cursor: { row: 0, column: 0 },
}).pipe(Atom.keepAlive);

const textBufferStringAtom = Atom.make((get) => {
  const state = get(textBufferStateAtom);
  return state.lines.join("\n");
});

const textBufferWithCursorStringAtom = Atom.make((get) => {
  // TODO: consider multiline
  const {
    cursor: { column },
  } = get(textBufferStateAtom);
  const text = get(textBufferStringAtom);
  return text.slice(0, column) + "|" + text.slice(column);
});

const textBufferIsEmptyAtom = Atom.make((get) => {
  const text = get(textBufferStringAtom);
  return text.trim().length === 0;
});

const messagesAtom = Atom.make<Message[]>([]).pipe(Atom.keepAlive);

const isStreamingAtom = Atom.make(false).pipe(Atom.keepAlive);

const sendMessageAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* (message: string) {
    const chat = yield* ChatService;
    const analytics = yield* AnalyticsService;

    yield* analytics.track("message_sent", { length: message.length });
    yield* chat.sendMessage(message);
  }),
);

const handleKeyEventAtom = runtimeAtom.fn<Key>()(
  Effect.fnUntraced(function* (key, get) {
    const mode = get(inputModeAtom);
    const isEmpty = get(textBufferIsEmptyAtom);
    const text = get(textBufferStringAtom);

    yield* Match.value(key).pipe(
      Match.when({ ctrl: true, name: "c" }, () =>
        Effect.sync(() => process.exit(0))
      ),
      Match.when({ ctrl: true, name: "a" }, () =>
        Effect.sync(() => {
          get.set(inputModeAtom, mode === "help" ? "normal" : "help");
        })
      ),
      Match.when(
        () => mode === "help",
        () => Effect.void
      ),
      Match.when({ name: "return" }, () =>
        Effect.sync(() => {
          if (!isEmpty) {
            get.set(isStreamingAtom, true);
            get.set(sendMessageAtom, text);
            get.set(clearTextBufferAtom, "");
            setTimeout(() => get.set(isStreamingAtom, false), 600);
          }
        })
      ),
      Match.when({ name: "backspace" }, () =>
        Effect.sync(() => get.set(deleteCharAtom, ""))
      ),
      Match.when({ ctrl: true, name: "u" }, () =>
        Effect.sync(() => get.set(clearTextBufferAtom, ""))
      ),
      Match.when(
        (k) => k.name === "left" || k.name === "right",
        (k) => Effect.sync(() => get.set(moveCursorAtom, k.name))
      ),
      Match.when(
        (k) => k.sequence.length === 1 && !k.ctrl && !k.meta,
        (k) => Effect.sync(() => get.set(insertCharAtom, k.sequence))
      ),
      Match.orElse(() => Effect.void)
    );
  }),
);

const initializeChatAtom = runtimeAtom.fn()(
  Effect.fnUntraced(function* (_, get) {
    const chat = yield* ChatService;
    const analytics = yield* AnalyticsService;

    yield* analytics.track("chat_initialized");

    // Start listening to messages
    yield* Effect.forkDaemon(
      Stream.runForEach(chat.messageStream, (msg) =>
        Effect.sync(() => {
          get.set(messagesAtom, [...get(messagesAtom), msg]);
        }),
      ),
    );

    yield* Effect.log("Chat service initialized");
  }),
);

const insertCharAtom = Atom.fn<string>()(
  Effect.fnUntraced(function* (char, get) {
    const state = get(textBufferStateAtom);
    const { lines, cursor } = state;
    const line = lines[cursor.row]!;
    const newLine =
      line.slice(0, cursor.column) + char + line.slice(cursor.column);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;

    get.set(textBufferStateAtom, {
      lines: newLines,
      cursor: { row: cursor.row, column: cursor.column + 1 },
    });
  }),
);

const moveCursorAtom = Atom.fn<"left" | "right">()(
  Effect.fnUntraced(function* (direction, get) {
    const state = get(textBufferStateAtom);
    const columnModifier = direction === "left" ? -1 : 1;
    const futureColumn = state.cursor.column + columnModifier;
    const lastLineLenght = state.lines.at(-1)?.length ?? Infinity;
    if (futureColumn < 0 || futureColumn > lastLineLenght) return;

    get.set(textBufferStateAtom, {
      ...state,
      cursor: { row: state.cursor.row, column: futureColumn },
    });
  }),
);

const deleteCharAtom = Atom.fn()(
  Effect.fnUntraced(function* (_, get) {
    const state = get(textBufferStateAtom);
    const { lines, cursor } = state;

    if (cursor.column === 0) {
      if (cursor.row > 0) {
        const prevLine = lines[cursor.row - 1]!;
        const currLine = lines[cursor.row]!;
        const newLines = [...lines];
        newLines[cursor.row - 1] = prevLine + currLine;
        newLines.splice(cursor.row, 1);

        get.set(textBufferStateAtom, {
          lines: newLines,
          cursor: { row: cursor.row - 1, column: prevLine.length },
        });
      }
    } else {
      const line = lines[cursor.row]!;
      const newLine =
        line.slice(0, cursor.column - 1) + line.slice(cursor.column);
      const newLines = [...lines];
      newLines[cursor.row] = newLine;

      get.set(textBufferStateAtom, {
        lines: newLines,
        cursor: { row: cursor.row, column: cursor.column - 1 },
      });
    }
  }),
);

const clearTextBufferAtom = Atom.fn()(
  Effect.fnUntraced(function* (_, get) {
    get.set(textBufferStateAtom, {
      lines: [""],
      cursor: { row: 0, column: 0 },
    });
  }),
);

// Handles raw keyboard input
const KeyboardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { stdin, setRawMode } = useStdin();
  const setLastKey = useAtomSet(lastKeyEventAtom);

  useEffect(() => {
    if (!stdin || !setRawMode) return;

    const originalRawMode = stdin.isRaw;
    setRawMode(true);

    const rl = readline.createInterface({
      input: stdin,
      escapeCodeTimeout: 50,
    });

    readline.emitKeypressEvents(stdin, rl);

    const handleKeypress = (_: unknown, key: any) => {
      if (key) {
        const parsedKey: Key = {
          name: key.name || "",
          sequence: key.sequence || "",
          ctrl: key.ctrl || false,
          meta: key.meta || false,
          shift: key.shift || false,
        };
        setLastKey(parsedKey);
      }
    };

    stdin.on("keypress", handleKeypress);

    return () => {
      stdin.off("keypress", handleKeypress);
      setRawMode(originalRawMode);
    };
  }, [stdin, setRawMode]);

  return <>{children}</>;
};

const StatusBar: React.FC<{ username: string }> = ({ username }) => {
  const mode = useAtomValue(inputModeAtom);
  const messageCount = useAtomValue(messagesAtom).length;
  const isStreaming = useAtomValue(isStreamingAtom);

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box flexGrow={1}>
        <Text color="cyan">User: </Text>
        <Text bold>{username}</Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">Messages: {messageCount}</Text>
        <Text color="gray"> | </Text>
        <Text color="magenta">Mode: {mode}</Text>
      </Box>
      {isStreaming && <Text color="green">● Streaming</Text>}
    </Box>
  );
};

const MessageDisplay: React.FC = () => {
  const messages = useAtomValue(messagesAtom);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
      {messages.length === 0 ? (
        <Text dimColor>No messages yet. Type something to start!</Text>
      ) : (
        messages.map((msg) => {
          const color = msg.type === "user" ? "cyan" : "green";
          const label = msg.type === "user" ? "You" : "AI";

          return (
            <Box key={msg.id} flexDirection="column" marginBottom={1}>
              <Text color={color} bold>
                {label}:
              </Text>
              <Text>{msg.content}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
};

const CommandInput: React.FC = () => {
  const text = useAtomValue(textBufferWithCursorStringAtom);
  const isEmpty = useAtomValue(textBufferIsEmptyAtom);
  const cursorPos = useAtomValue(textBufferStateAtom).cursor;

  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      flexDirection="column"
    >
      <Text dimColor={isEmpty}>
        {isEmpty ? "Type your message here..." : text}
      </Text>
      <Text dimColor>
        Cursor: ({cursorPos.row}, {cursorPos.column}) | Ctrl+H for help | Ctrl+C
        to exit
      </Text>
    </Box>
  );
};

const UI: React.FC<{ config: Config; onExit: () => void }> = ({
  config,
  onExit,
}) => {
  const lastKey = useAtomValue(lastKeyEventAtom);
  const mode = useAtomValue(inputModeAtom);
  const handleKeyEvent = useAtomSet(handleKeyEventAtom);

  useEffect(() => {
    if (!lastKey) return;

    handleKeyEvent(lastKey);
  }, [lastKey, handleKeyEvent]);

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar username={config.username} />

      {mode === "help" ? (
        <HelpScreen />
      ) : (
        <>
          <MessageDisplay />
          <CommandInput />
        </>
      )}
    </Box>
  );
};

export const App: React.FC<{ config: Config; onExit: () => void }> = ({
  config,
  onExit,
}) => {
  const initialize = useAtomSet(initializeChatAtom);

  useEffect(() => {
    initialize("");
  }, []);

  return (
    <KeyboardProvider>
      <UI config={config} onExit={onExit} />
    </KeyboardProvider>
  );
};
