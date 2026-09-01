import "server-only";

import { cache } from "react";

import { BuildSuiteClient, readBuildSuiteConfig } from "./client.ts";

/**
 * The GoHighLevel sub-account an auth profile belongs to.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `assertScope` requires a non-blank `locationId`, and rightly — a blank one is
 * a missing tenant filter wearing a disguise. But a session only ever got its
 * location from a GoHighLevel sign-in, and an invited person does not have one.
 * So every invited member's scope was `{ locationId: '', authProfileIds: [...] }`
 * and every scoped read threw, on their first page, after a successful login.
 *
 * The location is not a new fact: it is on the auth profile they already
 * inherited. This reads it rather than inventing a column to store it in.
 * ---------------------------------------------------------------------------
 *
 * Keyed by the profile ids themselves, so it cannot over-return: no ids in,
 * nothing out. Deduped per request because the scope is built on every page.
 */
export const locationForAuthProfiles: (
  authProfileIds: readonly string[],
) => Promise<string | null> = cache(
  async (authProfileIds: readonly string[]) => {
    const ids = [
      ...new Set(
        authProfileIds.map((id) => id.trim()).filter((id) => id !== ""),
      ),
    ];
    if (ids.length === 0) return null;

    const config = readBuildSuiteConfig();
    if (!config.configured) return null;

    const rows = await new BuildSuiteClient(config.config).select<{
      location_id: string | null;
    }>({
      from: "auth_profiles",
      columns: ["location_id"],
      filters: { id: `in.(${ids.join(",")})` },
      limit: 10,
    });

    // The first profile that names one. A member inherits their contractor's
    // profiles, which all sit in the same sub-account; if that ever stops being
    // true this returns the first, and picking arbitrarily between tenants is
    // exactly the thing to make loud, so it is asserted in a test instead of
    // guessed at here.
    for (const row of rows) {
      const location = (row.location_id ?? "").trim();
      if (location !== "") return location;
    }
    return null;
  },
);
