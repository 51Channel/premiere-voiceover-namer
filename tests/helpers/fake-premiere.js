// 假的 Premiere：在 Node 虚拟机里跑真正的 host.jsx，用来测面板和 PR 之间整条链路。
// 只模拟 host.jsx 用到的那部分对象（ProjectItem、素材箱、序列、音轨片段、File）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HOST = path.join(__dirname, '..', '..', 'extension', 'com.hechao.voiceover-namer', 'jsx', 'host.jsx');

function collection(list, countName) {
  const c = list;
  Object.defineProperty(c, countName || 'numItems', { get: () => list.length });
  return c;
}

let nextId = 1000;

function makeItem(name, mediaPath) {
  return {
    nodeId: String(nextId++),
    name,
    type: 1,
    _path: mediaPath,
    getMediaPath() { return this._path; },
    canChangeMediaPath() { return true; },
    changeMediaPath(p) { if (fs.existsSync(p)) this._path = p; return true; },
    isSequence() { return false; },
    select() { this._selected = true; },
  };
}

function makeBin(name) {
  return { nodeId: String(nextId++), name, type: 2, children: collection([]) };
}

function createPremiere(projectPath) {
  const root = { type: 3, children: collection([]) };
  const audioTracks = collection([{ clips: collection([]) }, { clips: collection([]) }], 'numTracks');
  const sequence = { name: '序列 01', sequenceID: 'seq-1', audioTracks };
  const sequences = collection([sequence], 'numSequences');
  const project = { path: projectPath, name: path.basename(projectPath), rootItem: root, activeSequence: sequence, sequences };
  const app = { project, version: '25.0.0' };
  class File { constructor(p) { this.p = p; } get exists() { return fs.existsSync(this.p); } }
  const ctx = vm.createContext({ app, File, ProjectItemType: { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 } });
  vm.runInContext(fs.readFileSync(HOST, 'utf8'), ctx, { filename: 'host.jsx' });
  return {
    app,
    root,
    sequence,
    evalScript(script, cb) {
      let out;
      try { out = vm.runInContext(script, ctx); } catch (e) { out = 'EvalScript error.'; }
      setImmediate(() => cb(out));
    },
    // 模拟一次原生画外音录制：素材进根素材箱，同时在 A1 上放一个片段
    record(name, mediaPath, bin) {
      const item = makeItem(name, mediaPath);
      (bin || root).children.push(item);
      audioTracks[0].clips.push({ name, projectItem: item });
      return item;
    },
    importFile(name, mediaPath, bin) {
      const item = makeItem(name, mediaPath);
      (bin || root).children.push(item);
      return item;
    },
    addBin(name) {
      const b = makeBin(name);
      root.children.push(b);
      return b;
    },
    clips() { return audioTracks[0].clips; },
  };
}

// 写一个 16 位单声道正弦波 WAV
function writeWav(file, seconds, rate) {
  rate = rate || 8000;
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const env = Math.sin(Math.PI * i / frames);
    data.writeInt16LE(Math.round(Math.sin(i / 8) * 20000 * env), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
  const past = new Date(Date.now() - 10000);
  fs.utimesSync(file, past, past);
}

module.exports = { createPremiere, writeWav };
