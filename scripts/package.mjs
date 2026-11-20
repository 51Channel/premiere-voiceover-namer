// 打包给别人装：out/赫朝录音改名-<版本>.zip，解压后双击「安装-macOS.command」或「安装-Windows.bat」。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const manifest = fs.readFileSync(path.join(root, 'extension/com.hechao.voiceover-namer/CSXS/manifest.xml'), 'utf8');
if (!manifest.includes(`ExtensionBundleVersion="${version}"`)) throw new Error('manifest.xml 的版本和 package.json 对不上');

const out = path.join(root, 'out');
const stage = path.join(out, '赫朝录音改名');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, 'extension/com.hechao.voiceover-namer'), path.join(stage, 'com.hechao.voiceover-namer'), { recursive: true });
for (const f of ['安装-macOS.command', '安装-Windows.bat']) fs.copyFileSync(path.join(root, 'scripts', f), path.join(stage, f));
fs.chmodSync(path.join(stage, '安装-macOS.command'), 0o755);
fs.writeFileSync(path.join(stage, '使用说明.txt'), [
  '赫朝录音改名 ' + version,
  '',
  '1. 先退出 Premiere。',
  '2. Mac：右键「安装-macOS.command」→ 打开（第一次会问是否打开，点打开）。',
  '   Windows：双击「安装-Windows.bat」。',
  '3. 重新打开 Premiere。插件会在后台自动工作，不用打开面板。',
  '4. 想看录音列表、试听、起名：窗口 → 扩展 → 赫朝录音改名。',
  '',
  '用法：保存好工程，点时间线音轨头上的麦克风按钮录画外音，停下后 2 秒内自动改名。',
  '',
].join('\n'));
const zip = path.join(out, `赫朝录音改名-${version}.zip`);
fs.rmSync(zip, { force: true });
// 用 Python 打 zip：中文文件名会标成 UTF-8（系统自带的 zip 不标，Windows 解压会乱码），并保留安装脚本的可执行权限
execFileSync('python3', ['-c', `
import os, sys, zipfile
out, zp = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk(os.path.join(out, '赫朝录音改名')):
        dirs.sort()
        for f in sorted(files):
            if f == '.DS_Store':
                continue
            full = os.path.join(d, f)
            info = zipfile.ZipInfo.from_file(full, os.path.relpath(full, out))
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(full, 'rb') as fh:
                z.writestr(info, fh.read())
`, out, zip]);
console.log(zip);
