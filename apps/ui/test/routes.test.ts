import { useParams } from "@tanstack/react-router";
import type { LinkComponentProps, RegisteredRouter } from "@tanstack/react-router";
import { describe, expectTypeOf, it } from "vitest";

describe("Typed routes", () => {
  it("registers a router type that is not any, so hooks and links are checked against the routes", () => {
    expectTypeOf<RegisteredRouter>().not.toBeAny();
  });

  it("types the product route's params as its id", () => {
    const params = () => useParams({ from: "/products/$id" });
    expectTypeOf(params).returns.not.toBeAny();
    expectTypeOf(params).returns.toEqualTypeOf<{ id: string }>();
  });

  it("registers the my gear screen at /gear", () => {
    expectTypeOf<RegisteredRouter["routesByPath"]>().toHaveProperty("/gear");
  });

  it("types a link's params from its target route", () => {
    expectTypeOf<LinkComponentProps<"a", RegisteredRouter, string, "/products/$id">["params"]>().not.toBeAny();
  });
});
