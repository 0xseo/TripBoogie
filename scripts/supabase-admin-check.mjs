import { projectRef, querySql } from './supabase-management.mjs';
try {
  const tables = await querySql("select schemaname, tablename, rowsecurity from pg_catalog.pg_tables where schemaname = 'public' order by tablename", { readOnly: true });
  console.log(JSON.stringify({ projectRef, connected: true, publicTables: tables }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : '관리 연결에 실패했습니다.');
  process.exitCode = 1;
}
