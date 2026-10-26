#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
火种计划 · 取种器（AI / 命令行用）
下载 assets/seed.bin 并用密码解密成 zip（或直接解压）

用法：
  python3 tools/fetch_seed.py <site-url> <password> [-o fire-seed.zip]
  python3 tools/fetch_seed.py <site-url> <password> --extract ./restored
  python3 tools/fetch_seed.py file:///sdcard/.../assets/seed.bin <password> --extract ./restored

格式： 'FSD1'(4) | iter(u32 BE) | salt(16) | iv(12) | ciphertext||tag
"""
import argparse
import io
import os
import sys
import urllib.request
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

MAGIC = b'FSD1'


def fetch(url):
    if url.startswith('file://'):
        return open(url[7:], 'rb').read()
    req = urllib.request.Request(url, headers={'User-Agent': 'fire-seed/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def decrypt(blob, password):
    if blob[:4] != MAGIC:
        raise ValueError('不是 FSD1 密文（magic 不匹配）')
    it = int.from_bytes(blob[4:8], 'big')
    salt = blob[8:24]
    iv = blob[24:36]
    ct = blob[36:]
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=it)
    key = kdf.derive(password.encode('utf-8'))
    try:
        return AESGCM(key).decrypt(iv, ct, MAGIC)
    except Exception:
        raise ValueError('解密失败：密码错误或密文损坏')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('url', help='站点地址、seed.bin 直链或 file:// 路径')
    ap.add_argument('password')
    ap.add_argument('-o', '--out', default='fire-seed.zip')
    ap.add_argument('--extract', default=None, help='解密后直接解压到该目录')
    args = ap.parse_args()

    url = args.url
    if url.rstrip('/').startswith('http') and not url.endswith('.bin'):
        url = url.rstrip('/') + '/assets/seed.bin'

    print(f'下载: {url}')
    blob = fetch(url)
    print(f'  密文 {len(blob):,} bytes')
    plain = decrypt(blob, args.password)
    print(f'  解密成功，zip {len(plain):,} bytes')

    if args.extract:
        os.makedirs(args.extract, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(plain)) as z:
            z.extractall(args.extract)
            names = z.namelist()
        print(f'  已解压 {len(names)} 个文件 -> {args.extract}')
        for n in names:
            print(f'    {n}')
    else:
        open(args.out, 'wb').write(plain)
        print(f'  已保存 -> {args.out}')


if __name__ == '__main__':
    main()