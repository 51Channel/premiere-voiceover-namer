// 读 WAV：时长和波形缩略图（给录音列表画波形用）。支持 16/24/32 位整数和 32 位浮点 PCM。
(function (root, factory) {
  if (typeof window !== 'undefined' && window.document) root.VNWave = factory();
  else module.exports = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function tag(dv, at) {
    return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
  }

  // 从文件开头一段字节里找 fmt 和 data 块
  function parseHeader(bytes) {
    var dv = view(bytes);
    if (bytes.byteLength < 12 || tag(dv, 0) !== 'RIFF' || tag(dv, 8) !== 'WAVE') return null;
    var at = 12;
    var fmt = null;
    while (at + 8 <= bytes.byteLength) {
      var id = tag(dv, at);
      var size = dv.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 24 <= bytes.byteLength) {
        var format = dv.getUint16(at + 8, true);
        if (format === 0xfffe && size >= 26 && at + 34 <= bytes.byteLength) format = dv.getUint16(at + 32, true);
        fmt = {
          format: format,
          channels: dv.getUint16(at + 10, true),
          sampleRate: dv.getUint32(at + 12, true),
          blockAlign: dv.getUint16(at + 20, true),
          bits: dv.getUint16(at + 22, true)
        };
      } else if (id === 'data') {
        if (!fmt) return null;
        return { fmt: fmt, dataOffset: at + 8, dataSize: size };
      }
      at += 8 + size + (size & 1);
    }
    return null;
  }

  function sampleReader(fmt) {
    var b = fmt.bits;
    if (fmt.format === 3 && b === 32) return function (dv, at) { return dv.getFloat32(at, true); };
    if (b === 16) return function (dv, at) { return dv.getInt16(at, true) / 32768; };
    if (b === 24) return function (dv, at) {
      var v = dv.getUint8(at) | (dv.getUint8(at + 1) << 8) | (dv.getInt8(at + 2) << 16);
      return v / 8388608;
    };
    if (b === 32) return function (dv, at) { return dv.getInt32(at, true) / 2147483648; };
    if (b === 8) return function (dv, at) { return (dv.getUint8(at) - 128) / 128; };
    return null;
  }

  // 把一段 PCM 切成 count 份，每份取最大振幅（只看第一个声道，跳着取样，够画缩略图）
  function peaks(pcm, fmt, count) {
    var read = sampleReader(fmt);
    var out = new Array(count);
    for (var z = 0; z < count; z++) out[z] = 0;
    if (!read || !fmt.blockAlign) return out;
    var dv = view(pcm);
    var frames = Math.floor(pcm.byteLength / fmt.blockAlign);
    if (!frames) return out;
    var per = frames / count;
    var step = Math.max(1, Math.floor(per / 64));
    for (var i = 0; i < count; i++) {
      var start = Math.floor(i * per);
      var end = Math.min(frames, Math.floor((i + 1) * per));
      var max = 0;
      for (var f = start; f < end; f += step) {
        var v = Math.abs(read(dv, f * fmt.blockAlign));
        if (v > max) max = v;
      }
      out[i] = Math.min(1, max);
    }
    return out;
  }

  function duration(header) {
    var f = header.fmt;
    return f.sampleRate && f.blockAlign ? header.dataSize / f.blockAlign / f.sampleRate : 0;
  }

  // Node 里读文件：小文件整段读，大文件均匀抽 count 段，每段 64KB
  function readInfo(fs, filePath, count) {
    count = count || 96;
    var fd = fs.openSync(filePath, 'r');
    try {
      var size = fs.fstatSync(fd).size;
      var headBuf = new Uint8Array(Math.min(size, 65536));
      fs.readSync(fd, headBuf, 0, headBuf.length, 0);
      var header = parseHeader(headBuf);
      if (!header) return null;
      var dataSize = Math.min(header.dataSize, size - header.dataOffset);
      header.dataSize = dataSize;
      var result = { duration: duration(header), peaks: null, channels: header.fmt.channels };
      var block = header.fmt.blockAlign || 1;
      if (dataSize <= 48 * 1024 * 1024) {
        var all = new Uint8Array(dataSize - (dataSize % block));
        fs.readSync(fd, all, 0, all.length, header.dataOffset);
        result.peaks = peaks(all, header.fmt, count);
      } else {
        var chunk = 65536 - (65536 % block);
        var buf = new Uint8Array(chunk);
        var list = [];
        for (var i = 0; i < count; i++) {
          var pos = header.dataOffset + Math.floor((dataSize - chunk) * i / Math.max(1, count - 1));
          pos -= (pos - header.dataOffset) % block;
          fs.readSync(fd, buf, 0, chunk, pos);
          list.push(peaks(buf, header.fmt, 1)[0]);
        }
        result.peaks = list;
      }
      return result;
    } finally {
      fs.closeSync(fd);
    }
  }

  return { parseHeader: parseHeader, peaks: peaks, duration: duration, readInfo: readInfo };
});
