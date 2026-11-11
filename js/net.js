// Online matches: two browsers talk straight to each other over WebRTC. A PeerJS server only
// introduces them (the public one unless ?peer=host:port or localStorage 'superover.peer' names
// another); once they're connected the match never touches a server.
//
// Play a friend: the host waits under a four-letter code, the friend connects to it.
// Find a match: everyone meets at a few well-known waiting spots. The first to arrive waits in one;
// the next finds them there, and the two move to a connection of their own so the spot is free again.
import { Peer } from './vendor/peer.js';

/// Bump when what the two sides say to each other changes: only the same versions can play.
export const NET_VERSION = 1;
const PREFIX = `superover-v${NET_VERSION}-`;
const SPOTS = 5;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function peerOptions() {
  const custom = new URLSearchParams(location.search).get('peer') || localStorage.getItem('superover.peer');
  if (!custom) return { debug: 0 };
  const [host, port] = custom.split(':');
  const local = host === 'localhost' || host === '127.0.0.1';
  return { host, port: Number(port) || (local ? 9000 : 443), path: '/', secure: !local, debug: 0 };
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export function randomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return code;
}

/// A connection to one opponent. `on`: status(text, detail), open(role), message(object), close(reason).
export class Link {
  constructor(on) {
    this.on = on;
    this.peers = [];
    this.conn = null;
    this.role = null;
    this.closed = false;
    this.heard = 0;
    this.rtt = null;
    this.timer = null;
    this.attempts = new Map();
  }

  // MARK: Finding each other

