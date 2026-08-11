import session from 'express-session';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class FileSessionStore extends session.Store {
  constructor({ dir = path.resolve('data/sessions'), reapIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.dir = dir;
    this.ready = fs.mkdir(dir, { recursive: true });
    this.timer = setInterval(() => this.reap().catch(() => {}), reapIntervalMs);
    this.timer.unref?.();
  }

  filename(sid) {
    return path.join(this.dir, crypto.createHash('sha256').update(String(sid)).digest('hex') + '.json');
  }

  async read(sid) {
    await this.ready;
    const file = this.filename(sid);
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.expiresAt && value.expiresAt <= Date.now()) {
      await fs.rm(file, { force: true });
      return null;
    }
    return value.session;
  }

  get(sid, callback) {
    this.read(sid).then((value) => callback(null, value)).catch((error) => {
      if (error.code === 'ENOENT') callback(null, null);
      else callback(error);
    });
  }

  set(sid, value, callback = () => {}) {
    this.ready.then(async () => {
      const file = this.filename(sid);
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      const expiresAt = value?.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + Number(value?.cookie?.maxAge || 8 * 60 * 60 * 1000);
      await fs.writeFile(temporary, JSON.stringify({ expiresAt, session: value }), { mode: 0o600 });
      await fs.rename(temporary, file);
    }).then(() => callback()).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.ready.then(() => fs.rm(this.filename(sid), { force: true })).then(() => callback()).catch(callback);
  }

  touch(sid, value, callback = () => {}) {
    this.set(sid, value, callback);
  }

  async reap() {
    await this.ready;
    const now = Date.now();
    for (const entry of await fs.readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(this.dir, entry.name);
      try {
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (value.expiresAt && value.expiresAt <= now) await fs.rm(file, { force: true });
      } catch { await fs.rm(file, { force: true }); }
    }
  }
}

export default FileSessionStore;
