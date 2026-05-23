import { Ollama } from "ollama";
import type { LLMProvider, ProviderConfigInput, GenerateContext } from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { buildSystemPrompt, buildUserPrompt } from "../learning/prompt.js";

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly displayName = "Ollama (local)";
  readonly models = ["llama3.2", "llama3.1", "mistral", "codellama", "qwen2.5-coder"];
  readonly requiresApiKey = false;

  private client!: Ollama;
  private configuredModel: string | null = null;

  configure(input: ProviderConfigInput): void {
    this.client = new Ollama({
      host: input.baseUrl || undefined,
    });
    this.configuredModel = input.model;
  }

  async generate(context: GenerateContext): Promise<string> {
    const model = this.configuredModel ?? this.models[0];
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await this.client.chat({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        options: { temperature: 0.3, num_predict: 500 },
      });

      const content = response.message?.content;
      if (!content) throw new Error("Empty response from Ollama");
      return content.trim();
    } catch (cause) {
      throw new ProviderError(this.displayName, cause);
    }
  }
}
