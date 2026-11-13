// Deterministic discrete-event mesh simulator (test-only helper). Pure TS, virtual clock, seeded RNG.
//
// Every node runs the REAL modules: relay.ts (dedup + scheduler + suppression), optionally channel.ts
// (listen-before-talk, RX mute while TX), and ack.ts (rescuer ACK + sender confirmation).
// A transmission occupies the air for `airtimeMs`; at its end every graph neighbour hears it.
import type { Packet } from '../../src/packet';
import { PACKET_VERSION } from '../../src/packet';
import {
  createRelayState, onHeard, due, nextDueMs, markSeen,
  createChannel, requestTx, noteActivity, acceptFrame, txStart, txEnd,
  createAckResponderState, ackForHeard, createSenderState, trackSent, onAckHeard, onEchoHeard,
  type RelayState, type ChannelState, type Rng, type AckResponderState, type SenderState,
} from '../../src/mesh';

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Edge = readonly [number, number];

export interface SimOptions {
  readonly nodeCount: number;
  readonly edges: readonly Edge[];
  readonly rng: Rng;
  /** Use listen-before-talk + RX mute (channel.ts). Off: ideal medium without collisions. */
  readonly useChannel?: boolean;
  readonly airtimeMs?: number;
  /** Node ids in Rescue Mode: they answer each fresh SOS with an ACK. */
  readonly rescuers?: readonly number[];
}

export interface TxRecord {
  readonly node: number;
  readonly msgId: number;
  readonly startMs: number;
  readonly hop: number;
}

export interface SimNode {
  readonly id: number;
  readonly relay: RelayState;
  readonly chan: ChannelState;
  readonly responder: AckResponderState;
  readonly sender: SenderState;
  readonly rescuer: boolean;
  /** msgId -> number of times the app layer was handed the message as fresh. */
  readonly delivered: Map<number, number>;
  /** msgId -> hop value of the copy that was first heard. */
  readonly firstHop: Map<number, number>;
  /** msgId -> number of times our pending relay was cancelled by suppression. */
  readonly suppressed: Map<number, number>;
  lastTxStartMs: number;
}

type Event =
  | { readonly t: number; readonly seq: number; readonly kind: 'wake'; readonly node: number }
  | { readonly t: number; readonly seq: number; readonly kind: 'txEnd'; readonly node: number; readonly packet: Packet; readonly startMs: number };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface RunResult {
  readonly terminated: boolean;
  readonly events: number;
  readonly endMs: number;
}

export interface Sim {
  readonly nodes: readonly SimNode[];
  readonly neighbors: readonly (readonly number[])[];
  readonly txLog: TxRecord[];
  nowMs: number;
  originate(node: number, packet: Packet): void;
  run(maxEvents?: number): RunResult;
}

