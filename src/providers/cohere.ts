import { CohereClient } from "cohere-ai";
import type { LLMProvider, ProviderConfigInput, GenerateContext } from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { buildSystemPrompt, buildUserPrompt } from "../learning/prompt.js";

export class CohereProvider implements LLMProvider {
  readonly name = "cohere";
  readonly displayName = "Cohere";
  readonly models = ["command-r-plus", "command-r", "command-r7b-12-2024"];
  readonly requiresApiKey = true;

  private client!: CohereClient;
  private configuredModel: string | null = null;

  configure(input: ProviderConfigInput): void {
    this.client = new CohereClient({ token: input.apiKey });
    this.configuredModel = input.model;
  }

  async generate(context: GenerateContext): Promise<string> {
    const model = this.configuredModel ?? this.models[0];
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await this.client.chat({
        model,
        message: userPrompt,
        preamble: systemPrompt,
        temperature: 0.3,
        maxTokens: 500,
      });

      const content = response.text;
      if (!content) throw new Error("Empty response from Cohere");
      return content.trim();
    } catch (cause) {
      throw new ProviderError(this.displayName, cause);
    }
  }
}
