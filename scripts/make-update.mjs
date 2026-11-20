// 生成自动更新清单 update.json：版本号、对应的提交、插件每个文件的 SHA-256。
// GitHub 测试全过以后由 .github/workflows/test.yml 调用：node scripts/make-update.mjs <提交号> > update.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension', 'com.hechao.voiceover-namer');
const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('要传完整的提交号');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (name !== '.DS_Store') {
      const data = fs.readFileSync(full);
      files.push({ path: path.relative(ext, full).split(path.sep).join('/'), size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    }
  }
})(ext);

process.stdout.write(JSON.stringify({ version, commit, files }, null, 2) + '\n');
