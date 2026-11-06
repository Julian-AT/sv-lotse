import { wrapLanguageModel } from "ai";
import { toolNames } from "../tools/contracts/index.ts";

// OpenAI function names cannot contain dots. This is a provider-only encoding:
// registry, histories, UI parts, signatures and database records keep PRD names.
const encoded = new Map<string, string>(
  toolNames.map((name) => [name, `lotse_${name.replaceAll(".", "_")}`]),
);
const decoded = new Map([...encoded].map(([name, alias]) => [alias, name]));
if (encoded.size !== decoded.size) throw new Error("Provider tool name collision");
const encode = (name: string) => encoded.get(name) ?? name;
const decode = (name: string) => decoded.get(name) ?? name;

export function withProviderToolNames(model: Parameters<typeof wrapLanguageModel>[0]["model"]) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({
        ...params,
        ...(params.tools
          ? {
              tools: params.tools.map((tool) =>
                tool.type === "function" ? { ...tool, name: encode(tool.name) } : tool,
              ),
            }
          : {}),
        ...(params.toolChoice?.type === "tool"
          ? { toolChoice: { ...params.toolChoice, toolName: encode(params.toolChoice.toolName) } }
          : {}),
        prompt: params.prompt.map((message) => {
          if (message.role === "assistant")
            return {
              ...message,
              content: message.content.map((part) =>
                "toolName" in part ? { ...part, toolName: encode(part.toolName) } : part,
              ),
            };
          if (message.role === "tool")
            return {
              ...message,
              content: message.content.map((part) =>
                "toolName" in part ? { ...part, toolName: encode(part.toolName) } : part,
              ),
            };
          return message;
        }),
      }),
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        return {
          ...result,
          content: result.content.map((part) =>
            "toolName" in part ? { ...part, toolName: decode(part.toolName) } : part,
          ),
        };
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(part, controller) {
                controller.enqueue(
                  "toolName" in part ? { ...part, toolName: decode(part.toolName) } : part,
                );
              },
            }),
          ),
        };
      },
    },
  });
}
