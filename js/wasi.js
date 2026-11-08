// Just enough of WASI (preview 1) to run Super Over's WebAssembly in a browser: a clock, random
// numbers and a console. Anything else answers "not supported".
export function wasiImports(memory) {
  const ENOSYS = 52;
  const EBADF = 8;
  const decoder = new TextDecoder();
  const lines = ['', '', ''];
  const view = () => new DataView(memory().buffer);
  const impl = {
    args_sizes_get(argc, size) {
      const v = view();
      v.setUint32(argc, 0, true);
      v.setUint32(size, 0, true);
      return 0;
    },
    args_get() { return 0; },
    environ_sizes_get(count, size) {
      const v = view();
      v.setUint32(count, 0, true);
      v.setUint32(size, 0, true);
      return 0;
    },
    environ_get() { return 0; },
    clock_res_get(id, out) {
      view().setBigUint64(out, 1000n, true);
      return 0;
    },
    clock_time_get(id, precision, out) {
      const ms = id === 0 ? Date.now() : performance.now();
      view().setBigUint64(out, BigInt(Math.round(ms * 1e6)), true);
      return 0;
    },
    random_get(pointer, length) {
      const bytes = new Uint8Array(memory().buffer, pointer, length);
      for (let i = 0; i < length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(length, i + 65536)));
      return 0;
    },
    fd_write(fd, iovs, count, written) {
      const v = view();
      let total = 0;
      for (let i = 0; i < count; i++) {
        const pointer = v.getUint32(iovs + i * 8, true);
        const length = v.getUint32(iovs + i * 8 + 4, true);
        const text = decoder.decode(new Uint8Array(memory().buffer, pointer, length));
        total += length;
        if (fd === 1 || fd === 2) {
          const parts = (lines[fd] + text).split('\n');
          lines[fd] = parts.pop();
          for (const line of parts) (fd === 2 ? console.warn : console.log)(line);
        }
      }
      v.setUint32(written, total, true);
      return 0;
    },
    fd_close() { return 0; },
    fd_fdstat_get(fd, out) {
      if (fd > 2) return EBADF;
      const v = view();
      v.setUint8(out, 2);
      v.setUint16(out + 2, 0, true);
      v.setBigUint64(out + 8, 0n, true);
      v.setBigUint64(out + 16, 0n, true);
      return 0;
    },
    fd_prestat_get() { return EBADF; },
    fd_prestat_dir_name() { return EBADF; },
    proc_exit(code) { throw new Error(`Super Over exited (${code})`); },
  };
  return new Proxy(impl, { get: (target, name) => target[name] ?? (() => ENOSYS) });
}
