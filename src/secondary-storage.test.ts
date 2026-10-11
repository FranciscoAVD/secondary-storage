import { describe, expect, test } from "bun:test";
import { createSecondaryStorage } from "./secondary-storage";

function setup(overrides: {
  get?: any;
  set?: any;
  del?: any;
  getdel?: any;
  incr?: any;
  increment?: any;
} = {}) {
  const errors: { context: string; message: string }[] = [];
  const storage = createSecondaryStorage({
    redis: {
      client: {
        get: overrides.get ?? (async () => null),
        set: overrides.set ?? (async () => "OK"),
        del: overrides.del ?? (async () => 1),
        getdel: overrides.getdel ?? (async () => null),
        incr: overrides.incr ?? (async () => 1),
      },
      increment: overrides.increment ?? (async () => 1),
    },
    onError: (error, context) => errors.push({ context, message: error.message }),
  });
  return { storage, errors };
}

describe("createSecondaryStorage", () => {
  test("get returns the stored value", async () => {
    const { storage } = setup({ get: async () => "value" });
    expect(await storage.get("key")).toBe("value");
  });

  test("get reports and swallows errors, resolving to undefined", async () => {
    const { storage, errors } = setup({
      get: async () => {
        throw new Error("down");
      },
    });
    expect(await storage.get("key")).toBeNull();
    expect(errors).toEqual([{ context: "secondary-storage.get", message: "down" }]);
  });

  test("set without a ttl calls the two-arg client set", async () => {
    const calls: unknown[][] = [];
    const { storage } = setup({
      set: async (...args: unknown[]) => {
        calls.push(args);
      },
    });
    await storage.set("key", "value");
    expect(calls).toEqual([["key", "value"]]);
  });

  test("set with a ttl passes EX/seconds through", async () => {
    const calls: unknown[][] = [];
    const { storage } = setup({
      set: async (...args: unknown[]) => {
        calls.push(args);
      },
    });
    await storage.set("key", "value", 60);
    expect(calls).toEqual([["key", "value", "EX", 60]]);
  });

  test("set reports and swallows errors", async () => {
    const { storage, errors } = setup({
      set: async () => {
        throw new Error("down");
      },
    });
    await storage.set("key", "value");
    expect(errors).toEqual([{ context: "secondary-storage.set", message: "down" }]);
  });

  test("delete reports and swallows errors", async () => {
    const { storage, errors } = setup({
      del: async () => {
        throw new Error("down");
      },
    });
    await storage.delete("key");
    expect(errors).toEqual([{ context: "secondary-storage.delete", message: "down" }]);
  });

  test("getAndDelete returns the stored value", async () => {
    const { storage } = setup({ getdel: async () => "value" });
    expect(await storage.getAndDelete("key")).toBe("value");
  });

  test("getAndDelete reports and swallows errors, resolving to undefined", async () => {
    const { storage, errors } = setup({
      getdel: async () => {
        throw new Error("down");
      },
    });
    expect(await storage.getAndDelete("key")).toBeNull();
    expect(errors).toEqual([{ context: "secondary-storage.getAndDelete", message: "down" }]);
  });

  test("increment without a ttl uses the client's plain incr", async () => {
    const { storage } = setup({ incr: async () => 7, increment: async () => 99 });
    expect(await storage.increment("key")).toBe(7);
  });

  test("increment with a ttl uses the atomic increment-with-TTL primitive", async () => {
    const { storage } = setup({ incr: async () => 7, increment: async () => 99 });
    expect(await storage.increment("key", 60)).toBe(99);
  });

  test("increment fails open to 0 on error", async () => {
    const { storage, errors } = setup({
      increment: async () => {
        throw new Error("down");
      },
    });
    expect(await storage.increment("key", 60)).toBe(0);
    expect(errors).toEqual([{ context: "secondary-storage.increment", message: "down" }]);
  });
});
