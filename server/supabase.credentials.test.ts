import { describe, expect, it } from "vitest";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function requestSettings(apiKey: string) {
  const projectUrl = required("VITE_SUPABASE_URL").replace(/\/$/, "");
  return fetch(`${projectUrl}/auth/v1/settings`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
  });
}

describe("Supabase credential configuration", () => {
  it("accepts the supplied publishable and service-role keys at Supabase Auth", async () => {
    const publishableResponse = await requestSettings(required("VITE_SUPABASE_PUBLISHABLE_KEY"));
    const serviceRoleResponse = await requestSettings(required("SUPABASE_SERVICE_ROLE_KEY"));

    expect(publishableResponse.status, "publishable key must be accepted by Supabase Auth").toBe(200);
    expect(serviceRoleResponse.status, "service-role key must be accepted by Supabase Auth").toBe(200);
    await expect(publishableResponse.json()).resolves.toMatchObject({ external: expect.anything() });
    await expect(serviceRoleResponse.json()).resolves.toMatchObject({ external: expect.anything() });
  });

  it("uses a nontrivial cron authorization secret", () => {
    expect(required("CRON_SECRET").length).toBeGreaterThanOrEqual(24);
  });
});
