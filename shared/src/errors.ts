/** 把 NovelAI 的 HTTP 错误翻成中文：说明原因和改法 */
export function explainNaiError(status: number, message = '', correlationId?: string | null): string {
  const tail = correlationId ? `（请求编号 ${correlationId}）` : '';
  switch (status) {
    case 400: return `参数不被接受：${message || '请检查尺寸、步数等设置'}`;
    case 401: return 'Token 无效或已过期。请在设置里重新填写 Persistent API Token';
    case 402: return 'Anlas 不足，或当前订阅不支持这项操作。可以减少张数、步数或尺寸后再试';
    case 409: return `请求冲突：${message || '请稍后再试'}`;
    case 429: return '请求太频繁：同一账号同时只能生成一张，请等上一张完成后再试';
    case 500: case 502: case 503: case 504:
      return `NovelAI 服务器出错，可以稍后重试${tail}${message ? `：${message}` : ''}`;
    default: return `请求失败（${status}）${message ? `：${message}` : ''}${tail}`;
  }
}
