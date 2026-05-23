import OpenAI from "openai";
import type { LLMProvider, ProviderConfigInput, GenerateContext } from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { buildSystemPrompt, buildUserPrompt } from "../learning/prompt.js";

export class OpenAICompatible implements LLMProvider {
  readonly name: string;
  readonly displayName: string;
  readonly models: string[];
  readonly defaultBaseUrl: string;
  readonly requiresApiKey = true;

  private client!: OpenAI;
  private configuredModel: string | null = null;

  constructor(name: string, displayName: string, models: string[], defaultBaseUrl: string) {
    this.name = name;
    this.displayName = displayName;
    this.models = models;
    this.defaultBaseUrl = defaultBaseUrl;
  }

  configure(input: ProviderConfigInput): void {
    this.client = new OpenAI({
      apiKey: input.apiKey,
      baseURL: input.baseUrl || this.defaultBaseUrl,
    });
    this.configuredModel = input.model;
  }

  async generate(context: GenerateContext): Promise<string> {
    const model = this.configuredModel ?? this.models[0];
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from LLM");
      return content.trim();
    } catch (cause) {
      throw new ProviderError(this.displayName, cause);
    }
  }
}
