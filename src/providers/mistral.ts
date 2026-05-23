import { Mistral } from "@mistralai/mistralai";
import type { LLMProvider, ProviderConfigInput, GenerateContext } from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { buildSystemPrompt, buildUserPrompt } from "../learning/prompt.js";

export class MistralProvider implements LLMProvider {
  readonly name = "mistral";
  readonly displayName = "Mistral AI";
  readonly models = ["mistral-large-latest", "mistral-small-latest", "open-mistral-nemo"];
  readonly requiresApiKey = true;

  private client!: Mistral;
  private configuredModel: string | null = null;

  configure(input: ProviderConfigInput): void {
    this.client = new Mistral({ apiKey: input.apiKey });
    this.configuredModel = input.model;
  }

  async generate(context: GenerateContext): Promise<string> {
    const model = this.configuredModel ?? this.models[0];
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await this.client.chat.complete({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 500,
      });

      const raw = response.choices?.[0]?.message?.content;
      if (!raw) throw new Error("Empty response from Mistral");
      const content = Array.isArray(raw)
        ? raw.filter(c => c.type === "text").map(c => c.text).join("")
        : raw;
      if (!content) throw new Error("Empty response from Mistral");
      return content.trim();
    } catch (cause) {
      throw new ProviderError(this.displayName, cause);
    }
  }
}
