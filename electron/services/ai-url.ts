import log from 'electron-log';

/**
 * AI 请求地址构造 —— 全项目唯一入口。
 *
 * 为什么单独成模块：`ensureApiUrl` 原先只存在于 ai.ipc.ts，而 report.service.ts 另写了一套拼接
 * （只补 `chat/completions`、不补版本段）。由于保存配置时会把用户填的 `/v1` 剥掉，
 * 报告生成实际请求的是 `${host}/chat/completions` —— 一个不存在的端点。
 * 两边规则不一致正是这类「已配置但请求失败」的根源，故统一收口，任何地方都不再各自手拼 URL。
 */

/**
 * SSRF 防护：判定 hostname 是否属于禁止访问的地址。
 *
 * 说明边界：仅能拦截**字面量 IP 与已知内网域名后缀**。域名解析到内网地址的情况
 * （如 ai.internal.corp → 10.0.0.5）在发起请求前无法静态判定，不在本函数覆盖范围内。
 *
 * 内网部署场景（自建大模型服务）可通过环境变量 `JSECPROBE_ALLOW_PRIVATE_API=1` 显式豁免，
 * 豁免会在日志中留痕。
 */
const AI_ALLOW_PRIVATE_API = process.env.JSECPROBE_ALLOW_PRIVATE_API === '1';

/** 把 IPv4 字面量转成的整数，便于做网段包含判断；非 IPv4 返回 null */
function ipv4ToInt(hostname: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some(o => o > 255)) return null;
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

function isBlockedIp(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, ''); // IPv6 字面量去方括号
  if (!host) return false;

  // 云元数据端点（AWS/GCP/Azure/阿里云等）
  if (host === '169.254.169.254' || host === '169.254.170.2' || host === '100.100.100.200') return true;
  // 本机与内网常见域名
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') return true;

  // IPv6 回环 / 唯一本地 / 链路本地
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;

  const ip = ipv4ToInt(host);
  if (ip !== null) {
    const inRange = (base: number, bits: number) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
    };
    // 0.0.0.0/8（本网络）
    if (inRange(0x00000000, 8)) return true;
    // 127.0.0.0/8（回环）
    if (inRange(0x7f000000, 8)) return true;
    // 10.0.0.0/8（私有 A 类）
    if (inRange(0x0a000000, 8)) return true;
    // 172.16.0.0/12（私有 B 类）
    if (inRange(0xac100000, 12)) return true;
    // 192.168.0.0/16（私有 C 类）
    if (inRange(0xc0a80000, 16)) return true;
    // 169.254.0.0/16（链路本地 / 元数据）
    if (inRange(0xa9fe0000, 16)) return true;
    // 192.0.0.0/24（IETF 协议分配，含 192.0.0.170 NAT64）
    if (inRange(0xc0000000, 24)) return true;
    // 198.18.0.0/15（网络设备基准测试，常被用于探测）
    if (inRange(0xc6120000, 15)) return true;
    // 100.64.0.0/10（运营商级 NAT）
    if (inRange(0x64400000, 10)) return true;
  }

  return false;
}

/**
 * 把用户填写的 API 基础地址补全为完整的对话端点（`.../chat/completions`）。
 *
 * 幂等：已以 /chat/completions 结尾、或已含版本段（/v1、/v4 等）时不会重复拼接。
 * mode !== 'local' 时额外做 SSRF 黑名单校验（本地引擎常部署在内网，故跳过）。
 */
export function ensureApiUrl(baseUrl: string | null | undefined, mode?: string): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

  // 协议校验：仅允许 http/https，阻止 file://、ftp:// 等
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('API地址必须以 http:// 或 https:// 开头');
  }

  // 云端模式下校验 IP 黑名单，阻止 SSRF 探测云元数据/链路本地地址
  // 本地模式（Ollama）不校验，因为用户可能在任意内网地址部署 Ollama
  if (mode !== 'local') {
    let hostname = '';
    try {
      hostname = new URL(raw).hostname;
    } catch {
      throw new Error('API地址格式无效');
    }
    if (isBlockedIp(hostname)) {
      if (AI_ALLOW_PRIVATE_API) {
        // 内网部署场景的显式豁免：记录留痕，便于事后审计
        log.warn(`[SSRF] 已按 JSECPROBE_ALLOW_PRIVATE_API=1 放行内网地址: ${hostname}`);
      } else {
        throw new Error(
          `API地址被禁止访问: ${hostname}。` +
          `云端模型不允许指向内网/回环/链路本地地址（内网部署的自建服务请设置环境变量 JSECPROBE_ALLOW_PRIVATE_API=1 显式放行）`
        );
      }
    }
  }

  const queryIndex = raw.indexOf('?');
  const base = queryIndex >= 0 ? raw.substring(0, queryIndex) : raw;

  if (base.endsWith('/chat/completions')) {
    return raw;
  }
  // 匹配任意版本段（/v1、/v4 等），如 /openai/v4 → /openai/v4/chat/completions
  if (/\/v\d+(\/|$)/.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}
