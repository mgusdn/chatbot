import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function readEnv(path) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

const env = readEnv(new URL("../.env.local", import.meta.url));
const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let subscribed = false;
const timeout = setTimeout(async () => {
  await client.removeAllChannels();
  console.error(subscribed ? "event timeout" : "subscription timeout");
  process.exit(1);
}, 20_000);

const channel = client
  .channel("memory-room-realtime-smoke")
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "memory_room_revisions",
    },
    async (payload) => {
      if (payload.new?.slug !== "prometheus") return;
      const revision = Number(payload.new?.revision);
      if (!Number.isSafeInteger(revision)) return;
      clearTimeout(timeout);
      console.log(`revision_event=${revision}`);
      await client.removeChannel(channel);
      process.exit(0);
    },
  )
  .subscribe((status) => {
    if (status === "SUBSCRIBED") {
      subscribed = true;
      console.log("subscription=ready");
    }
  });
