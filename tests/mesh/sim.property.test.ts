// Mesh simulator property tests (mesh-relay task 6).
//
// What the design guarantees (gossip WITH suppression, not plain flooding):
//   G1 No node hands the app layer the same message id twice; the origin never gets its own id back.
//   G2 A node outside the origin's connected component never hears it, and no node farther than
//      ttl + 1 hops does (a copy with hop == ttl is heard but not relayed).
//   G3 Every node transmits a given id at most once (the origin included).
//   G4 The simulation terminates.
//   G5 (ideal medium) Exact reachability: v != origin hears the message  <=>  some neighbour of v
//      transmitted it. In particular every direct neighbour of the origin hears it.
//   G6 A node transmits iff it heard the id fresh, hop < ttl, and was NOT suppressed.
//      Suppression always implies a neighbour transmitted the id, so a suppressed node's
//      neighbourhood was already covered by that neighbour.
//   G7 On graphs without cycles (trees, paths) suppression can never trigger, so coverage is
//      complete: exactly the nodes within ttl + 1 hops hear the message.
// Full component coverage is NOT guaranteed on graphs with cycles: if two neighbours X and Y of a
// transmitter both hold a pending relay and Y fires first, X is suppressed, and a node adjacent only
// to X is never reached (see the explicit counter-example test below). This is the accepted
// trade-off of suppression (Req 2.2); redundancy comes from resends and other nearby relays.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isDelivered } from '../../src/mesh';
import {
  createSim, distances, makeSimPacket, mulberry32, type Edge, type Sim,
} from './sim';

const seedArb = fc.integer({ min: 0, max: 0xffffffff });
const msgIdArb = fc.integer({ min: 1, max: 0x7fffffff });

interface Graph {
  readonly n: number;
  readonly edges: Edge[];
}

/** Arbitrary undirected graph on 2..10 nodes. */
const graphArb: fc.Arbitrary<Graph> = fc.integer({ min: 2, max: 10 }).chain((n) =>
  fc.array(fc.boolean(), { minLength: (n * (n - 1)) / 2, maxLength: (n * (n - 1)) / 2 }).map((bits) => {
    const edges: Edge[] = [];
    let k = 0;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (bits[k++]) edges.push([a, b]);
    return { n, edges };
  }),
);

/** Arbitrary random tree on 2..max nodes (node i attaches to an earlier node). */
const treeArb = (max: number): fc.Arbitrary<Graph> =>
  fc.integer({ min: 2, max }).chain((n) =>
    fc.array(fc.nat(), { minLength: n - 1, maxLength: n - 1 }).map((picks) => ({
      n,
      edges: picks.map((p, i): Edge => [p % (i + 1), i + 1]),
    })),
  );

function transmittersOf(sim: Sim, msgId: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of sim.txLog) if (r.msgId === msgId) m.set(r.node, (m.get(r.node) ?? 0) + 1);
  return m;
}

function receivers(sim: Sim, msgId: number): Set<number> {
  const s = new Set<number>();
  for (const n of sim.nodes) if (n.delivered.has(msgId)) s.add(n.id);
  return s;
}

/** Invariants G1-G3 that hold on any medium (also with listen-before-talk and half duplex). */
function expectSafety(sim: Sim, g: Graph, origin: number, msgId: number, ttl: number, run: { terminated: boolean }): void {
  expect(run.terminated).toBe(true); // G4
  const dist = distances(g.n, g.edges, origin);
  const tx = transmittersOf(sim, msgId);
  for (const [, count] of tx) expect(count).toBe(1); // G3
  for (const node of sim.nodes) {
    expect(node.delivered.get(msgId) ?? 0).toBeLessThanOrEqual(1); // G1
    if (node.id === origin) expect(node.delivered.has(msgId)).toBe(false);
    else if (node.delivered.has(msgId)) {
      expect(dist[node.id]).toBeLessThanOrEqual(ttl + 1); // G2 (also excludes other components)
    }
    if (tx.has(node.id) && node.id !== origin) {
      expect(node.delivered.has(msgId)).toBe(true);
      expect(node.firstHop.get(msgId)!).toBeLessThan(ttl);
      expect(node.suppressed.get(msgId) ?? 0).toBe(0);
    }
    if ((node.suppressed.get(msgId) ?? 0) > 0) expect(tx.has(node.id)).toBe(false);
    expect(node.relay.pending.size).toBe(0);
  }
}

