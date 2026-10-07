// Loaded via NODE_OPTIONS=--require by scripts/golden/run.mjs ONLY. Freezes
// "now" so goldens do not drift: the demo data is relative to the day it was
// seeded. `new Date(value)`, Date.parse and Date.UTC are untouched.
//
// A Proxy over the real Date, not a subclass: Next copies globals into its
// instrumentation sandbox by OWN properties, and a subclass only inherits
// Date.UTC / Date.parse, which then went missing ("Date.UTC is not a
// function"). The proxy forwards every own property of the real Date.
const fixed = Date.parse(process.env.GOLDEN_NOW ?? "");
if (Number.isNaN(fixed)) throw new Error("GOLDEN_NOW must be an ISO instant");
const RealDate = Date;
const FrozenDate = new Proxy(RealDate, {
  construct(target, args, newTarget) {
    const nt = newTarget === FrozenDate ? target : newTarget;
    return Reflect.construct(target, args.length === 0 ? [fixed] : args, nt);
  },
  apply() {
    // `Date()` called without `new` returns the current time as a string.
    return new RealDate(fixed).toString();
  },
  get(target, prop, receiver) {
    if (prop === "now") return () => fixed;
    return Reflect.get(target, prop, receiver);
  },
});
globalThis.Date = FrozenDate;
