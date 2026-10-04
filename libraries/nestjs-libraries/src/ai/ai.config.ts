export type AiRole = 'text' | 'chat' | 'agent' | 'classification' | 'image';
export type AiProvider = 'openai' | 'deepseek' | 'openai-compatible';

type Environment = Record<string, string | undefined>;
const legacyModels: Record<AiRole, string> = {
  text: 'gpt-4.1',
  chat: 'gpt-4.1',
  agent: 'gpt-5.2',
  classification: 'gpt-4o-2024-08-06',
  image: 'chatgpt-image-latest',
};

// Read on demand: importing a module must not require an AI key or snapshot
// environment variables before the application's dotenv bootstrap has run.
export function getAiConfig(
  role: AiRole = 'text',
  env: Environment = process.env
) {
  const value = (key: string) => env[key]?.trim() || undefined;
  const prefix = role === 'image' ? 'AI_IMAGE' : 'AI_TEXT';
  const provider = value(`${prefix}_PROVIDER`) || 'openai';
  if (!['openai', 'deepseek', 'openai-compatible'].includes(provider)) {
    throw new Error(`${prefix}_PROVIDER is not supported`);
  }
  if (role === 'image' && provider === 'deepseek') {
    throw new Error('Configure a separate image generation provider');
  }
  const baseURL =
    value(`${prefix}_BASE_URL`) ||
    (provider === 'openai'
      ? 'https://api.openai.com/v1'
      : provider === 'deepseek'
      ? 'https://api.deepseek.com'
      : undefined);
  if (baseURL) {
    const url = new URL(baseURL);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        `${prefix}_BASE_URL must be an HTTP(S) URL without credentials`
      );
    }
  }
  const model =
    value(`AI_${role.toUpperCase()}_MODEL`) ||
    value(`${prefix}_MODEL`) ||
    (provider === 'openai' ? legacyModels[role] : undefined);
  // Never send an OpenAI key to another provider implicitly.
  const apiKey =
    value(`${prefix}_API_KEY`) ||
    (provider === 'openai' ? value('OPENAI_API_KEY') : undefined);
  const integer = (key: string, fallback: number, minimum: number) => {
    const input = value(key);
    const result = input === undefined ? fallback : Number(input);
    if (!Number.isSafeInteger(result) || result < minimum) {
      throw new Error(`${key} must be an integer >= ${minimum}`);
    }
    return result;
  };
  return {
    provider: provider as AiProvider,
    apiKey,
    baseURL,
    model,
    timeout: integer('AI_TIMEOUT_MS', 120000, 1),
    maxRetries: integer('AI_MAX_RETRIES', 0, 0),
  };
}

export function isAiConfigured(role: AiRole = 'text'): boolean {
  try {
    const config = getAiConfig(role);
    return !!(config.apiKey && config.model && config.baseURL);
  } catch {
    return false;
  }
}

export function requireAiConfig(role: AiRole = 'text', env = process.env) {
  const config = getAiConfig(role, env);
  if (!config.apiKey || !config.model || !config.baseURL) {
    throw new Error(
      `AI ${role} is not configured: API key, model and base URL are required`
    );
  }
  return config;
}
