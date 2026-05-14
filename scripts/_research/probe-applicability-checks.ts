import { checkApplicability } from '@mcp-midi-control/am4/applicability.js';

console.log('right_post_delay, no current types:',
  JSON.stringify(checkApplicability('delay.right_post_delay', {})));
console.log('right_post_delay, currentTypes={delay:0} (Digital Mono):',
  JSON.stringify(checkApplicability('delay.right_post_delay', { currentTypes: { delay: 0 } })));
console.log('right_post_delay, currentTypes={delay:6} (Ping-Pong):',
  JSON.stringify(checkApplicability('delay.right_post_delay', { currentTypes: { delay: 6 } })));
console.log('amp.gain (always-on), currentTypes={amp:0}:',
  JSON.stringify(checkApplicability('amp.gain', { currentTypes: { amp: 0 } })));
console.log('amp.negative_feedback (always + special-case), currentTypes={amp:1}:',
  JSON.stringify(checkApplicability('amp.negative_feedback', { currentTypes: { amp: 1 } })));
