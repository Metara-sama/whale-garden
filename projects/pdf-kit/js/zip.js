/* ============================================================
   zip.js —— 极简 ZIP 打包（store 模式，不压缩）
   PDF 本身就是压缩过的，再 deflate 一遍纯属浪费 CPU；
   这里只做「把多份文件装进一个包」，够用且零依赖。
   ============================================================ */
(function (global) {
  'use strict';

  /* CRC32 查表 */
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) {
      c = TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
      date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  /**
   * files: [{ name: 'a.pdf', data: Uint8Array }]
   * return Blob(application/zip)
   */
  function store(files) {
    var enc = new TextEncoder();
    var stamp = dosTime(new Date());
    var parts = [];     // 顺序拼接的本地文件数据
    var central = [];   // 中心目录
    var offset = 0;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);

      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // 本地文件头签名
      lh.setUint16(4, 20, true);           // 解压所需版本
      lh.setUint16(6, 0x0800, true);       // 标志位：文件名 UTF-8
      lh.setUint16(8, 0, true);            // 压缩方式 0 = store
      lh.setUint16(10, stamp.time, true);
      lh.setUint16(12, stamp.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); // 压缩后大小
      lh.setUint32(22, data.length, true); // 原始大小
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);

      parts.push(new Uint8Array(lh.buffer), name, data);

      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);   // 中心目录签名
      cd.setUint16(4, 20, true);           // 创建版本
      cd.setUint16(6, 20, true);           // 解压所需版本
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, stamp.time, true);
      cd.setUint16(14, stamp.date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);           // extra
      cd.setUint16(32, 0, true);           // comment
      cd.setUint16(34, 0, true);           // 起始磁盘号
      cd.setUint16(36, 0, true);           // 内部属性
      cd.setUint32(38, 0, true);           // 外部属性
      cd.setUint32(42, offset, true);      // 本地头偏移
      central.push(new Uint8Array(cd.buffer), name);

      offset += 30 + name.length + data.length;
    }

    var cdSize = 0;
    for (var j = 0; j < central.length; j++) cdSize += central[j].length;

    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);   // 目录结束签名
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [new Uint8Array(eocd.buffer)]), { type: 'application/zip' });
  }

  global.WhaleZip = { store: store, crc32: crc32 };
})(window);
