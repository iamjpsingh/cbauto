import Anthropic from '@anthropic-ai/sdk';

// Cheapest current model; override with CBAUTO_MODEL.
export const MODEL = process.env.CBAUTO_MODEL || 'claude-haiku-4-5';
const PRICE = { in: 1 / 1e6, out: 5 / 1e6 }; // Haiku 4.5 $/token (input, output)

export const usage = { calls: 0, input: 0, output: 0, get cost() { return this.input * PRICE.in + this.output * PRICE.out; } };

let client;
export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const SYSTEM =
  'You map a UI instruction to one element of a web page. ' +
  'Each line is: <index> <tag> "<text>" plus attributes. ' +
  'Reply with ONLY the index number of the best element, or -1 if none fits.';

// Ask the model which element index matches. Costs ~300-800 input tokens, ~3 output tokens.
export async function pickElement(action, description, lines) {
  client ||= new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Action: ${action}\nTarget: ${description}\n\n${lines.join('\n')}` }],
  });
  usage.calls++;
  usage.input += res.usage.input_tokens;
  usage.output += res.usage.output_tokens;
  const text = res.content.find((b) => b.type === 'text')?.text || '';
  const n = parseInt(text.match(/-?\d+/)?.[0] ?? '-1', 10);
  return Number.isNaN(n) ? -1 : n;
}
