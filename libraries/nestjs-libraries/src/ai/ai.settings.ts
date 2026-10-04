import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { dirname, join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { parse } from 'dotenv';
import { z } from 'zod';
import { getAiConfig } from './ai.config';
import { AiModelService } from './ai.models';

const singleLine = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => !/[\r\n\0']/.test(value), '不允许换行或单引号');
const channel = z
  .object({
    provider: z.enum(['openai', 'deepseek', 'openai-compatible']),
    baseURL: singleLine,
    model: singleLine,
    apiKey: singleLine.optional().default(''),
  })
  .strict();
const settingsSchema = z
  .object({
    revision: z.string(),
    text: channel,
    image: channel,
    chatModel: singleLine,
    agentModel: singleLine,
    classificationModel: singleLine,
    timeout: z.number().int().min(1000).max(600000),
    maxRetries: z.number().int().min(0).max(5),
  })
  .strict();

export class AiSettingsService {
  constructor(private readonly filePath?: string) {}

  private file() {
    if (this.filePath) return this.filePath;
    if (process.env.AI_SETTINGS_FILE) return process.env.AI_SETTINGS_FILE;
    let directory = process.cwd();
    while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      const parent = dirname(directory);
      if (parent === directory)
        throw new ServiceUnavailableException(
          '当前部署不支持修改本地 .env，请由部署管理员配置。'
        );
      directory = parent;
    }
    return join(directory, '.env');
  }

  private read() {
    try {
      const file = this.file();
      const content = readFileSync(file, 'utf8');
      return {
        file,
        content,
        env: { ...process.env, ...parse(content) },
        revision: createHash('sha256').update(content).digest('hex'),
      };
    } catch {
      throw new ServiceUnavailableException(
        '无法读取项目 .env，请检查部署方式和文件权限。'
      );
    }
  }

  assertAdmin(user: { isSuperAdmin?: boolean } | undefined) {
    if (!user?.isSuperAdmin)
      throw new ForbiddenException('只有系统超级管理员可以修改全局 AI 配置。');
  }

  get() {
    const { env, revision } = this.read();
    const publicChannel = (role: 'text' | 'image') => {
      const config = getAiConfig(role, env);
      return {
        provider: config.provider,
        baseURL: config.baseURL || '',
        model: config.model || '',
        hasKey: !!config.apiKey,
      };
    };
    const config = getAiConfig('text', env);
    return {
      revision,
      text: publicChannel('text'),
      image: publicChannel('image'),
      chatModel: env.AI_CHAT_MODEL || '',
      agentModel: env.AI_AGENT_MODEL || '',
      classificationModel: env.AI_CLASSIFICATION_MODEL || '',
      timeout: config.timeout,
      maxRetries: config.maxRetries,
      restartRequired: true,
    };
  }

  private prepare(input: unknown) {
    const result = settingsSchema.safeParse(input);
    if (!result.success)
      throw new BadRequestException(
        '配置格式无效，请检查地址、模型、超时和重试次数。'
      );
    const data = result.data;
    const current = this.read();
    if (data.revision !== current.revision)
      throw new ConflictException('配置已被其他操作修改，请重新加载后再保存。');
    const changes: Record<string, string> = {};
    for (const role of ['text', 'image'] as const) {
      const draft = data[role];
      const prefix = `AI_${role.toUpperCase()}`;
      const old = getAiConfig(role, current.env);
      if (
        old.apiKey &&
        !draft.apiKey &&
        (draft.provider !== old.provider ||
          draft.baseURL.replace(/\/$/, '') !== old.baseURL?.replace(/\/$/, ''))
      ) {
        throw new BadRequestException(
          '切换供应商或接口地址时，请重新填写对应 API Key。'
        );
      }
      changes[`${prefix}_PROVIDER`] = draft.provider;
      changes[`${prefix}_BASE_URL`] = draft.baseURL;
      changes[`${prefix}_MODEL`] = draft.model;
      if (draft.apiKey) changes[`${prefix}_API_KEY`] = draft.apiKey;
    }
    Object.assign(changes, {
      AI_CHAT_MODEL: data.chatModel,
      AI_AGENT_MODEL: data.agentModel,
      AI_CLASSIFICATION_MODEL: data.classificationModel,
      AI_TIMEOUT_MS: String(data.timeout),
      AI_MAX_RETRIES: String(data.maxRetries),
    });
    const env = { ...current.env, ...changes };
    try {
      for (const role of ['text', 'image'] as const) {
        const config = getAiConfig(role, env);
        if (!config.baseURL || !config.model)
          throw new Error('Missing configuration');
        const url = new URL(config.baseURL);
        if (url.search || url.hash) throw new Error('Invalid URL');
      }
    } catch {
      throw new BadRequestException(
        '请填写有效的 HTTP(S) 接口地址与模型名称，图片服务不能选择 DeepSeek。'
      );
    }
    return { ...current, changes, env };
  }

  save(input: unknown) {
    const { file, content, changes } = this.prepare(input);
    let updated = content;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    for (const [key, value] of Object.entries(changes)) {
      const pattern = new RegExp(
        `^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`,
        'gm'
      );
      const line = `${key}='${value}'`;
      if (pattern.test(updated)) updated = updated.replace(pattern, () => line);
      else updated = updated.replace(/\s*$/, '') + eol + line + eol;
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, updated, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch {
      throw new ServiceUnavailableException(
        '保存失败，请检查 .env 的写入权限。'
      );
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    // Do not partially hot-reload the backend while workers retain old values.
    return this.get();
  }

  async test(input: unknown, role: 'text' | 'image') {
    const { env } = this.prepare(input);
    const config = getAiConfig(role, env);
    if (!config.apiKey) throw new BadRequestException('请先填写 API Key。');
    const models = new AiModelService(env);
    try {
      if (role === 'image') {
        // Avoid generating and charging for an image during a connectivity check.
        await models
          .client('image')
          .models.list({ timeout: 15000, maxRetries: 0 });
        return {
          ok: true,
          message: '图片服务连接成功；此测试未生成图片，不能保证图片模型可用。',
        };
      }
      await models.complete(
        {
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 64,
        },
        { timeout: 20000, maxRetries: 0 }
      );
      return { ok: true, message: '文字模型连接成功。此测试不包含工具调用。' };
    } catch (error) {
      const status =
        typeof error === 'object' && error && 'status' in error
          ? Number(error.status)
          : undefined;
      return {
        ok: false,
        message: status
          ? `连接失败（HTTP ${status}），请检查密钥、模型权限和中转站状态。`
          : '连接失败或请求超时，请检查接口地址和网络。',
      };
    }
  }
}
