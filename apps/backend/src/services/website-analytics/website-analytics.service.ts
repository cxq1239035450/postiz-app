import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import type { WebsiteConnection } from '@prisma/client';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://www.googleapis.com/webmasters/v3';
type Credentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
type Site = { siteUrl: string; permissionLevel: string };
type Metrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
type Row = Metrics & { keys: string[] };
type GoogleResult = { rows?: Row[] };

@Injectable()
export class WebsiteAnalyticsService {
  constructor(private readonly db: PrismaService) {}

  enabled() {
    return !!(
      process.env.SEARCH_CONSOLE_CLIENT_ID &&
      process.env.SEARCH_CONSOLE_CLIENT_SECRET &&
      /^[a-f\d]{64}$/i.test(process.env.SEARCH_CONSOLE_ENCRYPTION_KEY || '') &&
      process.env.FRONTEND_URL
    );
  }

  private config() {
    if (!this.enabled())
      throw new ServiceUnavailableException(
        '管理员尚未配置 Search Console 授权。'
      );
    return {
      client_id: process.env.SEARCH_CONSOLE_CLIENT_ID!,
      client_secret: process.env.SEARCH_CONSOLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.FRONTEND_URL!.replace(
        /\/$/,
        ''
      )}/website-analytics/connect`,
    };
  }

  private encrypt(value: unknown) {
    this.config();
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.SEARCH_CONSOLE_ENCRYPTION_KEY!, 'hex'),
      iv
    );
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString('base64'))
      .join('.');
  }

  private decrypt<T>(value: string): T {
    this.config();
    const [iv, tag, data] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.SEARCH_CONSOLE_ENCRYPTION_KEY!, 'hex'),
      iv
    );
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    );
  }

  private async session(
    organizationId: string,
    userId: string,
    kind: string,
    payload: unknown
  ) {
    await this.db.websiteAuthorization.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const id = randomBytes(32).toString('hex');
    await this.db.websiteAuthorization.create({
      data: {
        id,
        organizationId,
        userId,
        kind,
        payload: this.encrypt(payload),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    return id;
  }

  private async readSession(
    id: string,
    organizationId: string,
    userId: string,
    kind: string
  ) {
    if (!/^[a-f\d]{64}$/.test(id || ''))
      throw new BadRequestException('授权已失效，请重新连接。');
    const where = {
      id,
      organizationId,
      userId,
      kind,
      expiresAt: { gt: new Date() },
    };
    const row = await this.db.websiteAuthorization.findFirst({ where });
    if (!row)
      throw new BadRequestException('授权已失效或所属组织已切换，请重新连接。');
    return { row, where };
  }

  async authorize(
    organizationId: string,
    userId: string,
    reconnectId?: string
  ) {
    const config = this.config();
    if (reconnectId) await this.connection(organizationId, reconnectId);
    const verifier = randomBytes(32).toString('base64url');
    const state = await this.session(organizationId, userId, 'oauth', {
      verifier,
      reconnectId,
    });
    return {
      url:
        'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
          client_id: config.client_id,
          redirect_uri: config.redirect_uri,
          response_type: 'code',
          scope: SCOPE,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
          code_challenge_method: 'S256',
        }),
    };
  }

  private async token(params: Record<string, string>): Promise<Credentials> {
    const config = this.config();
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.client_id,
          client_secret: config.client_secret,
          ...params,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        '暂时无法连接 Google，请稍后重试。'
      );
    }
    const data = await response.json();
    if (!response.ok) {
      if (data.error === 'invalid_grant')
        throw new HttpException('Google 授权已失效，请重新连接。', 409);
      throw new ServiceUnavailableException(
        'Google 授权交换失败，请检查应用配置或稍后重试。'
      );
    }
    if (
      !data.access_token ||
      (data.scope && !data.scope.split(' ').includes(SCOPE))
    ) {
      throw new BadRequestException(
        '未授予 Search Console 只读权限，请重新授权。'
      );
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
  }

  private async google<T>(
    path: string,
    accessToken: string,
    body?: unknown
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Google 数据暂时不可用，请稍后重试。'
      );
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const reasons = (error.error?.errors || []).map(
        (item: { reason: string }) => item.reason
      );
      if (
        response.status === 429 ||
        reasons.some((reason: string) =>
          /quota|rateLimit|userRateLimit/i.test(reason)
        )
      ) {
        throw new HttpException('Google 查询额度暂时用尽，请稍后重试。', 429);
      }
      if (response.status === 401)
        throw new HttpException('Google 授权已失效，请重新连接。', 409);
      if (response.status === 403)
        throw new HttpException(
          '无法读取网站：请检查账号的网站权限及 Search Console API 是否已启用。',
          403
        );
      throw new ServiceUnavailableException(
        'Search Console 查询失败，请稍后重试。'
      );
    }
    return response.json();
  }

  private async sites(credentials: Credentials) {
    const result = await this.google<{ siteEntry?: Site[] }>(
      '/sites',
      credentials.accessToken
    );
    return (result.siteEntry || []).filter((site) =>
      ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(
        site.permissionLevel
      )
    );
  }

  async callback(
    organizationId: string,
    userId: string,
    state: string,
    code?: string,
    error?: string
  ) {
    const { row, where } = await this.readSession(
      state,
      organizationId,
      userId,
      'oauth'
    );
    // Atomic consumption prevents concurrent callback replay across processes.
    if (!(await this.db.websiteAuthorization.deleteMany({ where })).count)
      throw new BadRequestException('授权已使用，请重新连接。');
    if (error || !code)
      throw new BadRequestException('Google 授权已取消，请重新连接。');
    const { verifier, reconnectId } = this.decrypt<{
      verifier: string;
      reconnectId?: string;
    }>(row.payload);
    const credentials = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config().redirect_uri,
      code_verifier: verifier,
    });
    if (!credentials.refreshToken)
      throw new BadRequestException(
        '未获得离线访问权限，请重新连接并同意授权。'
      );
    const sites = await this.sites(credentials);
    if (reconnectId) {
      const connection = await this.connection(organizationId, reconnectId);
      if (!sites.some((site) => site.siteUrl === connection.siteUrl))
        throw new BadRequestException(
          '该 Google 账号无权访问原网站，请选择正确账号。'
        );
      await this.db.websiteConnection.updateMany({
        where: { id: reconnectId, organizationId },
        data: {
          credentials: this.encrypt(credentials),
          reconnectRequired: false,
        },
      });
      return { reconnected: true };
    }
    const ticket = await this.session(
      organizationId,
      userId,
      'selection',
      credentials
    );
    return { ticket, sites };
  }

  async bind(
    organizationId: string,
    userId: string,
    ticket: string,
    siteUrls: string[]
  ) {
    if (
      !Array.isArray(siteUrls) ||
      !siteUrls.length ||
      siteUrls.length > 100 ||
      siteUrls.some((url) => typeof url !== 'string')
    ) {
      throw new BadRequestException('请选择 1 至 100 个网站。');
    }
    const { row, where } = await this.readSession(
      ticket,
      organizationId,
      userId,
      'selection'
    );
    const credentials = this.decrypt<Credentials>(row.payload);
    const sites = await this.sites(credentials);
    const urls = [...new Set(siteUrls)];
    if (urls.some((url) => !sites.some((site) => site.siteUrl === url)))
      throw new BadRequestException('所选网站不在授权资源列表中。');
    return this.db.$transaction(async (tx) => {
      if (!(await tx.websiteAuthorization.deleteMany({ where })).count)
        throw new BadRequestException('绑定已提交，请刷新网站列表。');
      for (const siteUrl of urls) {
        await tx.websiteConnection.upsert({
          where: { organizationId_siteUrl: { organizationId, siteUrl } },
          create: { organizationId, siteUrl, credentials: row.payload },
          update: { credentials: row.payload, reconnectRequired: false },
        });
      }
      return { count: urls.length };
    });
  }

  async list(organizationId: string) {
    return {
      enabled: this.enabled(),
      websites: await this.db.websiteConnection.findMany({
        where: { organizationId },
        select: { id: true, siteUrl: true, reconnectRequired: true },
        orderBy: { createdAt: 'asc' },
      }),
    };
  }

  private async connection(organizationId: string, id: string) {
    const connection = await this.db.websiteConnection.findFirst({
      where: { id, organizationId },
    });
    if (!connection) throw new NotFoundException('网站未绑定或已解除绑定。');
    return connection;
  }

  async disconnect(organizationId: string, id: string) {
    await this.db.websiteConnection.deleteMany({
      where: { id, organizationId },
    });
    return { success: true };
  }

  private async access(connection: WebsiteConnection, force = false) {
    const credentials = this.decrypt<Credentials>(connection.credentials);
    if (!force && credentials.expiresAt > Date.now() + 60_000)
      return credentials.accessToken;
    try {
      const refreshed = await this.token({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
      });
      refreshed.refreshToken ||= credentials.refreshToken;
      await this.db.websiteConnection.updateMany({
        where: { id: connection.id, credentials: connection.credentials },
        data: {
          credentials: this.encrypt(refreshed),
          reconnectRequired: false,
        },
      });
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        await this.db.websiteConnection.updateMany({
          where: { id: connection.id, credentials: connection.credentials },
          data: { reconnectRequired: true },
        });
      }
      throw error;
    }
  }

  async report(
    organizationId: string,
    id: string,
    startDate: string,
    endDate: string,
    dimension = 'query',
    page = 0
  ) {
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
      !isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (
      !validDate(startDate) ||
      !validDate(endDate) ||
      startDate > endDate ||
      Date.parse(endDate) - Date.parse(startDate) > 486 * 86400_000 ||
      !['query', 'page', 'country', 'device'].includes(dimension) ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 999
    ) {
      throw new BadRequestException('日期范围或分页参数无效（最多 487 天）。');
    }
    const connection = await this.connection(organizationId, id);
    if (connection.reconnectRequired)
      throw new HttpException('Google 授权已失效，请重新连接。', 409);
    const cacheKey = `website-analytics:${organizationId}:${id}:${connection.updatedAt.getTime()}:${startDate}:${endDate}:${dimension}:${page}`;
    const cached = await ioRedis.get(cacheKey).catch(() => null);
    if (cached) {
      const result = JSON.parse(cached);
      if (Date.now() - Date.parse(result.updatedAt) < 3600_000) return result;
    }
    let accessToken = await this.access(connection);
    const query = async (extra: object): Promise<GoogleResult> => {
      const path = `/sites/${encodeURIComponent(
        connection.siteUrl
      )}/searchAnalytics/query`;
      const body = {
        startDate,
        endDate,
        type: 'web',
        dataState: 'final',
        ...extra,
      };
      try {
        return await this.google<GoogleResult>(path, accessToken, body);
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 409)
          throw error;
        accessToken = await this.access(connection, true);
        return this.google<GoogleResult>(path, accessToken, body);
      }
    };
    // Totals are queried without dimensions: top rows cannot be summed reliably.
    const totals = await query({});
    const [trend, details] = await Promise.all([
      query({ dimensions: ['date'], rowLimit: 500 }),
      query({ dimensions: [dimension], rowLimit: 51, startRow: page * 50 }),
    ]);
    const result = {
      startDate,
      endDate,
      timezone: 'America/Los_Angeles',
      type: 'web',
      dataState: 'final',
      updatedAt: new Date().toISOString(),
      totals: totals.rows?.[0] || null,
      trend: trend.rows || [],
      rows: (details.rows || []).slice(0, 50),
      hasNext: (details.rows || []).length > 50,
      dimension,
      page,
    };
    await ioRedis
      .set(cacheKey, JSON.stringify(result), 'EX', 3600)
      .catch(() => undefined);
    return result;
  }
}
