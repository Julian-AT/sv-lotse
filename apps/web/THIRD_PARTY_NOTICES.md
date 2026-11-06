# Third-party notices

## Vercel AI Chatbot template

The chat surface in `src/components/ai-elements/`, `src/components/ui/`, `src/app/ai-elements.css`
and `src/conversation/conversation.tsx` / `messages.tsx` is adapted from Vercel's AI Chatbot
template (https://github.com/vercel/chatbot, commit a8989b522fa3672a2ae52f053105e40993b36ca1):
its theme tokens, message layout, tool, suggestion, shimmer and prompt-input components.
Changes: German copy, wiring to the SV KI-Lotse `useChat` transport and tool parts, removal of
auth, database, model selector and artifacts, CSS keyframes instead of `motion`.

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
