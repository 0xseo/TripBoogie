import { readFile, realpath, rename, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { projectRef, managementRequest } from './supabase-management.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const file = await realpath(resolve(root, process.argv[2] ?? ''));
  const migrations = await realpath(join(root, 'supabase/migrations'));
  if (dirname(file) !== migrations || !/^\d{14}_[a-z0-9_]+\.sql$/.test(basename(file)))
    throw new Error('프로젝트의 Supabase 마이그레이션 파일을 선택하세요.');
  const query = await readFile(file, 'utf8');
  const name = basename(file).replace(/^\d{14}_/, '').replace(/\.sql$/, '');
  const previous = await managementRequest('/database/migrations');
  if (!Array.isArray(previous)) throw new Error('마이그레이션 이력 응답을 확인하세요.');
  if (previous.some((row) => row.name === name)) throw new Error('같은 이름의 마이그레이션이 이미 적용됐습니다. 재적용하지 않았습니다.');
  await managementRequest('/database/migrations', { method: 'POST', body: JSON.stringify({ name, query }) });
  const history = await managementRequest('/database/migrations');
  const matches = history.filter((row) => row.name === name);
  if (matches.length !== 1 || !/^\d{14}$/.test(String(matches[0].version)))
    throw new Error('서버 적용 결과를 이력에서 확인하지 못했습니다. 재시도 전에 DB를 확인하세요.');
  const version = String(matches[0].version);
  const aligned = join(migrations, `${version}_${name}.sql`);
  if (aligned !== file) await rename(file, aligned);
  const log = { projectRef, version, name, sha256: createHash('sha256').update(query).digest('hex'), appliedAt: new Date().toISOString() };
  const logDir = join(root, '.sites-runtime/migrations');
  await mkdir(logDir, { recursive: true });
  await writeFile(join(logDir, `${version}.json`), JSON.stringify(log, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ...log, file: aligned }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : '마이그레이션 적용 결과를 확인하지 못했습니다.');
  process.exitCode = 1;
}
