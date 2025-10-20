import React from "react";
import { Box, Text } from "ink";

export const HelpScreen: React.FC = () => {
  return (
    <Box
      borderStyle="double"
      borderColor="yellow"
      padding={1}
      flexDirection="column"
    >
      <Text bold color="yellow">
        HELP - Keyboard Shortcuts
      </Text>
      <Text> </Text>
      <Text>
        <Text color="cyan">Enter</Text> - Send message
      </Text>
      <Text>
        <Text color="cyan">Backspace</Text> - Delete character
      </Text>
      <Text>
        <Text color="cyan">Ctrl+U</Text> - Clear input
      </Text>
      <Text>
        <Text color="cyan">Ctrl+H</Text> - Toggle help
      </Text>
      <Text>
        <Text color="cyan">Ctrl+C</Text> - Exit application
      </Text>
      <Text> </Text>
      <Text dimColor>Press Ctrl+H to close this help</Text>
    </Box>
  );
};
