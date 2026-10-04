import OpenAI from 'openai';
import { createOpenAI } from '@ai-sdk/openai';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { AutoParseableResponseFormat } from 'openai/lib/parser';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { RequestOptions } from 'openai/internal/request-options';
import { AiRole, requireAiConfig } from './ai.config';

type CompletionInput = Omit<ChatCompletionCreateParamsNonStreaming, 'model'>;

// Framework adapters share one configuration boundary. They retain their native
// streaming/tool protocols so existing CopilotKit and LangGraph consumers work.
export class AiModelService {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  private config(role: AiRole = 'text') {
    return requireAiConfig(role, this.environment);
  }
  client(role: AiRole = 'text') {
    const { apiKey, baseURL, timeout, maxRetries } = this.config(role);
    return new OpenAI({ apiKey, baseURL, timeout, maxRetries });
  }

  langchain(role: AiRole = 'text', temperature = 0.7) {
    const config = this.config(role);
    return new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
      useResponsesApi: false,
      configuration: { baseURL: config.baseURL },
    });
  }

  languageModel(role: AiRole = 'agent'): ReturnType<OpenAIProvider['chat']> {
    const config = this.config(role);
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([
                init.signal,
                AbortSignal.timeout(config.timeout),
              ])
            : AbortSignal.timeout(config.timeout),
        }),
    });
    // Preserve the legacy OpenAI Responses path; compatible vendors use Chat.
    return config.provider === 'openai'
      ? provider(config.model!)
      : provider.chat(config.model!);
  }

  structured<T extends Record<string, unknown>>(
    schema: z.ZodType<T>,
    role: AiRole = 'text',
    temperature = 0.7
  ) {
    const config = this.config(role);
    return this.langchain(role, temperature).withStructuredOutput<T>(schema, {
      method: config.provider === 'openai' ? 'jsonSchema' : 'functionCalling',
    });
  }

  async complete(input: CompletionInput, options?: RequestOptions) {
    const config = this.config();
    const client = this.client();
    // Many compatible endpoints only accept one candidate per request.
    if (config.provider !== 'openai' && (input.n || 1) > 1) {
      const results = [];
      for (let index = 0; index < input.n!; index++) {
        results.push(
          await client.chat.completions.create(
            {
              ...input,
              n: 1,
              model: config.model!,
            },
            options
          )
        );
      }
      return {
        ...results[0],
        choices: results.flatMap((result) => result.choices),
      };
    }
    return client.chat.completions.create(
      { ...input, model: config.model! },
      options
    );
  }

  async parse<T>(
    input: Omit<CompletionInput, 'response_format'> & {
      response_format: AutoParseableResponseFormat<T>;
    },
    options?: RequestOptions
  ) {
    const config = this.config();
    if (config.provider === 'openai') {
      return this.client().chat.completions.parse(
        { ...input, model: config.model! },
        options
      );
    }
    const { response_format, ...rest } = input;
    const completion = await this.complete(
      {
        ...rest,
        messages: [
          {
            role: 'system',
            content: `Return only valid JSON matching this schema: ${JSON.stringify(
              response_format.json_schema.schema
            )}`,
          },
          ...rest.messages,
        ],
        response_format: { type: 'json_object' },
      },
      options
    );
    return {
      ...completion,
      choices: completion.choices.map((choice) => {
        if (
          choice.finish_reason !== 'stop' ||
          !choice.message.content ||
          choice.message.refusal
        ) {
          throw new Error('AI did not return a complete structured response');
        }
        return {
          ...choice,
          message: {
            ...choice.message,
            parsed: response_format.$parseRaw(choice.message.content),
          },
        };
      }),
    };
  }

  async image(prompt: string, size: '1024x1024' | '1024x1536' = '1024x1024') {
    const config = this.config('image');
    const result = await this.client('image').images.generate({
      model: config.model!,
      prompt,
      size,
    });
    const image = result.data?.[0];
    if (!image?.b64_json && !image?.url)
      throw new Error('AI image response is empty');
    return image;
  }

  async imageSource(prompt: string) {
    const image = await this.image(prompt);
    return image.b64_json
      ? `data:image/png;base64,${image.b64_json}`
      : image.url!;
  }
}

export const aiModels = new AiModelService();
