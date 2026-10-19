// Local-only management client. Never import from app/ or expose this token.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export const projectRef = 'faekdclvcieuksoxsrtw';
const settingsFile = new URL('../.env.management', import.meta.url);
const endpoints = new Set(['/database/query', '/database/query/read-only', '/database/migrations', '/advisors/security', '/advisors/performance']);

export async function managementRequest(path, options = {}) {
  if (!endpoints.has(path)) throw new Error('Unsupported management endpoint.');
  const settings = parseEnv(await readFile(settingsFile, 'utf8'));
  if (settings.TRIPBOOGIE_SUPABASE_PROJECT_REF !== projectRef)
    throw new Error('TripBoogie 대상 프로젝트가 아닙니다. 요청을 중단했습니다.');
  const token = settings.TRIPBOOGIE_SUPABASE_MANAGEMENT_TOKEN?.trim();
  if (!token || !/^[\x21-\x7e]+$/.test(token)) throw new Error('.env.management의 관리 토큰을 확인하세요.');
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  } catch {
    throw new Error('Supabase 관리 요청의 결과를 확인하지 못했습니다. 쓰기 요청은 이력을 확인한 뒤 재시도하세요.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = response.status !== 401 && response.status !== 403 && typeof body?.message === 'string'
      ? `: ${body.message.replaceAll(token, '[redacted]').slice(0, 1000)}` : '';
    throw new Error(`Supabase 관리 요청 실패 (HTTP ${response.status})${detail}`);
  }
  return body;
}

export function querySql(query, { readOnly = false, parameters } = {}) {
  return managementRequest(readOnly ? '/database/query/read-only' : '/database/query', {
    method: 'POST',
    body: JSON.stringify({ query, ...(parameters ? { parameters } : {}), ...(!readOnly ? { read_only: false } : {}) }),
  });
}
