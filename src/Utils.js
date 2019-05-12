// @flow

export function throttleCalls<TArg, TRet>(
  cooldownTime: number,
  fn: TArg => TRet,
  defaultRet: TRet
): TArg => TRet {
  let lastStart = 0;

  const throttledFn = (arg: TArg): TRet => {
    if (Date.now() > lastStart + cooldownTime) {
      lastStart = Date.now();
      return fn(arg);
    } else {
      return defaultRet;
    }
  };

  throttledFn.setThrottledNow = () => {
    lastStart = Date.now();
  };

  return throttledFn;
}
export function trueAfterDelay(cooldownTime: number): () => boolean {
  let alreadyCalledOnce = false;
  let done = false;
  return throttleCalls(
    cooldownTime,
    () => {
      if (alreadyCalledOnce) {
        done = true;
      } else {
        alreadyCalledOnce = true;
      }
      return done;
    },
    false
  );
}
