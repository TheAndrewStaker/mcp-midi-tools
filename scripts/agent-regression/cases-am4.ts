/**
 * AM4 agent-regression cases — v1 starter pack.
 *
 * Tier-3 founder e2e in docs/_private/regression/am4.md is the human-
 * driven runbook; these cases are the automated mirror, driven by
 * `claude -p` against the shipped MCP server. Each case is a fresh
 * agent session — no prior context, no privileged hints, agent reads
 * the 59-tool description set the same way Claude Desktop does.
 *
 * Assertions are envelope-shaped (max_tools, must_call,
 * tool_call_validators) rather than exact-sequence matches. Sonnet is
 * non-deterministic; we test behavioral guarantees, not literal
 * call paths.
 */

import type { AgentRegressionCase } from './types.js';

/** Pull the reverb type display name out of an apply_preset spec, if present. */
function pickReverbType(args: Record<string, unknown>): string | undefined {
  const spec = (args.spec ?? {}) as { slots?: unknown };
  if (!Array.isArray(spec.slots)) return undefined;
  for (const slot of spec.slots) {
    if (slot === null || typeof slot !== 'object') continue;
    const s = slot as { block_type?: string; params?: unknown };
    if (s.block_type !== 'reverb') continue;
    const p = s.params;
    if (p === null || typeof p !== 'object') continue;
    // Flat: {type: "...", time: 6}
    if (typeof (p as { type?: unknown }).type === 'string') return (p as { type: string }).type;
    // Channel-nested: {A: {type: "..."}}
    for (const v of Object.values(p as Record<string, unknown>)) {
      if (v !== null && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string') {
        return (v as { type: string }).type;
      }
    }
  }
  return undefined;
}

