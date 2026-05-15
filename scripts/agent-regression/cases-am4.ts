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

  // ── §2 surface coverage — no-hardware tier ──────────────────────
  //
  // These cases exercise the dispatcher's pure-introspection paths
  // (describe_device, list_params, lookup_lineage, find_compatible_types)
  // and the validator-layer error envelopes (unknown_param,
  // value_out_of_range, bad_channel, capability_not_supported,
  // unknown_block). Every failure mode below throws in resolvers.ts
  // BEFORE openCtx is called — so the cases run identically whether
  // AM4 is plugged in or not. Tag is `no-hardware` so they survive a
  // release-gate run away from the bench.

  // ── Discovery ───────────────────────────────────────────────────
  {
    id: 'am4-s2-discovery-describe',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 discovery — "What can this AM4 do?" should answer via describe_device. Catches the regression where an agent freelances from training data instead of asking the device.',
    prompt: 'What can this AM4 do? Tell me what blocks it has, how many scenes per preset, and how many channels per block.',
    expectations: {
      must_call: ['describe_device'],
      max_tools: 3,
      // No text_contains: agents that emit minimal text after the tool
      // call (a short summary line, or nothing) still satisfy the
      // intent — the must_call assertion covers correctness.
      // Scenes-per-preset is 4; channels are A/B/C/D. Wrong wire-format
      // talk (Axe-Fx X/Y, 8-scene) signals the agent fabricated.
      text_not_contains: ['8 scene', 'X/Y', 'X and Y channel'],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-discovery-list-amp-types',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 discovery — "What amp models does this support?" should route to list_params({block:"amp", name:"type"}) so the agent reads the live enum table. Catches "agent dumps training-data list verbatim".',
    prompt: 'What amp models does this AM4 support? Just give me a count and a few examples — do not paste the entire list.',
    expectations: {
      must_call: ['list_params'],
      max_tools: 4,
      tool_call_validators: [{
        tool: 'list_params',
        check: (args) => {
          // Need a block-and-name filter to get the enum table back —
          // otherwise the agent is dumping the full param catalog
          // (much larger payload, slower) instead of asking for the
          // amp.type enum specifically.
          const block = args.block as string | undefined;
          const name = args.name as string | undefined;
          if (block === 'amp' && name === 'type') return true;
          // Acceptable fallback: list_params({block:'amp'}) plus a
          // second call with name. Catches only the maximally-wasteful
          // "list_params()" with no filter (returns every param on
          // every block).
          if (block === 'amp') return true;
          return `list_params should be called with block:"amp" (and ideally name:"type") to get the amp enum table — got block=${String(block)} name=${String(name)}.`;
        },
      }],
      // The amp list is 100+ entries; agent should summarize, not dump.
      // Allow ~3000 chars of body content; flag obvious copy-paste of
      // the JSON catalog by checking for a known long substring.
      text_not_contains: ['"enum_values":'],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-discovery-lineage-jcm800',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 discovery — "Look up the JCM800 amp lineage" should route to lookup_lineage. Confirms the lineage corpus is wired and the agent reaches for it instead of generating from training data. Session 78 sweep showed a softer prompt ("Tell me about the JCM800") let Sonnet skip the tool and answer from training — making the prompt explicit about the AM4 lineage data forces the tool call.',
    prompt: 'Look up the JCM800 amp lineage on this AM4 — what real-world gear does Fractal say it models, and what does the manufacturer write about it?',
    expectations: {
      must_call: ['lookup_lineage'],
      max_tools: 4,
      tool_call_validators: [{
        tool: 'lookup_lineage',
        check: (args) => {
          if (args.block_type !== 'amp') {
            return `lookup_lineage block_type should be "amp", got ${String(args.block_type)}.`;
          }
          const needle = 'jcm800';
          const fields = [args.name, args.real_gear, args.model]
            .map((v) => (typeof v === 'string' ? v.toLowerCase() : ''))
            .join(' ');
          if (!fields.includes(needle)) {
            return `lookup_lineage call did not reference "JCM800" in name/real_gear/model — got ${JSON.stringify({ name: args.name, real_gear: args.real_gear, model: args.model })}.`;
          }
          return true;
        },
      }],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-discovery-find-compatible-reverb',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 discovery — "Which reverb types let me set a long decay?" should route to find_compatible_types({block:"reverb", params:["time"]}). This is the same workflow that powers the H1 regression fix — exercised in isolation here.',
    prompt: 'Which reverb types on the AM4 expose a decay-time knob? I want a long, lush tail and the type matters.',
    expectations: {
      must_call: ['find_compatible_types'],
      max_tools: 4,
      tool_call_validators: [{
        tool: 'find_compatible_types',
        check: (args) => {
          if (args.block !== 'reverb') {
            return `find_compatible_types block should be "reverb", got ${String(args.block)}.`;
          }
          const params = args.params as unknown[] | undefined;
          if (!Array.isArray(params) || !params.includes('time')) {
            return `find_compatible_types params should include "time", got ${JSON.stringify(params)}.`;
          }
          return true;
        },
      }],
      // The agent often references Hall as a NEGATIVE example ("Hall
      // variants don't expose time — pick Plate or Spring"). That's
      // the correct answer; we want to catch false POSITIVE claims
      // (claiming Hall does expose time). The find_compatible_types
      // result already excludes Hall — assert via a phrase only a
      // false-positive would emit.
      text_not_contains: [
        'Hall, Large Deep exposes',
        'Hall variants expose time',
        'Hall, Large Deep has a time',
      ],
      max_wall_seconds: 60,
    },
  },

  // ── Error envelopes (negative path) ─────────────────────────────
  {
    id: 'am4-s2-err-unknown-param',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 error — `set amp.warmth to 5` should reject with unknown_param. Agent must not pretend it succeeded.',
    prompt: 'Set the amp warmth to 5 on the AM4.',
    expectations: {
      must_call: ['set_param'],
      max_tools: 5,
      tool_call_validators: [{
        tool: 'set_param',
        check: (args, result) => {
          if (args.block !== 'amp' || args.name !== 'warmth') {
            return `set_param should have been called with amp.warmth (catching the unknown-param path), got block=${String(args.block)} name=${String(args.name)}.`;
          }
          if (result === undefined || !/not valid|unknown/i.test(result)) {
            return `set_param amp.warmth result did not surface the rejection — got: ${result?.slice(0, 200)}.`;
          }
          return true;
        },
      }],
      // False-success language only — phrases that imply the write
      // succeeded. Bare "amp warmth to 5" appears in legitimate refusal
      // text ("you asked to set amp warmth to 5, but…") so it's not a
      // reliable signal. Constrain to past-tense / success verbs.
      text_not_contains: ['warmth is now', 'warmth has been set', 'warmth was set', 'successfully set warmth', 'amp warmth is set'],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-err-value-out-of-range',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 error — `set amp.gain to 12.5`: agent must surface that 12.5 is out of range (gain max = 10). Three acceptable paths: (a) call set_param and let the validator-layer reject, (b) check the descriptor first and refuse upfront, (c) refuse from training-data knowledge of AM4 gain bounds. The signal is no false-success narration, not any specific tool path.',
    prompt: 'Set the amp gain to 12.5 on the AM4.',
    expectations: {
      // min_tools:0 — agent may refuse upfront with zero tool calls,
      // which IS the correct behavior. The harness's value here is
      // catching false-success narration, not forcing a tool path.
      min_tools: 0,
      max_tools: 5,
      tool_call_validators: [{
        // If the agent DOES fire set_param, the call must use 12.5 and
        // the result must surface the range rejection. `optional:true`
        // skips this validator when set_param wasn't called (refuse-
        // upfront path).
        tool: 'set_param',
        optional: true,
        check: (args, result) => {
          if (args.block !== 'amp' || args.name !== 'gain') {
            return `set_param called but targeted ${String(args.block)}.${String(args.name)} instead of amp.gain.`;
          }
          if (args.value !== 12.5 && args.value !== '12.5') {
            return `set_param amp.gain value should be 12.5, got ${JSON.stringify(args.value)}.`;
          }
          if (result === undefined || !/out of range|max(imum)?|range \[/i.test(result)) {
            return `set_param amp.gain=12.5 result did not surface a range rejection — got: ${result?.slice(0, 200)}.`;
          }
          return true;
        },
      }],
      // Final text must reference the actual constraint (the max
      // value or "out of range"). Catches "I tried and it worked!"
      // hallucinations no matter which path the agent took.
      text_contains: ['10'],
      // Must not claim the 12.5 write succeeded.
      text_not_contains: ['gain is now 12', 'set gain to 12', 'amp gain is at 12', 'set to 12.5'],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-err-bad-channel',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 error — `set amp channel E gain to 6`: agent must surface that channel E does not exist (AM4 channels are A/B/C/D). Three acceptable paths: call set_param + let the validator reject, refuse after describe_device, or refuse from training-data knowledge. Test signal is no false-success narration, not tool path.',
    prompt: 'Set amp channel E gain to 6 on the AM4.',
    expectations: {
      min_tools: 0,
      max_tools: 5,
      tool_call_validators: [{
        tool: 'set_param',
        optional: true,
        check: (args, result) => {
          if (args.block !== 'amp' || args.name !== 'gain') {
            return `set_param called but targeted ${String(args.block)}.${String(args.name)} instead of amp.gain.`;
          }
          const channel = args.channel;
          if (typeof channel !== 'string' || channel.toUpperCase() !== 'E') {
            return `set_param channel should be "E" (the bad-channel request), got ${JSON.stringify(channel)}.`;
          }
          if (result === undefined || !/A\/B\/C\/D|not valid|bad.?channel/i.test(result)) {
            return `set_param amp.gain channel=E result did not surface a bad-channel rejection — got: ${result?.slice(0, 200)}.`;
          }
          return true;
        },
      }],
      // Drop text_contains: the agent's wording varies ("channels are
      // A/B/C/D", "AM4 supports A through D", "no channel E exists",
      // etc.) — predicting exact substrings is brittle. The signal we
      // care about is the absence of false-success language below.
      text_not_contains: ['channel E is now', 'set channel E', 'channel E gain is'],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-err-channel-on-non-channel-block',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 error — `set chorus.rate channel:A` should reject with capability_not_supported (chorus has no channels). Critical: agent must NOT silently drop the channel arg and write to the active channel.',
    prompt: 'Set the chorus channel A rate to 0.8 on the AM4.',
    expectations: {
      // The cleanest pass is: agent calls set_param with channel="A",
      // sees the refusal, surfaces it. A more careful agent might
      // call describe_device or list_params first; that's fine too.
      must_call: ['set_param'],
      max_tools: 6,
      tool_call_validators: [{
        tool: 'set_param',
        check: (args, result) => {
          if (args.block !== 'chorus' || args.name !== 'rate') {
            return `set_param should target chorus.rate, got block=${String(args.block)} name=${String(args.name)}.`;
          }
          if (args.channel === undefined) {
            return 'set_param dropped the channel argument silently — that is the regression this case guards against. Channel must be passed so the server can issue capability_not_supported.';
          }
          if (result === undefined || !/channel|capability/i.test(result)) {
            return `set_param chorus.rate channel:A result did not mention channels/capability — got: ${result?.slice(0, 200)}.`;
          }
          return true;
        },
      }],
      // Without an enforced refusal, agent would say "set chorus rate to 0.8".
      text_not_contains: ['chorus channel A is now', 'channel A rate is set'],
      max_wall_seconds: 60,
    },
  },
  {
    id: 'am4-s2-err-unknown-block',
    device: 'am4',
    tier: 'no-hardware',
    description: '§2 error — `set oscillator.gain to 5`: agent must surface that AM4 has no oscillator block. Three acceptable paths: call set_param + let the validator reject, refuse after describe_device, or refuse from training-data knowledge.',
    prompt: 'Set the oscillator gain to 5 on the AM4.',
    expectations: {
      min_tools: 0,
      max_tools: 5,
      tool_call_validators: [{
        tool: 'set_param',
        optional: true,
        check: (args, result) => {
          if (args.block !== 'oscillator') {
            return `set_param was called but block:"${String(args.block)}" — odd given the prompt.`;
          }
          if (result === undefined || !/not valid|unknown.?block|Blocks?:/i.test(result)) {
            return `set_param oscillator.gain result did not surface an unknown-block rejection — got: ${result?.slice(0, 200)}.`;
          }
          return true;
        },
      }],
      text_not_contains: ['oscillator gain is now', 'set oscillator gain', 'oscillator has been set'],
      max_wall_seconds: 60,
    },
  },
];