describe('mesh simulator: invariants on random graphs (ideal medium)', () => {
  it('G1-G6: exactly-once delivery, no outsiders, one tx per node, exact reachability', () => {
    fc.assert(
      fc.property(graphArb, fc.nat(), fc.integer({ min: 0, max: 7 }), seedArb, msgIdArb, (g, o, ttl, seed, msgId) => {
        const origin = o % g.n;
        const sim = createSim({ nodeCount: g.n, edges: g.edges, rng: mulberry32(seed) });
        sim.originate(origin, makeSimPacket(msgId, 'SOS', ttl));
        const run = sim.run();
        expectSafety(sim, g, origin, msgId, ttl, run);

        const tx = transmittersOf(sim, msgId);
        expect(tx.has(origin)).toBe(true);
        const got = receivers(sim, msgId);
        for (const node of sim.nodes) {
          if (node.id === origin) continue;
          // G5: heard <=> some neighbour transmitted.
          const neighbourTransmitted = sim.neighbors[node.id]!.some((nb) => tx.has(nb));
          expect(got.has(node.id)).toBe(neighbourTransmitted);
          // G6: transmitted <=> fresh, hop < ttl, not suppressed.
          const shouldRelay =
            got.has(node.id) && node.firstHop.get(msgId)! < ttl && (node.suppressed.get(msgId) ?? 0) === 0;
          expect(tx.has(node.id)).toBe(shouldRelay);
        }
        for (const nb of sim.neighbors[origin]!) expect(got.has(nb)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('G7: on trees every node within ttl + 1 hops hears it, exactly once, nobody farther does', () => {
    fc.assert(
      fc.property(treeArb(12), fc.nat(), fc.integer({ min: 0, max: 7 }), seedArb, msgIdArb, (g, o, ttl, seed, msgId) => {
        const origin = o % g.n;
        const sim = createSim({ nodeCount: g.n, edges: g.edges, rng: mulberry32(seed) });
        sim.originate(origin, makeSimPacket(msgId, 'SOS', ttl));
        const run = sim.run();
        expectSafety(sim, g, origin, msgId, ttl, run);
        const dist = distances(g.n, g.edges, origin);
        for (const node of sim.nodes) {
          if (node.id === origin) continue;
          expect(node.delivered.get(msgId) ?? 0).toBe(dist[node.id]! <= ttl + 1 ? 1 : 0);
          expect(node.suppressed.size).toBe(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('with sufficient TTL every node of the origin component hears it exactly once (acyclic component)', () => {
    fc.assert(
      fc.property(treeArb(8), fc.nat(), seedArb, msgIdArb, (g, o, seed, msgId) => {
        // Two disjoint trees: the origin's one is fully covered, the other one stays silent.
        const shift = g.n;
        const edges: Edge[] = [...g.edges, ...g.edges.map(([a, b]): Edge => [a + shift, b + shift])];
        const sim = createSim({ nodeCount: g.n * 2, edges, rng: mulberry32(seed) });
        const origin = o % g.n;
        sim.originate(origin, makeSimPacket(msgId, 'SOS', 7));
        expect(sim.run().terminated).toBe(true);
        for (const node of sim.nodes) {
          const inComponent = node.id < shift && node.id !== origin;
          expect(node.delivered.get(msgId) ?? 0).toBe(inComponent ? 1 : 0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('G1-G4 still hold with listen-before-talk and half-duplex RX mute', () => {
    fc.assert(
      fc.property(graphArb, fc.nat(), fc.integer({ min: 0, max: 7 }), seedArb, msgIdArb, (g, o, ttl, seed, msgId) => {
        const origin = o % g.n;
        const sim = createSim({ nodeCount: g.n, edges: g.edges, rng: mulberry32(seed), useChannel: true });
        sim.originate(origin, makeSimPacket(msgId, 'SOS', ttl));
        expectSafety(sim, g, origin, msgId, ttl, sim.run());
      }),
      { numRuns: 200 },
    );
  });

  it('several concurrent messages never interfere with per-message exactly-once', () => {
    fc.assert(
      fc.property(graphArb, seedArb, fc.uniqueArray(msgIdArb, { minLength: 2, maxLength: 4 }), (g, seed, ids) => {
        const sim = createSim({ nodeCount: g.n, edges: g.edges, rng: mulberry32(seed) });
        ids.forEach((id, i) => sim.originate(i % g.n, makeSimPacket(id, 'SOS', 7)));
        expect(sim.run().terminated).toBe(true);
        for (const id of ids) {
          for (const [, c] of transmittersOf(sim, id)) expect(c).toBe(1);
          for (const node of sim.nodes) expect(node.delivered.get(id) ?? 0).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('mesh simulator: explicit cases', () => {
  it('TTL limit on a path: exactly the nodes within ttl + 1 hops hear it', () => {
    for (let ttl = 0; ttl <= 7; ttl++) {
      const n = 12;
      const edges: Edge[] = Array.from({ length: n - 1 }, (_, i): Edge => [i, i + 1]);
      const sim = createSim({ nodeCount: n, edges, rng: mulberry32(7 + ttl) });
      sim.originate(0, makeSimPacket(99, 'SOS', ttl));
      expect(sim.run().terminated).toBe(true);
      const heard = sim.nodes.filter((x) => x.delivered.has(99)).map((x) => x.id);
      expect(heard).toEqual(Array.from({ length: ttl + 1 }, (_, i) => i + 1));
    }
  });

  it('suppression can legitimately leave a node uncovered (documented limitation)', () => {
    // 0 -- 1, 0 -- 2, 1 -- 2, 1 -- 3. Nodes 1 and 2 hear 0 together. If 2 fires first, 1 is suppressed
    // and node 3 (adjacent only to 1) is never reached.
    const edges: Edge[] = [[0, 1], [0, 2], [1, 2], [1, 3]];
    const draws = [0.9, 0.0]; // node 1 draws the long delay, node 2 the short one
    let i = 0;
    const sim = createSim({ nodeCount: 4, edges, rng: () => draws[i++ % 2]! });
    sim.originate(0, makeSimPacket(5, 'SOS', 7));
    expect(sim.run().terminated).toBe(true);
    expect(sim.nodes[1]!.suppressed.get(5)).toBe(1);
    expect(sim.nodes[3]!.delivered.has(5)).toBe(false);
    expect(sim.nodes[2]!.delivered.get(5)).toBe(1);
  });

  it('ACK return path: a rescuer ACK reaches the origin and marks it acknowledged', () => {
    fc.assert(
      fc.property(treeArb(8), fc.nat(), fc.nat(), seedArb, msgIdArb, (g, o, r, seed, msgId) => {
        const origin = o % g.n;
        const rescuer = (origin + 1 + (r % (g.n - 1))) % g.n;
        const sim = createSim({ nodeCount: g.n, edges: g.edges, rng: mulberry32(seed), rescuers: [rescuer] });
        sim.originate(origin, makeSimPacket(msgId, 'SOS', 7));
        expect(sim.run().terminated).toBe(true);

        const sender = sim.nodes[origin]!.sender;
        expect(isDelivered(sender, msgId)).toBe(true);
        const m = sender.messages.get(msgId)!;
        expect(m.state).toBe('acknowledged');
        expect(m.ackedAtMs).not.toBeNull();
        // The first ACK copy carries the hop count of its path: tree distance - 1.
        expect(m.ackHop).toBe(distances(g.n, g.edges, origin)[rescuer]! - 1);
        // The rescuer sent exactly one ACK, and every node transmitted each id at most once.
        expect(sim.txLog.filter((t) => t.node === rescuer && t.hop === 0 && t.msgId !== msgId)).toHaveLength(1);
        for (const id of new Set(sim.txLog.map((t) => t.msgId))) {
          for (const [, c] of transmittersOf(sim, id)) expect(c).toBe(1);
        }
        for (const node of sim.nodes) for (const c of node.delivered.values()) expect(c).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  it('without a rescuer nothing is ever acknowledged, even though relays echo the SOS back', () => {
    const edges: Edge[] = [[0, 1], [1, 2]];
    const sim = createSim({ nodeCount: 3, edges, rng: mulberry32(1) });
    sim.originate(0, makeSimPacket(42, 'SOS', 7));
    expect(sim.run().terminated).toBe(true);
    const m = sim.nodes[0]!.sender.messages.get(42)!;
    expect(m.state).toBe('relayed-unconfirmed');
    expect(isDelivered(sim.nodes[0]!.sender, 42)).toBe(false);
  });

  it('an ACK too far away (TTL) never acknowledges', () => {
    // Path of 12, rescuer at the far end: the SOS (ttl 2) dies out before reaching it.
    const n = 12;
    const edges: Edge[] = Array.from({ length: n - 1 }, (_, i): Edge => [i, i + 1]);
    const sim = createSim({ nodeCount: n, edges, rng: mulberry32(3), rescuers: [n - 1] });
    sim.originate(0, makeSimPacket(8, 'SOS', 2));
    expect(sim.run().terminated).toBe(true);
    expect(isDelivered(sim.nodes[0]!.sender, 8)).toBe(false);
  });
});
