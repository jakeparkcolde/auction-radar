// tsc 는 .sql 을 복사하지 않으므로, 빌드 후 마이그레이션 .sql 을 dist 로 복사한다.
// (dist 런타임에서 마이그레이션 러너가 파일을 읽을 수 있도록 보장)
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src', 'migrations');
const outDir = join(here, '..', 'dist', 'migrations');

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(srcDir)) {
  if (file.endsWith('.sql')) {
    cpSync(join(srcDir, file), join(outDir, file));
  }
}

if (!existsSync(outDir)) {
  process.exit(1);
}
