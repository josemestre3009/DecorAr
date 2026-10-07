import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const FUNCTIONS = [
  "public.commit_package_change(jsonb, integer)",
  "public.claim_initial_domain_events(integer)",
  "public.mark_domain_event_published(text)",
  "public.record_domain_event_failure(text, text)",
];

describe("event outbox SQL migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(resolve("supabase/migrations/20261007000000_create_event_outbox.sql"), "utf-8");
  });

  it("keeps the outbox in the private schema, unique by eventId", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS private.domain_events");
    expect(sql).toContain("CONSTRAINT uq_domain_events_event_id UNIQUE (event_id)");
    expect(sql).toContain("CHECK (status IN ('pending', 'published'))");
    expect(sql).toContain("CHECK ((status = 'published') = (published_at IS NOT NULL))");
    expect(sql).not.toMatch(/public\.domain_events/);
  });

  it("denies the outbox and package tables to anon and authenticated", () => {
    expect(sql).toContain("REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON TABLE private.domain_events FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.packages, public.package_items FROM PUBLIC, anon, authenticated;",
    );
    expect(sql).toContain("ALTER TABLE private.domain_events ENABLE ROW LEVEL SECURITY;");
    expect(sql).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/);
  });

  it("restricts every function to service_role", () => {
    for (const fn of FUNCTIONS) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`);
    }
  });

  it("declares every function SECURITY INVOKER with an empty search_path", () => {
    const definitions = sql.split("CREATE OR REPLACE FUNCTION").slice(1);

    expect(definitions).toHaveLength(FUNCTIONS.length);
    for (const definition of definitions) {
      expect(definition).toContain("SECURITY INVOKER");
      expect(definition).toContain("SET search_path = ''");
    }
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("mutates the package and inserts the event in the same function", () => {
    const commit = sql.slice(
      sql.indexOf("FUNCTION public.commit_package_change"),
      sql.indexOf("FUNCTION public.claim_initial_domain_events"),
    );

    expect(commit).toContain("FOR UPDATE;");
    expect(commit).toContain("RAISE EXCEPTION 'package.not_found'");
    expect(commit).toContain("RAISE EXCEPTION 'package.version_conflict'");
    expect(commit).toContain("INSERT INTO public.package_items");
    expect(commit).toContain("DELETE FROM public.package_items");
    expect(commit).toContain("UPDATE public.packages");
    expect(commit).toContain("INSERT INTO private.domain_events");
    expect(commit).toContain("RAISE EXCEPTION 'event.duplicate'");
  });

  it("claims only never-attempted pending events with SKIP LOCKED and records the attempt", () => {
    const claim = sql.slice(
      sql.indexOf("FUNCTION public.claim_initial_domain_events"),
      sql.indexOf("FUNCTION public.mark_domain_event_published"),
    );

    expect(claim).toContain("WHERE d.status = 'pending' AND d.attempts = 0");
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("SET attempts = d.attempts + 1");
  });

  it("marks published only from pending and keeps failures pending", () => {
    expect(sql).toMatch(/SET status = 'published',[\s\S]*?WHERE d\.event_id = p_event_id AND d\.status = 'pending'/);
    const failure = sql.slice(sql.indexOf("FUNCTION public.record_domain_event_failure"));
    expect(failure).not.toMatch(/status\s*=\s*'published'/);
  });

  it("does not expose the outbox through Realtime postgres_changes", () => {
    expect(sql).not.toMatch(/supabase_realtime/i);
    expect(sql).not.toMatch(/postgres_changes/i);
  });
});
