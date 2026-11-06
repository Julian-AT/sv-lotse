# Third-party notices

## Vercel AI Chatbot template

The /workspace chat is taken from Vercel's AI Chatbot template
(https://github.com/vercel/chatbot, commit a8989b522fa3672a2ae52f053105e40993b36ca1):
`src/components/ui/` (shadcn/ui) and `src/components/ai-elements/` (AI Elements) are copied
unchanged apart from formatting, German tool status labels and two type casts for this repo's
stricter TypeScript settings; `src/components/chat/` (messages, message, multimodal input,
suggested actions, greeting, chat header, message actions, reasoning, attachment preview, app
sidebar, icons), `src/hooks/use-messages.tsx`, `use-scroll-to-bottom.tsx`, `use-mobile.ts`,
`src/components/theme-provider.tsx` and the theme in `src/app/ai-elements.css` are adapted from
it. Changes: German copy, SV KI-Lotse's chat transport, cases instead of chat history, our tool
parts and cards inside the message layout, preflight scoped to the chat, and removal of auth,
database, model selector, artifacts, votes and slash commands.

```
Copyright 2024 Vercel, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

The AI Elements components (https://ai-sdk.dev/elements) that the template ships are by Vercel,
Inc. under the Apache License 2.0 as well.
