import type { AssistantMessage, Context, ToolResultMessage } from '@earendil-works/pi-ai';

// Synthetic, 1.3.0-checked values only. Never accept case data or credentials here.
export const route = {
  provider: 'eitri-offline',
  model: 'synthetic-text-tool',
  api: 'eitri-offline-stream',
  baseUrl: 'https://offline.invalid',
};
export const usage = {
  input: 5,
  output: 3,
  cacheRead: 1,
  cacheWrite: 2,
  reasoning: 1,
  totalTokens: 11,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
export const context: Context = {
  messages: [
    {
      role: 'system',
      content: 'Synthetic seam check only.',
      sections: { policy: 'No execution.' },
      toolsAdded: [
        {
          name: 'run_check',
          description: 'Synthetic data, not an executable tool.',
          parameters: {
            type: 'object',
            properties: { check: { type: 'string' } },
            required: ['check'],
            additionalProperties: false,
          },
        },
      ],
      timestamp: 1,
    },
    { role: 'user', content: 'Check café 🛠️\n你好', timestamp: 2 },
  ],
};
export const toolResponse: AssistantMessage = {
  role: 'assistant',
  provider: route.provider,
  model: route.model,
  api: route.api,
  content: [
    { type: 'text', text: 'Checking 🛠️', textSignature: 'synthetic-text-signature' },
    { type: 'thinking', thinking: '', thinkingSignature: 'synthetic-opaque', redacted: true },
    {
      type: 'toolCall',
      id: 'synthetic-call-α',
      name: 'run_check',
      arguments: { check: 'fixture-only' },
      thoughtSignature: 'synthetic-tool-signature',
    },
  ],
  usage,
  stopReason: 'toolUse',
  timestamp: 3,
};
export const toolResult: ToolResultMessage = {
  role: 'toolResult',
  toolCallId: 'synthetic-call-α',
  toolName: 'run_check',
  content: [{ type: 'text', text: 'Synthetic result ✓' }],
  details: { synthetic: true },
  isError: false,
  timestamp: 4,
};
export const finalResponse: AssistantMessage = {
  ...toolResponse,
  content: [{ type: 'text', text: 'Synthetic completion ✓' }],
  stopReason: 'stop',
  timestamp: 5,
};
