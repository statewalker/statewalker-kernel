import { describe, expect, it } from "vitest";
import { isUserCancelled, UserCancelledError } from "../src/errors.js";

describe("UserCancelledError", () => {
  it("constructs with a default message and the expected name", () => {
    const err = new UserCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UserCancelledError);
    expect(err.name).toBe("UserCancelledError");
    expect(err.message).toBe("User cancelled the operation");
  });

  it("accepts a custom message", () => {
    const err = new UserCancelledError("dismissed the picker");
    expect(err.message).toBe("dismissed the picker");
  });
});

describe("isUserCancelled", () => {
  it("returns true for a UserCancelledError instance", () => {
    expect(isUserCancelled(new UserCancelledError())).toBe(true);
  });

  it("returns false for a plain Error", () => {
    expect(isUserCancelled(new Error("other"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUserCancelled(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUserCancelled(undefined)).toBe(false);
  });
});
