class CapacityError extends Error {
  constructor(message = "Capacity is temporarily saturated. Please try again shortly.") {
    super(message);
    this.name = "CapacityError";
    this.statusCode = 503;
    this.expose = true;
  }
}

function createAsyncLimiter(maxActive, maxQueued, queueTimeoutMs) {
  const safeMaxActive = Math.max(1, maxActive);
  const safeMaxQueued = Math.max(0, maxQueued);
  const queue = [];
  let active = 0;

  return {
    run: async task => {
      const release = await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    stats: () => ({
      active,
      queued: queue.length,
      maxActive: safeMaxActive,
      maxQueued: safeMaxQueued
    })
  };

  function acquire() {
    if (active < safeMaxActive) {
      active += 1;
      return Promise.resolve(makeRelease());
    }

    if (queue.length >= safeMaxQueued) {
      return Promise.reject(new CapacityError("AI capacity is temporarily saturated. Please try again shortly."));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        done: false,
        timer: null
      };

      entry.timer = setTimeout(() => {
        entry.done = true;
        const index = queue.indexOf(entry);
        if (index !== -1) {
          queue.splice(index, 1);
        }
        reject(new CapacityError("AI capacity is temporarily saturated. Please try again shortly."));
      }, queueTimeoutMs);
      entry.timer.unref?.();

      queue.push(entry);
    });
  }

  function makeRelease() {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      active = Math.max(0, active - 1);
      drain();
    };
  }

  function drain() {
    while (active < safeMaxActive && queue.length > 0) {
      const entry = queue.shift();
      if (!entry || entry.done) {
        continue;
      }

      entry.done = true;
      clearTimeout(entry.timer);
      active += 1;
      entry.resolve(makeRelease());
    }
  }
}

module.exports = {
  CapacityError,
  createAsyncLimiter
};
