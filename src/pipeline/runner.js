import { createContext } from './context.js';

export async function runPipeline(text, pipeline) {
  let ctx = createContext(text);
  for (const { steps } of pipeline) {
    for (const step of steps) {
      ctx = await step(ctx);
    }
  }
  return ctx;
}
