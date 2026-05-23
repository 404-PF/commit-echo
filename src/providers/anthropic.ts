import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ProviderConfigInput, GenerateContext } from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { buildSystemPrompt, buildUserPrompt } from "../learning/prompt.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly displayName = "Anthropic";
  readonly models = ["claude-sonnet-4-20250514", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];
  readonly requiresApiKey = true;

  private client!: Anthropic;
  private configuredModel: string | null = null;

  configure(input: ProviderConfigInput): void {
    this.client = new Anthropic({ apiKey: input.apiKey });
    this.configuredModel = input.model;
  }

  async generate(context: GenerateContext): Promise<string> {
    const model = this.configuredModel ?? this.models[0];
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await this.client.messages.create({
        model,
        system: systemPrompt,
        max_tokens: 500,
        messages: [{ role: "user", content: userPrompt }],
      });

      const content = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (!content) throw new Error("Empty response from Anthropic");
      return content.trim();
    } catch (cause) {
      throw new ProviderError(this.displayName, cause);
    }
  }
}
