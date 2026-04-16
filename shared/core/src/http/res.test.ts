import { describe, expect, it } from "vitest";
import { res } from "./res";

describe("res.json()", () => {
  describe("res.json(body) — single-argument signature", () => {
    it("defaults to status 200", () => {
      const response = res.json({ ok: true });
      expect(response.status).toBe(200);
    });

    it("JSON-stringifies the body", async () => {
      const body = { message: "hello", count: 42 };
      const response = res.json(body);
      const parsed = await response.json();
      expect(parsed).toEqual(body);
    });

    it("sets Content-Type to application/json", () => {
      const response = res.json({ ok: true });
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("res.json(statusCode, body) — two-argument signature", () => {
    it("uses the provided status code", () => {
      const response = res.json(201, { id: 1 });
      expect(response.status).toBe(201);
    });

    it("JSON-stringifies the body when a status code is provided", async () => {
      const body = { id: 1, name: "created" };
      const response = res.json(201, body);
      const parsed = await response.json();
      expect(parsed).toEqual(body);
    });
  });
});
