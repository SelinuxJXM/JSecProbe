/**
 * 外链 URL 校验的**唯一入口**。
 *
 * 与 electron/services/ai-url.ts 的职责边界（刻意分开，不要合并）：
 *  - ai-url.ts 的 ensureApiUrl() 拦内网/云元数据地址，因为那是服务端发起的请求（SSRF）；
 *  - 本文件**不拦内网**，因为现场测评人员最常加的外链恰恰是客户内网的漏扫平台、
 *    堡垒机、OA（http://192.168.x.x）。外链由用户主动点击、交给系统浏览器打开，
 *    不是服务端请求，套用 SSRF 黑名单会把正常业务直接废掉。
 *
 * 这里防的是另一类问题：让 shell.openExternal 收到非 http(s) scheme、userinfo 钓鱼写法、
 * 或借空白/反斜杠让「看起来像 A 域名、实际解析成 B」的歧义地址。
 * 系统浏览器仍是最外层防线，本函数负责把输入规范化成唯一确定的 URL。
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** 无协议时补全为 http://（内网系统大量是 http，默认 https 反而打不开） */
function withProtocol(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
}

/**
 * 校验并规范化外链地址。失败时抛出带中文原因的 Error（wrap 会转成 IpcResponse.error）。
 * 返回 URL.toString() 的结果，调用方应只使用该返回值，不要再用原始字符串。
 */
export function normalizeExternalUrl(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('链接不能为空');
  }
  const trimmed = raw.trim();

  // 空白/反斜杠/控制字符一律拒绝：Windows 下 `https:\evil.com` 等写法在不同层
  // 可能被解释成本地路径，宁可要求用户填标准 URL。
  if (/[\\\s\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('链接包含空格、反斜杠或控制字符，请填写标准 URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(withProtocol(trimmed));
  } catch {
    throw new Error('链接格式不正确，请填写完整的 http/https 地址');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('只允许打开 http/https 链接');
  }
  // https://trusted.com@evil.com —— 显示的域名和实际打开的主机不一致
  if (parsed.username || parsed.password) {
    throw new Error('链接不允许内嵌用户名或密码');
  }
  if (!parsed.hostname) {
    throw new Error('链接缺少主机名');
  }

  return parsed.toString();
}

/** 仅取主机名，用于日志与内网判定；不做任何网络请求 */
export function externalUrlHost(raw: string): string {
  try {
    return new URL(withProtocol(raw.trim())).hostname;
  } catch {
    return '';
  }
}

