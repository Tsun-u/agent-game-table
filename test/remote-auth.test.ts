import assert from "node:assert/strict";
import test from "node:test";

import { OidcJwtAuthenticator, StaticTokenAuthenticator } from "../src/remote-auth.js";

test("static bearer keys are hashed into stable, isolated principals", async () => {
  const authenticator = new StaticTokenAuthenticator({
    xiaokui: "static-xiaokui-token-0000000000000001",
    ayu: "static-ayu-token-000000000000000000002",
  });
  assert.equal((await authenticator.authenticate("static-xiaokui-token-0000000000000001"))?.id, "static:xiaokui");
  assert.equal((await authenticator.authenticate("static-ayu-token-000000000000000000002"))?.id, "static:ayu");
  assert.equal(await authenticator.authenticate("wrong-token-000000000000000000000000"), null);
});

test("OIDC discovery follows the issuer-path well-known URL rule", async () => {
  let requested = "";
  const issuer = "https://identity.example.com/tenant-a";
  const fetchImplementation: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(
      JSON.stringify({ issuer, jwks_uri: "https://identity.example.com/tenant-a/jwks.json" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const authenticator = await OidcJwtAuthenticator.create(issuer, "https://game-table.example.com/mcp", "game-table:play", fetchImplementation);
  assert.equal(requested, "https://identity.example.com/.well-known/openid-configuration/tenant-a");
  assert.deepEqual(authenticator.authorizationServers, [issuer]);
});
