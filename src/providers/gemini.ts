import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, ProviderConfigInput, GenerateContext } from "./types.js";
import { ProviderError } from "../utils/errors.js";
import { buildSystemPrompt, buildUserPrompt } from "../learning/prompt.js";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly displayName = "Google Gemini";
  readonly models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro"];
  readonly requiresApiKey = true;

  private client!: GoogleGenAI;
  private configuredModel: string | null = null;

  configure(input: ProviderConfigInput): void {
    this.client = new GoogleGenAI({ apiKey: input.apiKey });
    this.configuredModel = input.model;
  }

  async generate(context: GenerateContext): Promise<string> {
    const model = this.configuredModel ?? this.models[0];
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 500,
          temperature: 0.3,
        },
      });

      const content = response.text;
      if (!content) throw new Error("Empty response from Gemini");
      return content.trim();
    } catch (cause) {
      throw new ProviderError(this.displayName, cause);
    }
  }
}