  /// A peer of our own, connected to the introducing server.
  openPeer(id) {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      this.peers.push(peer);
      let settled = false;
      peer.on('open', () => {
        settled = true;
        resolve(peer);
      });
      peer.on('error', (error) => {
        if (error.type === 'peer-unavailable') {
          // Nobody under the id we tried to reach.
          const match = /peer (\S+)/.exec(error.message || '');
          const attempt = match && this.attempts.get(match[1]);
          if (attempt) attempt(null);
          return;
        }
        if (!settled) {
          settled = true;
          reject(error);
        } else if (!this.conn && !this.closed && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
          this.fail('Lost the connection. Check your internet and try again.');
        }
      });
    });
  }

  /// Connects `peer` to the peer called `id`. Resolves with the open connection, or null if nobody's there.
  reach(peer, id, timeout = 6000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (conn) => {
        if (done) return;
        done = true;
        this.attempts.delete(id);
        resolve(conn);
      };
      this.attempts.set(id, finish);
      const conn = peer.connect(id, { reliable: true, serialization: 'json' });
      conn.on('open', () => finish(conn));
      conn.on('error', () => finish(null));
      setTimeout(() => {
        if (!done) {
          try { conn.close(); } catch { /* never opened */ }
          finish(null);
        }
      }, timeout);
    });
  }

  /// Waits under a code for a friend to join.
  async host() {
    try {
      for (let attempt = 0; attempt < 6 && !this.closed; attempt++) {
        const code = randomCode();
        let peer;
        try {
          peer = await this.openPeer(`${PREFIX}room-${code}`);
        } catch (error) {
          if (error.type === 'unavailable-id') continue;
          throw error;
        }
        this.code = code;
        this.on.status('hosting', code);
        peer.on('connection', (conn) => {
          if (this.conn) {
            conn.on('open', () => conn.close());
            return;
          }
          this.adopt(conn, 'host');
        });
        return;
      }
      this.fail('Couldn\'t set up a match. Try again.');
    } catch (error) {
      this.fail(describe(error));
    }
  }

  /// Joins the friend waiting under `code`.
  async join(code) {
    try {
      this.on.status('joining', code);
      const peer = await this.openPeer();
      const conn = await this.reach(peer, `${PREFIX}room-${code.toUpperCase()}`, 12000);
      if (this.closed) return;
      if (!conn) return this.fail(`No match is waiting under ${code.toUpperCase()}. Check the code with your friend.`);
      this.adopt(conn, 'guest');
    } catch (error) {
      this.fail(describe(error));
    }
  }

  /// Finds anyone who's looking for a match, or waits to be found.
  async quick() {
    try {
      this.on.status('searching');
      const me = await this.openPeer();
      // Whoever was waiting sends us on to their own peer, and connects back through it.
      me.on('connection', (conn) => {
        if (this.conn) {
          conn.on('open', () => conn.close());
          return;
        }
        this.leaveSpot();
        this.adopt(conn, 'guest');
      });
      while (!this.closed && !this.conn) {
        for (let spot = 0; spot < SPOTS && !this.closed && !this.conn; spot++) {
          if (await this.takeSpot(me, spot)) return this.keepLooking(me, spot);
          if (await this.meetAt(me, spot)) return;
        }
        await wait(1200 + Math.random() * 800);
      }
    } catch (error) {
      this.fail(describe(error));
    }
  }

  /// Tries to be the one waiting at a spot.
  async takeSpot(me, spot) {
    let peer;
    try {
      peer = await this.openPeer(`${PREFIX}spot-${spot}`);
    } catch (error) {
      if (error.type === 'unavailable-id') return false;
      throw error;
    }
    if (this.closed || this.conn) {
      peer.destroy();
      return false;
    }
    this.spot = peer;
    peer.on('connection', (visitor) => {
      visitor.on('open', () => {
        // The first to find us gets our own address; anyone after is told to look elsewhere.
        const free = !this.conn && !this.promised && !this.closed;
        if (free) this.promised = true;
        try { visitor.send({ app: 'spot', free, at: free ? me.id : null }); } catch { /* gone already */ }
        if (free) {
          // If they never arrive, be findable again.
          setTimeout(() => {
            if (!this.conn) this.promised = false;
          }, 7000);
        }
      });
    });
    return true;
  }

  /// Asks whoever is waiting at a spot for their address, and connects to it.
  async meetAt(me, spot) {
    const visit = await this.reach(me, `${PREFIX}spot-${spot}`, 4000);
    if (!visit || this.closed || this.conn) return false;
    const answer = await new Promise((resolve) => {
      visit.on('data', resolve);
      setTimeout(() => resolve(null), 3000);
    });
    try { visit.close(); } catch { /* closed */ }
    if (!answer || !answer.free || !answer.at || this.conn) return false;
    const conn = await this.reach(me, answer.at, 8000);
    if (!conn || this.closed || this.conn) return false;
    this.leaveSpot();
    this.adopt(conn, 'host');
    return true;
  }

  /// Waiting at a spot other than the first: keep checking the ones before it, so two people
  /// waiting at different spots still find each other.
  async keepLooking(me, spot) {
    while (!this.closed && !this.conn) {
      await wait(3500 + Math.random() * 1500);
      for (let earlier = 0; earlier < spot && !this.closed && !this.conn && !this.promised; earlier++) {
        if (await this.meetAt(me, earlier)) return;
      }
    }
  }

  leaveSpot() {
    if (!this.spot) return;
    try { this.spot.destroy(); } catch { /* gone */ }
    this.spot = null;
  }

  // MARK: Connected

  adopt(conn, role) {
    if (this.conn || this.closed) return;
    this.conn = conn;
    this.role = role;
    const ready = () => {
      if (this.closed) return;
      this.heard = performance.now();
      this.on.status('connected');
      this.on.open(role);
      this.timer = setInterval(() => this.beat(), 2000);
    };
    conn.on('data', (data) => this.receive(data));
    conn.on('close', () => this.lost('left'));
    conn.on('error', () => this.lost('error'));
    if (conn.open) ready();
    else conn.on('open', ready);
  }

  receive(data) {
    this.heard = performance.now();
    if (!data || typeof data !== 'object') return;
    if (data.app === 'ping') return this.send({ app: 'pong', n: data.n });
    if (data.app === 'pong') {
      if (data.n === this.pingNumber) this.rtt = performance.now() - this.pingAt;
      return;
    }
    this.on.message(data);
  }

  beat() {
    if (!this.conn || this.closed) return;
    if (performance.now() - this.heard > 12000) return this.lost('timeout');
    this.pingNumber = (this.pingNumber || 0) + 1;
    this.pingAt = performance.now();
    this.send({ app: 'ping', n: this.pingNumber });
  }

  send(data) {
    if (!this.conn || !this.conn.open) return false;
    try {
      this.conn.send(data);
      return true;
    } catch {
      return false;
    }
  }

  lost(reason) {
    if (this.closed) return;
    this.shut();
    this.on.close(reason);
  }

  fail(message) {
    if (this.closed) return;
    this.shut();
    this.on.status('error', message);
  }

  /// Ours to end: tells the other side and hangs up.
  close() {
    if (this.closed) return;
    this.send({ app: 'bye' });
    // Give the goodbye a moment to leave.
    const peers = this.peers;
    this.closed = true;
    clearInterval(this.timer);
    setTimeout(() => peers.forEach((p) => { try { p.destroy(); } catch { /* gone */ } }), 250);
  }

  shut() {
    this.closed = true;
    clearInterval(this.timer);
    for (const peer of this.peers) {
      try { peer.destroy(); } catch { /* gone */ }
    }
  }
}

function describe(error) {
  if (!navigator.onLine) return 'You\'re offline. Online matches need the internet.';
  switch (error && error.type) {
    case 'browser-incompatible': return 'This browser can\'t make the connection online matches need.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Couldn\'t reach the matchmaking service. Try again in a moment.';
    default: return 'Couldn\'t connect. Try again in a moment.';
  }
}