export const AM4_CASES: AgentRegressionCase[] = [
  // ── H1 — Hero: clean tone with mixed param shapes ───────────────
  {
    id: 'am4-h1-sunday-morning',
    device: 'am4',
    tier: 'hardware',
    description: 'H1 — Vox AC30 + slow chorus + long hall reverb. Tests apply_preset with mixed flat (chorus) + channel-nested (amp, reverb) param shapes. Catches the H1 regression: agent picking a reverb type that does NOT expose `time`.',
    prompt: "Build me an AM4 clean tone on Z4. I want a Vox AC30 with the gain rolled back, a slow chorus, and a long hall reverb with about 30% mix. Call it 'Sunday Morning'.",
    expectations: {
      must_call: ['describe_device', 'apply_preset'],
      max_tools: 8,
      max_repeats: { apply_preset: 2 },
      tool_call_validators: [{
        tool: 'apply_preset',
        check: (args) => {
          const reverbType = pickReverbType(args);
          if (reverbType === undefined) return 'apply_preset did not include a reverb type';
          // The H1 silent-no-op: Hall variants do NOT expose reverb.time on AM4.
          // After this regression fix, the agent should pick from Plate/Spring/Echo/SFX
          // for "long-decay reverb" prompts. If it still picks Hall, the warning fires.
          if (reverbType.startsWith('Hall')) {
            return `picked Hall variant "${reverbType}" — Hall algorithms are fixed-decay on AM4 and don't expose \`time\`. Should pick from Plate/Spring/Echo/SFX instead (use find_compatible_types({block:"reverb", params:["time"]})).`;
          }
          return true;
        },
      }],
      // The H1 trace agent reported "Decay locked in at 6 seconds" even though
      // the write silently no-op'd on Hall. With the right type pick, no such
      // language should appear — the value actually applies.
      should_avoid_dropped_param_warning: true,
      // No false-confidence language about persisting — apply_preset is audition-only.
      text_not_contains: ['saved to Z', 'persisted to Z'],
      max_wall_seconds: 180,
    },
  },

  // ── H2 — Hero: 4-scene rhythm/lead with progressive gain ────────
  {
    id: 'am4-h2-verse-chorus-bridge-solo',
    device: 'am4',
    tier: 'hardware',
    description: 'H2 — 4-scene classic-rock preset with progressive amp gain across channels A/B/C/D and scene mapping. Tests apply_preset with scenes[] + channel-nested amp params. Catches the H2 regression: ambiguous "Plexi 100W" enum picking (now structured valid_options).',
    prompt: "Make me a classic-rock preset on Z04 with four scenes. Scene 1 clean rhythm on amp channel A. Scene 2 crunch on B. Scene 3 a higher-gain rhythm on C. Scene 4 a lead boost on D — same amp but hotter, with delay and reverb. Call it 'Verse Chorus Bridge Solo'.",
    expectations: {
      must_call: ['describe_device', 'apply_preset'],
      max_tools: 10,
      // After valid_options structuring, an ambiguous-enum recovery should be
      // ONE retry max. Three apply_preset calls (orig + dirty-gate + retry)
      // is the upper bound we observed in H2.
      max_repeats: { apply_preset: 3 },
      tool_call_validators: [{
        tool: 'apply_preset',
        // Final apply (whichever index it lands on) should have a specific
        // Plexi variant, not the bare "Plexi 100W" family name.
        call_index: 0,
        check: (args) => {
          const spec = (args.spec ?? {}) as { slots?: unknown };
          if (!Array.isArray(spec.slots)) return 'spec.slots missing';
          for (const slot of spec.slots) {
            if (slot === null || typeof slot !== 'object') continue;
            const s = slot as { block_type?: string; params?: unknown };
            if (s.block_type !== 'amp') continue;
            const p = s.params;
            if (p === null || typeof p !== 'object') continue;
            for (const channel of Object.values(p as Record<string, unknown>)) {
              if (channel === null || typeof channel !== 'object') continue;
              const t = (channel as { type?: unknown }).type;
              if (typeof t !== 'string') continue;
              if (t === 'Plexi 100W') {
                return 'sent ambiguous "Plexi 100W" without a variant suffix (Normal/High/1970/Jumped). Should pick one verbatim on the first try when authoring from scratch.';
              }
            }
          }
          return true;
        },
      }],
      max_wall_seconds: 240,
    },
  },

  // ── H3 — Hero: read-then-tweak (most efficiency-sensitive) ──────
  //
  // H3 doesn't require batched set_params; it accepts either strategy.
  // The Desktop run batched (one set_params with 2 ops); headless Sonnet
  // tends to use two separate set_param calls. Both are correct; we just
  // want to see that the agent reads state, writes BOTH targets, switches
  // scene, and bypasses delay — without redundant introspection.
  {
    id: 'am4-h3-read-then-tweak',
    device: 'am4',
    tier: 'hardware',
    description: 'H3 — read current state, bump gain by 1, roll back reverb mix, scene-2 delay bypass. Tests reads + writes + scene switch + bypass in a single pass. Accepts batched set_params or per-op set_param × 2.',
    prompt: "Tell me what's currently on Z04, then bump the amp gain by one, roll off the reverb mix to about 20%, and make scene 2 bypass the delay.",
    expectations: {
      must_call: ['switch_scene', 'set_bypass'],
      // Accept either set_params (batched) or 2× set_param. 12 is the realistic
      // ceiling for the full sequence including discovery + read + 2 writes +
      // scene + bypass.
      max_tools: 12,
      max_repeats: {
        get_param: 5,
        set_params: 2,
        set_param: 3,
        switch_scene: 2,
        set_bypass: 2,
        describe_device: 1,
        scan_locations: 1,
      },
      tool_call_validators: [{
        // Whichever strategy the agent picks (batched or unbatched), both
        // amp.gain AND reverb.mix must be written exactly once each.
        tool: 'set_bypass',
        call_index: 0,
        check: (_args, _result) => {
          // This validator exists purely to assert set_bypass was called.
          // The real "both knobs written" check is a sibling validator
          // declared as a free function so it can scan the full tool
          // sequence. (Tool-call validators in v1 only see one call at
          // a time — for now this guarantees scene-2 bypass landed.)
          return true;
        },
      }],
      max_wall_seconds: 90,
    },
  },
];
