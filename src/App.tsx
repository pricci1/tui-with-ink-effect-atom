import React, { useEffect } from "react";
import { Box, Text, useStdin } from "ink";
import { Effect, Layer, Stream } from "effect";
import {
  Atom,
  useAtomValue,
  useAtomSet,
  useAtom,
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

const insertCharAtom = Atom.fn()(
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

const clearTextBufferAtom = Atom.fn(
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
  const text = useAtomValue(textBufferStringAtom);
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
  const [mode, setMode] = useAtom(inputModeAtom);
  const isEmpty = useAtomValue(textBufferIsEmptyAtom);
  const text = useAtomValue(textBufferStringAtom);
  const setIsStreaming = useAtomSet(isStreamingAtom);

  const insertChar = useAtomSet(insertCharAtom);
  const deleteChar = useAtomSet(deleteCharAtom);
  const clearBuffer = useAtomSet(clearTextBufferAtom);
  const sendMessage = useAtomSet(sendMessageAtom);

  useEffect(() => {
    if (!lastKey) return;

    if (lastKey.ctrl && lastKey.name === "c") {
      onExit();
      return;
    }

    if (lastKey.ctrl && lastKey.name === "a") {
      setMode(mode === "help" ? "normal" : "help");
      return;
    }

    // Help mode - consume all keys except exit
    if (mode === "help") {
      return;
    }

    // Normal mode - text editing
    if (lastKey.name === "return") {
      if (!isEmpty) {
        setIsStreaming(true);
        sendMessage(text);
        clearBuffer("");
        setTimeout(() => setIsStreaming(false), 600);
      }
    } else if (lastKey.name === "backspace") {
      deleteChar("");
    } else if (lastKey.ctrl && lastKey.name === "u") {
      clearBuffer("");
    } else if (
      lastKey.sequence.length === 1 &&
      !lastKey.ctrl &&
      !lastKey.meta
    ) {
      insertChar(lastKey.sequence);
    }
  }, [lastKey]);

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