export function createSim(opts: SimOptions): Sim {
  const { nodeCount, rng } = opts;
  const useChannel = opts.useChannel ?? false;
  const airtimeMs = opts.airtimeMs ?? 1000;
  const rescuers = new Set(opts.rescuers ?? []);

  const adj: Set<number>[] = Array.from({ length: nodeCount }, () => new Set<number>());
  for (const [a, b] of opts.edges) {
    if (a === b) continue;
    adj[a]!.add(b);
    adj[b]!.add(a);
  }
  const neighbors = adj.map((s) => [...s].sort((x, y) => x - y));

  const nodes: SimNode[] = Array.from({ length: nodeCount }, (_, id) => ({
    id,
    relay: createRelayState(true),
    chan: createChannel(),
    responder: createAckResponderState(),
    sender: createSenderState(),
    rescuer: rescuers.has(id),
    delivered: new Map(),
    firstHop: new Map(),
    suppressed: new Map(),
    lastTxStartMs: -Infinity,
  }));

  const queue: Event[] = [];
  let seq = 0;
  const txLog: TxRecord[] = [];
  const sim: Sim = { nodes, neighbors, txLog, nowMs: 0, originate, run };
  let ackCounter = 0;

  function push(e: DistributiveOmit<Event, 'seq'>): void {
    const ev = { ...e, seq: seq++ } as Event;
    // Insert keeping (t, seq) order; queues stay tiny.
    let i = queue.length;
    while (i > 0 && queue[i - 1]!.t > ev.t) i--;
    queue.splice(i, 0, ev);
  }

  function armWake(n: SimNode): void {
    const d = nextDueMs(n.relay);
    if (d !== null) push({ t: Math.max(d, sim.nowMs), kind: 'wake', node: n.id });
  }

  function transmit(n: SimNode, packet: Packet, t: number): void {
    txLog.push({ node: n.id, msgId: packet.msgId, startMs: t, hop: packet.hop });
    n.lastTxStartMs = t;
    txStart(n.chan);
    if (useChannel) for (const nb of neighbors[n.id]!) noteActivity(nodes[nb]!.chan, t);
    push({ t: t + airtimeMs, kind: 'txEnd', node: n.id, packet, startMs: t });
  }

  function hear(n: SimNode, packet: Packet, t: number): void {
    const res = onHeard(n.relay, packet, t, rng);
    if (res.outcome === 'suppressed') n.suppressed.set(packet.msgId, (n.suppressed.get(packet.msgId) ?? 0) + 1);
    if (res.fresh) {
      n.delivered.set(packet.msgId, (n.delivered.get(packet.msgId) ?? 0) + 1);
      n.firstHop.set(packet.msgId, packet.hop);
    }
    onAckHeard(n.sender, packet, t);
    onEchoHeard(n.sender, packet);
    if (res.fresh) {
      const ack = ackForHeard(n.responder, packet, n.rescuer, t, () => 0x80000000 + n.id * 4096 + ackCounter++);
      if (ack) {
        // The ACK is our own origination: never treat it as fresh when echoed back, and send it
        // through the same pending/LBT path as relays.
        markSeen(n.relay.seen, ack.msgId, t);
        n.relay.pending.set(ack.msgId, { packet: ack, dueMs: t });
      }
    }
    armWake(n);
  }

  function originate(id: number, packet: Packet): void {
    const n = nodes[id]!;
    const t = sim.nowMs;
    markSeen(n.relay.seen, packet.msgId, t);
    if (packet.type === 'SOS') trackSent(n.sender, packet.msgId, t);
    transmit(n, packet, t);
  }

  function wake(n: SimNode, t: number): void {
    for (const pkt of due(n.relay, t)) {
      if (useChannel) {
        const d = requestTx(n.chan, t, rng);
        if (d.kind === 'defer') {
          // Back in pending so a duplicate heard while we wait still suppresses us.
          n.relay.pending.set(pkt.msgId, { packet: pkt, dueMs: d.retryAtMs });
          continue;
        }
      }
      transmit(n, pkt, t);
    }
    armWake(n);
  }

  function run(maxEvents = 200_000): RunResult {
    let events = 0;
    while (queue.length > 0 && events < maxEvents) {
      const ev = queue.shift()!;
      events++;
      sim.nowMs = ev.t;
      if (ev.kind === 'wake') {
        wake(nodes[ev.node]!, ev.t);
      } else {
        const tx = nodes[ev.node]!;
        txEnd(tx.chan, ev.t);
        for (const nbId of neighbors[ev.node]!) {
          const nb = nodes[nbId]!;
          if (useChannel) {
            // Half duplex: a node that transmitted during any part of this frame cannot have decoded it.
            if (nb.chan.txActive || nb.chan.txEndedMs > ev.startMs) continue;
            if (!acceptFrame(nb.chan, ev.t)) continue;
          }
          hear(nb, ev.packet, ev.t);
        }
      }
    }
    return { terminated: queue.length === 0, events, endMs: sim.nowMs };
  }

  return sim;
}

// ---------- graph helpers ----------

/** BFS hop distances from `origin`; unreachable nodes get Infinity. */
export function distances(nodeCount: number, edges: readonly Edge[], origin: number): number[] {
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const [a, b] of edges) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  const dist = new Array<number>(nodeCount).fill(Infinity);
  dist[origin] = 0;
  const q = [origin];
  while (q.length > 0) {
    const u = q.shift()!;
    for (const v of adj[u]!) {
      if (dist[v] === Infinity) {
        dist[v] = dist[u]! + 1;
        q.push(v);
      }
    }
  }
  return dist;
}

export function makeSimPacket(
  msgId: number,
  type: Packet['type'] = 'SOS',
  ttl = 7,
  refMsgId: number | null = null,
): Packet {
  return {
    version: PACKET_VERSION,
    type,
    hop: 0,
    ttl,
    msgId: msgId >>> 0,
    originMinutes: 1000,
    position: null,
    accuracyClass: 0,
    statusFlags: 1,
    people: 2,
    battery: 5,
    refMsgId,
    note: '',
  };
}
