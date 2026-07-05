// Serializes heterogeneous tasks through a single promise chain so that no two
// tasks ever run concurrently. Used by the worker to keep `configure` and
// `classify` messages from interleaving (a configure disposing models mid-classify
// would corrupt the classify's in-flight sessions). A task that rejects only
// rejects its own returned promise — the chain advances regardless.
export function createSerialQueue() {
  let chain = Promise.resolve();
  return function enqueue(task) {
    const run = chain.then(task);
    chain = run.then(() => {}, () => {});
    return run;
  };
}
